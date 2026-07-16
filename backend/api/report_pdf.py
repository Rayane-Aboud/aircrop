"""
PDF crop-health report generation (reportlab).

Builds a professional, company-style report the committee can download,
containing:
  * a branded letterhead (Aircrop emblem + company block) and a report
    metadata block (report number, date, location),
  * a verdict banner (status / confidence / severity),
  * the capture context (date / location) and that day's weather,
  * the annotated image (YOLO bounding boxes),
  * the detailed (LLM or template) report — summary, findings,
    recommendations,
  * a raw detections table (class + confidence) for transparency,
  * a stamp & signature block (bilingual: الختم والتوقيع / Authorized Stamp
    & Signature) so it can be officially endorsed.

`build_report_pdf(...)` returns the PDF as bytes. It is defensive: any missing
piece (no annotated image, no weather, template report instead of LLM, missing
brand asset) simply renders less content rather than failing.

The Arabic stamp label is shipped as a pre-rendered PNG
(assets/stamp-label-ar.png) so no Arabic font/text-shaping is required at
runtime in the backend container.
"""

import io
import logging
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).resolve().parent / 'assets'
EMBLEM_PATH = ASSETS_DIR / 'aircrop-emblem.png'
STAMP_LABEL_AR_PATH = ASSETS_DIR / 'stamp-label-ar.png'

NAVY = colors.HexColor('#17323f')
LEAF = colors.HexColor('#2E7D46')
SLATE = colors.HexColor('#64748b')
LIGHT = colors.HexColor('#f1f5f9')
BORDER = colors.HexColor('#e2e8f0')

_SEVERITY_COLORS = {
    'none': colors.HexColor('#059669'),
    'low': colors.HexColor('#059669'),
    'moderate': colors.HexColor('#d97706'),
    'high': colors.HexColor('#dc2626'),
    'unknown': colors.HexColor('#475569'),
}

_STATUS_LABEL = {
    'healthy': 'Healthy',
    'stressed': 'Stressed',
    'no_detection': 'No plant detected',
}


def _styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='Brand', parent=styles['Title'], fontSize=26, leading=28,
        textColor=NAVY, alignment=TA_LEFT, spaceAfter=0,
    ))
    styles.add(ParagraphStyle(
        name='Tagline', parent=styles['Normal'], fontSize=8.5, leading=11,
        textColor=SLATE, alignment=TA_LEFT, spaceBefore=1,
    ))
    styles.add(ParagraphStyle(
        name='MetaLabel', parent=styles['Normal'], fontSize=8, leading=10,
        textColor=SLATE, alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name='MetaValue', parent=styles['Normal'], fontSize=9.5, leading=12,
        textColor=NAVY, alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name='ReportTitle', parent=styles['Title'], fontSize=17,
        textColor=NAVY, alignment=TA_LEFT, spaceBefore=6, spaceAfter=2,
    ))
    styles.add(ParagraphStyle(
        name='Sub', parent=styles['Normal'], fontSize=9,
        textColor=SLATE, spaceAfter=10,
    ))
    styles.add(ParagraphStyle(
        name='H2', parent=styles['Heading2'], fontSize=12,
        textColor=NAVY, spaceBefore=12, spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name='Body', parent=styles['Normal'], fontSize=10, leading=14,
        alignment=TA_LEFT, spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name='RptBullet', parent=styles['Normal'], fontSize=10, leading=14,
        leftIndent=12, bulletIndent=2, spaceAfter=2,
    ))
    styles.add(ParagraphStyle(
        name='StampCaption', parent=styles['Normal'], fontSize=8.5, leading=11,
        textColor=SLATE, alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name='SigLabel', parent=styles['Normal'], fontSize=9, leading=12,
        textColor=NAVY, alignment=TA_LEFT,
    ))
    return styles


def _report_number(analysis_id):
    """Human-friendly report number derived from the analysis UUID."""
    short = str(analysis_id).replace('-', '')[:8].upper()
    return f'AIR-{short}'


def _letterhead(styles, analysis_id, location_name):
    """Branded header: emblem + company block on the left, report meta right."""
    # Left brand cell (emblem + wordmark + tagline).
    if EMBLEM_PATH.exists():
        try:
            emblem = _fit_image(str(EMBLEM_PATH), max_w=2.4 * cm, max_h=1.9 * cm)
        except Exception:  # noqa: BLE001
            emblem = Paragraph('', styles['Body'])
    else:
        emblem = Paragraph('', styles['Body'])

    brand_block = [
        Paragraph('AIRCROP', styles['Brand']),
        Paragraph(
            'AI-Powered Crop Health Diagnostics<br/>'
            'Precision agriculture &bull; Drone imagery analysis',
            styles['Tagline'],
        ),
    ]

    generated = datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
    meta_lines = [
        Paragraph('CROP HEALTH REPORT', styles['MetaLabel']),
        Paragraph(f'<b>No.</b> {_report_number(analysis_id)}', styles['MetaValue']),
        Paragraph(f'<b>Issued</b> {generated}', styles['MetaValue']),
    ]
    if location_name:
        meta_lines.append(Paragraph(f'<b>Site</b> {location_name}', styles['MetaValue']))

    header = Table(
        [[emblem, brand_block, meta_lines]],
        colWidths=[2.7 * cm, 8.7 * cm, 6.0 * cm],
    )
    header.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('VALIGN', (0, 0), (0, 0), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return header


def _stamp_footer(styles):
    """Signature line (left) + bordered stamp box (right, bilingual label)."""
    # Left: prepared-by signature line.
    sig_cell = [
        Spacer(1, 26),
        HRFlowable(width='80%', thickness=0.7, color=NAVY,
                   spaceBefore=0, spaceAfter=3, hAlign='LEFT'),
        Paragraph('Prepared / Inspected by', styles['SigLabel']),
        Paragraph('Name &amp; title', styles['StampCaption']),
    ]

    # Right: stamp box with the Arabic label image on top.
    stamp_inner = []
    if STAMP_LABEL_AR_PATH.exists():
        try:
            stamp_inner.append(_fit_image(
                str(STAMP_LABEL_AR_PATH), max_w=4.2 * cm, max_h=1.1 * cm,
                h_align='CENTER',
            ))
        except Exception:  # noqa: BLE001
            pass
    stamp_inner.append(Spacer(1, 30))
    stamp_inner.append(Paragraph('Authorized Stamp &amp; Signature', styles['StampCaption']))

    stamp_box = Table([[stamp_inner]], colWidths=[6.0 * cm])
    stamp_box.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.8, NAVY),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ]))

    footer = Table([[sig_cell, stamp_box]], colWidths=[8.4 * cm, 6.4 * cm])
    footer.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
        ('LEFTPADDING', (0, 0), (0, 0), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
    ]))
    return footer


def build_report_pdf(
    analysis_id,
    crop_health,
    report,
    annotated_image_path=None,
    weather=None,
    captured_at=None,
    location_name=None,
    latitude=None,
    longitude=None,
):
    """Render the report to PDF bytes. Never raises on missing optional data."""
    styles = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.8 * cm, rightMargin=1.8 * cm,
        topMargin=1.4 * cm, bottomMargin=1.4 * cm,
        title=f'Aircrop Crop Health Report {_report_number(analysis_id)}',
        author='Aircrop',
    )
    story = []

    # --- Branded letterhead ---
    story.append(_letterhead(styles, analysis_id, location_name))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width='100%', thickness=1.4, color=NAVY,
                            spaceBefore=0, spaceAfter=2))
    story.append(HRFlowable(width='100%', thickness=0.5, color=LEAF,
                            spaceBefore=0, spaceAfter=4))

    # --- Title ---
    story.append(Paragraph('Crop Health Analysis Report', styles['ReportTitle']))
    story.append(Paragraph(
        f'Analysis reference: {analysis_id}', styles['Sub'],
    ))

    # --- Verdict banner ---
    status = (crop_health or {}).get('status', 'unknown')
    confidence = (crop_health or {}).get('confidence', 0) or 0
    label = _STATUS_LABEL.get(status, status)
    severity = (report or {}).get('severity', 'unknown')
    verdict_rows = [[
        Paragraph(f'<b>Status:</b> {label}', styles['Body']),
        Paragraph(f'<b>Confidence:</b> {confidence * 100:.0f}%', styles['Body']),
        Paragraph(f'<b>Severity:</b> {severity.capitalize()}', styles['Body']),
    ]]
    verdict = Table(verdict_rows, colWidths=[6 * cm, 5 * cm, 5 * cm])
    verdict.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.5, BORDER),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TEXTCOLOR', (2, 0), (2, 0), _SEVERITY_COLORS.get(severity, colors.black)),
    ]))
    story.append(verdict)

    # --- Capture context + weather ---
    context_bits = _context_lines(captured_at, location_name, latitude, longitude)
    if context_bits:
        story.append(Paragraph('Capture Context', styles['H2']))
        for line in context_bits:
            story.append(Paragraph(line, styles['Body']))

    if weather:
        story.append(Paragraph('Weather on capture date', styles['H2']))
        story.append(Paragraph(_weather_line(weather), styles['Body']))

    # --- Annotated image ---
    if annotated_image_path:
        try:
            img = _fit_image(str(annotated_image_path), max_w=15 * cm, max_h=10 * cm)
            story.append(Paragraph('Annotated Image', styles['H2']))
            story.append(img)
        except Exception as exc:  # noqa: BLE001
            logger.warning('Could not embed annotated image: %s', exc)

    # --- Detailed report ---
    if report:
        summary = report.get('summary')
        if summary:
            story.append(Paragraph('Summary', styles['H2']))
            story.append(Paragraph(summary, styles['Body']))

        findings = report.get('detailed_findings')
        if findings:
            story.append(Paragraph('Detailed Findings', styles['H2']))
            for para in findings.split('\n'):
                if para.strip():
                    story.append(Paragraph(para.strip(), styles['Body']))

        recs = report.get('recommendations') or []
        if recs:
            story.append(Paragraph('Recommendations', styles['H2']))
            for rec in recs:
                story.append(Paragraph(f'&bull;&nbsp; {rec}', styles['RptBullet']))

        note = report.get('confidence_note')
        if note:
            story.append(Spacer(1, 6))
            story.append(Paragraph(f'<i>{note}</i>', styles['Sub']))

    # --- Raw detections table ---
    detections = (report or {}).get('detections') or (crop_health or {}).get('detections') or []
    if detections:
        story.append(Paragraph('Raw Detections', styles['H2']))
        story.append(_detections_table(detections))

    # --- Footer note about source ---
    source = (report or {}).get('source', '')
    if source == 'dummy':
        story.append(Spacer(1, 8))
        story.append(Paragraph(
            '<i>Note: generated with placeholder analysis (model unavailable).</i>',
            styles['Sub'],
        ))

    # --- Stamp & signature block ---
    story.append(Spacer(1, 18))
    story.append(HRFlowable(width='100%', thickness=0.5, color=BORDER,
                            spaceBefore=0, spaceAfter=10))
    story.append(_stamp_footer(styles))

    doc.build(story)
    return buf.getvalue()


def _context_lines(captured_at, location_name, latitude, longitude):
    lines = []
    if captured_at:
        lines.append(f'<b>Captured:</b> {captured_at}')
    if location_name:
        lines.append(f'<b>Location:</b> {location_name}')
    elif latitude is not None and longitude is not None:
        lines.append(f'<b>Coordinates:</b> {latitude:.4f}, {longitude:.4f}')
    return lines


def _weather_line(weather):
    bits = []
    if weather.get('temperature_c') is not None:
        bits.append(f"{weather['temperature_c']:.1f}\u00b0C avg")
    if weather.get('temperature_min_c') is not None and weather.get('temperature_max_c') is not None:
        bits.append(f"{weather['temperature_min_c']:.0f}\u2013{weather['temperature_max_c']:.0f}\u00b0C range")
    if weather.get('humidity_pct') is not None:
        bits.append(f"{weather['humidity_pct']:.0f}% humidity")
    if weather.get('rainfall_mm') is not None:
        bits.append(f"{weather['rainfall_mm']:.1f} mm rain")
    if weather.get('wind_kmh') is not None:
        bits.append(f"{weather['wind_kmh']:.0f} km/h wind")
    prefix = f"{weather.get('date', '')}: " if weather.get('date') else ''
    return prefix + (', '.join(bits) if bits else 'no data')


def _detections_table(detections):
    header = ['#', 'Class', 'Confidence']
    rows = [header]
    for i, d in enumerate(detections, start=1):
        conf = d.get('confidence')
        conf_str = f'{conf * 100:.1f}%' if isinstance(conf, (int, float)) else '-'
        rows.append([str(i), str(d.get('class_name', d.get('class', '-'))), conf_str])

    table = Table(rows, colWidths=[1.5 * cm, 6 * cm, 4 * cm], hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.4, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    return table


def _fit_image(path, max_w, max_h, h_align='LEFT'):
    """Return a reportlab Image scaled to fit within max_w x max_h, keeping ratio."""
    from PIL import Image as PILImage

    with PILImage.open(path) as im:
        w, h = im.size
    ratio = min(max_w / w, max_h / h)
    img = RLImage(path, width=w * ratio, height=h * ratio)
    img.hAlign = h_align
    return img
