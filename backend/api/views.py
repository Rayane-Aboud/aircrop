import logging
import tempfile
import threading
from pathlib import Path

from django.core.files import File
from django.core.files.base import ContentFile
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import exif, llm, ml, report_pdf, weather
from .models import ImageAnalysis

logger = logging.getLogger(__name__)

SAMPLE_IMAGES_DIR = Path(__file__).resolve().parent / 'sample_images'
SAMPLE_IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png'}


def _process_analysis(analysis_id):
    """Runs on a background thread so the upload request returns immediately."""
    try:
        analysis = ImageAnalysis.objects.get(id=analysis_id)
        analysis.status = ImageAnalysis.Status.PROCESSING
        analysis.save(update_fields=['status', 'updated_at'])

        update_fields = ['report', 'crop_health', 'status', 'updated_at']

        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                annotated_path = Path(tmp_dir) / f'annotated_{analysis.id}.jpg'
                report, crop_health = ml.analyze_with_yolo(analysis.image.path, annotated_path)
                with open(annotated_path, 'rb') as f:
                    analysis.annotated_image.save(annotated_path.name, File(f), save=False)
                update_fields.append('annotated_image')
        except ml.ModelUnavailable as exc:
            logger.warning('YOLO model unavailable (%s); falling back to dummy analysis', exc)
            report, crop_health = ml.dummy_analysis()

        analysis.report = report
        analysis.crop_health = crop_health

        # Best-effort weather enrichment (feature 2). Never fails the analysis.
        _attach_weather(analysis, update_fields)

        # Upgrade the templated report to an LLM-written one when a key is set.
        # Best-effort: on any failure we keep the template report.
        _attach_llm_report(analysis, crop_health)

        # Render the downloadable PDF report. Best-effort — a PDF failure must
        # not fail the analysis itself.
        _attach_pdf(analysis, crop_health, update_fields)

        analysis.status = ImageAnalysis.Status.DONE
        analysis.save(update_fields=update_fields)
    except Exception as exc:  # noqa: BLE001 - always record failure on the row
        ImageAnalysis.objects.filter(id=analysis_id).update(
            status=ImageAnalysis.Status.FAILED, error=str(exc)
        )


def _attach_weather(analysis, update_fields):
    """
    Look up weather for the photo's location/date and set it on the analysis
    (mutating ``update_fields`` for the caller's save). If only a place name
    was given, geocode it to coordinates first. Any failure is swallowed —
    weather is an add-on, not a hard requirement.
    """
    try:
        # Resolve coordinates from a typed place name when GPS is absent.
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
        pdf_bytes = report_pdf.build_report_pdf(
            analysis_id=str(analysis.id),
            crop_health=crop_health,
            report=analysis.report,
            annotated_image_path=annotated_path,
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


def _parse_captured_at(raw):
    """Parse a user-supplied date or datetime string into an aware datetime."""
    if not raw:
        return None
    dt = parse_datetime(raw)
    if dt is None:
        d = parse_date(raw)
        if d is not None:
            dt = datetime(d.year, d.month, d.day)
    if dt is not None and timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _parse_float(raw):
    try:
        return float(raw) if raw not in (None, '') else None
    except (TypeError, ValueError):
        return None


@csrf_exempt
@require_http_methods(['POST'])
def analyze_image(request):
    image = request.FILES.get('image')
    if not image:
        return JsonResponse(
            {'error': 'No image file provided (expected multipart field "image").'},
            status=400,
        )

    analysis = ImageAnalysis.objects.create(image=image)

    # Date & location (feature 1): read EXIF first, then let any manually
    # supplied values override it (a user correcting/entering data wins).
    meta = exif.extract_metadata(analysis.image.path)

    captured_at = _parse_captured_at(request.POST.get('captured_at')) or meta.get('captured_at')
    if captured_at is not None and timezone.is_naive(captured_at):
        captured_at = timezone.make_aware(captured_at, timezone.get_current_timezone())

    manual_lat = _parse_float(request.POST.get('latitude'))
    manual_lon = _parse_float(request.POST.get('longitude'))

    analysis.captured_at = captured_at
    analysis.latitude = manual_lat if manual_lat is not None else meta.get('latitude')
    analysis.longitude = manual_lon if manual_lon is not None else meta.get('longitude')
    analysis.location_name = (request.POST.get('location_name') or '').strip() or None
    analysis.save(update_fields=[
        'captured_at', 'latitude', 'longitude', 'location_name', 'updated_at',
    ])

    thread = threading.Thread(target=_process_analysis, args=(analysis.id,), daemon=True)
    thread.start()

    return JsonResponse({'id': str(analysis.id), 'status': analysis.status}, status=202)


@require_http_methods(['GET'])
def analysis_status(request, analysis_id):
    try:
        analysis = ImageAnalysis.objects.get(id=analysis_id)
    except ImageAnalysis.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    data = {
        'id': str(analysis.id),
        'status': analysis.status,
        # Relative URLs so the browser fetches same-origin (through the Vite dev
        # proxy / nginx in prod). Absolute URLs would point straight at the
        # backend host and trip CORS.
        'image_url': analysis.image.url if analysis.image else None,
        'annotated_image_url': (
            analysis.annotated_image.url if analysis.annotated_image else None
        ),
        'captured_at': analysis.captured_at.isoformat() if analysis.captured_at else None,
        'latitude': analysis.latitude,
        'longitude': analysis.longitude,
        'location_name': analysis.location_name,
        'weather': analysis.weather,
    }

    if analysis.status == ImageAnalysis.Status.DONE:
        data['report'] = analysis.report
        data['crop_health'] = analysis.crop_health
        data['report_pdf_url'] = (
            f'/api/analyze/{analysis.id}/report.pdf' if analysis.report_pdf else None
        )
    elif analysis.status == ImageAnalysis.Status.FAILED:
        data['error'] = analysis.error

    return JsonResponse(data)


@require_http_methods(['GET'])
def analysis_report_pdf(request, analysis_id):
    """Stream the generated PDF report for download."""
    try:
        analysis = ImageAnalysis.objects.get(id=analysis_id)
    except ImageAnalysis.DoesNotExist:
        return JsonResponse({'error': 'Not found'}, status=404)

    if not analysis.report_pdf:
        return JsonResponse({'error': 'Report not ready'}, status=404)

    response = FileResponse(
        analysis.report_pdf.open('rb'), content_type='application/pdf'
    )
    response['Content-Disposition'] = (
        f'attachment; filename="aircrop-report-{analysis.id}.pdf"'
    )
    return response


def _sample_files():
    if not SAMPLE_IMAGES_DIR.exists():
        return []
    return sorted(
        p for p in SAMPLE_IMAGES_DIR.iterdir() if p.suffix.lower() in SAMPLE_IMAGE_SUFFIXES
    )


@require_http_methods(['GET'])
def list_samples(request):
    samples = [
        {
            'id': p.stem,
            'image_url': f'/api/samples/{p.stem}/image/',
        }
        for p in _sample_files()
    ]
    return JsonResponse({'samples': samples})


@require_http_methods(['GET'])
def sample_image(request, sample_id):
    for p in _sample_files():
        if p.stem == sample_id:
            return FileResponse(open(p, 'rb'), content_type='image/jpeg')
    return JsonResponse({'error': 'Not found'}, status=404)
