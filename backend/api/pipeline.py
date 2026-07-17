"""
Background analysis pipeline.

Extracted from views.py so the HTTP layer stays thin. `process_analysis` runs
on a background thread and orchestrates the deterministic YOLO verdict (ml.py),
best-effort weather enrichment (weather.py), the optional LLM-written report
(llm.py) and the downloadable PDF (report_pdf.py). Each enrichment is
fail-soft: a failure is logged and the core analysis still completes.
"""

import logging
import tempfile
from pathlib import Path

from django.core.files import File
from django.core.files.base import ContentFile

from . import llm, ml, report_pdf, weather
from .models import ImageAnalysis

logger = logging.getLogger(__name__)


def process_analysis(analysis_id):
    """
    Runs on a background thread so the upload request returns immediately.

    Analyzes every drone image in the survey independently, then aggregates
    their detections into one overall verdict + report. The worst status wins:
    ``summarize_health`` flags the survey as stressed if *any* image is.
    """
    try:
        analysis = ImageAnalysis.objects.get(id=analysis_id)
        analysis.status = ImageAnalysis.Status.PROCESSING
        analysis.save(update_fields=['status', 'updated_at'])

        update_fields = ['report', 'crop_health', 'status', 'updated_at']

        images = list(analysis.images.all())
        all_detections = []
        used_dummy = False

        if images:
            for ai in images:
                dets, used_d = _analyze_image_row(ai)
                all_detections.extend(dets)
                used_dummy = used_dummy or used_d
            # Promote the first image's annotated copy onto the survey so
            # thumbnails and the single-image PDF path keep working.
            primary = images[0]
            if primary.annotated_image:
                analysis.annotated_image = primary.annotated_image
                update_fields.append('annotated_image')
        else:
            # Legacy row: a single image stored directly on the survey.
            all_detections, used_dummy = _analyze_survey_image(analysis, update_fields)

        crop_health = ml.summarize_health(all_detections)
        report = ml.build_report(
            crop_health, all_detections, source='dummy' if used_dummy else 'yolo'
        )
        analysis.report = report
        analysis.crop_health = crop_health

        # Best-effort weather enrichment. Never fails the analysis.
        _attach_weather(analysis, update_fields)

        # Upgrade the templated report to an LLM-written one when a key is set.
        # Best-effort: on any failure we keep the template report.
        _attach_llm_report(analysis, crop_health)

        # Render the downloadable PDF report. Best-effort.
        _attach_pdf(analysis, crop_health, update_fields)

        analysis.status = ImageAnalysis.Status.DONE
        analysis.save(update_fields=update_fields)
    except Exception as exc:  # noqa: BLE001 - always record failure on the row
        ImageAnalysis.objects.filter(id=analysis_id).update(
            status=ImageAnalysis.Status.FAILED, error=str(exc)
        )


def _analyze_image_row(ai):
    """
    Run YOLO on one AnalysisImage, store its annotated copy + per-image
    detections/verdict, and return (detections, used_dummy).
    """
    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            annotated_path = Path(tmp_dir) / f'annotated_{ai.id}.jpg'
            report, crop_health = ml.analyze_with_yolo(ai.image.path, annotated_path)
            with open(annotated_path, 'rb') as f:
                ai.annotated_image.save(annotated_path.name, File(f), save=False)
        used_dummy = False
    except ml.ModelUnavailable as exc:
        logger.warning('YOLO unavailable for image %s (%s); using dummy analysis', ai.id, exc)
        report, crop_health = ml.dummy_analysis()
        used_dummy = True

    detections = report.get('detections') or []
    ai.detections = detections
    ai.crop_health = crop_health
    ai.save()
    return detections, used_dummy


def _analyze_survey_image(analysis, update_fields):
    """Backward-compatible path for a survey whose image sits on the row itself."""
    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            annotated_path = Path(tmp_dir) / f'annotated_{analysis.id}.jpg'
            report, _ = ml.analyze_with_yolo(analysis.image.path, annotated_path)
            with open(annotated_path, 'rb') as f:
                analysis.annotated_image.save(annotated_path.name, File(f), save=False)
            update_fields.append('annotated_image')
        return report.get('detections') or [], False
    except ml.ModelUnavailable as exc:
        logger.warning('YOLO model unavailable (%s); falling back to dummy analysis', exc)
        report, _ = ml.dummy_analysis()
        return report.get('detections') or [], True


def _attach_weather(analysis, update_fields):
    """
    Look up weather for the photo's location/date and set it on the analysis
    (mutating ``update_fields`` for the caller's save). If only a place name
    was given, geocode it to coordinates first. Any failure is swallowed —
    weather is an add-on, not a hard requirement.
    """
    try:
        if (analysis.latitude is None or analysis.longitude is None) and analysis.location_name:
            geo = weather.geocode(analysis.location_name)
            if geo:
                analysis.latitude = geo['latitude']
                analysis.longitude = geo['longitude']
                if not analysis.location_name:
                    analysis.location_name = geo['location_name']
                update_fields += ['latitude', 'longitude', 'location_name']

        when = analysis.captured_at or analysis.created_at
        data = weather.get_weather(analysis.latitude, analysis.longitude, when)
        if data:
            analysis.weather = data
            update_fields.append('weather')
    except Exception as exc:  # noqa: BLE001
        logger.warning('Weather enrichment failed for %s: %s', analysis.id, exc)


def _attach_llm_report(analysis, crop_health):
    """
    Replace the templated report with an LLM-written detailed one when
    GEMINI_API_KEY is configured. The vision verdict (crop_health) stays
    authoritative; the LLM only narrates. Best-effort: keeps the template on
    any failure. ``report`` is already in the caller's update_fields.
    """
    try:
        detections = (analysis.report or {}).get('detections') or []
        location = analysis.location_name
        if not location and analysis.latitude is not None and analysis.longitude is not None:
            location = f'{analysis.latitude:.4f}, {analysis.longitude:.4f}'
        captured = analysis.captured_at.isoformat() if analysis.captured_at else None

        llm_report = llm.generate_report(
            crop_health=crop_health,
            detections=detections,
            weather=analysis.weather,
            location=location,
            captured_at=captured,
        )
        if llm_report:
            analysis.report = llm_report
    except Exception as exc:  # noqa: BLE001
        logger.warning('LLM report generation failed for %s: %s', analysis.id, exc)


def _attach_pdf(analysis, crop_health, update_fields):
    """Render and store the downloadable PDF report. Best-effort."""
    try:
        annotated_path = (
            analysis.annotated_image.path if analysis.annotated_image else None
        )
        # Per-image breakdown for the PDF (empty for legacy single-image rows).
        images_meta = []
        for ai in analysis.images.all():
            images_meta.append({
                'annotated_image_path': ai.annotated_image.path if ai.annotated_image else None,
                'image_path': ai.image.path if ai.image else None,
                'crop_health': ai.crop_health,
                'detections': ai.detections or [],
            })
        pdf_bytes = report_pdf.build_report_pdf(
            analysis_id=str(analysis.id),
            crop_health=crop_health,
            report=analysis.report,
            annotated_image_path=annotated_path,
            images=images_meta,
            weather=analysis.weather,
            captured_at=analysis.captured_at.isoformat() if analysis.captured_at else None,
            location_name=analysis.location_name,
            latitude=analysis.latitude,
            longitude=analysis.longitude,
        )
        analysis.report_pdf.save(
            f'report_{analysis.id}.pdf', ContentFile(pdf_bytes), save=False
        )
        update_fields.append('report_pdf')
    except Exception as exc:  # noqa: BLE001
        logger.warning('PDF report generation failed for %s: %s', analysis.id, exc)
