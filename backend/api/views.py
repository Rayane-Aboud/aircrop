import logging
import threading
from datetime import datetime
from pathlib import Path

from django.http import FileResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from accounts.permissions import IsAgronomistOrSuperAdmin

from . import exif, pipeline
from .models import ImageAnalysis, Land
from .serializers import LandSerializer, ReportListSerializer

logger = logging.getLogger(__name__)

SAMPLE_IMAGES_DIR = Path(__file__).resolve().parent / 'sample_images'
SAMPLE_IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png'}


# --------------------------------------------------------------------------
# Scoping helpers — every queryset is filtered by the caller's role.
# --------------------------------------------------------------------------
def scoped_lands(user):
    if user.is_super_admin:
        return Land.objects.all()
    if user.is_agronomist:
        return Land.objects.filter(agronomist=user)
    return Land.objects.filter(farmer=user)  # farmer


def scoped_analyses(user):
    qs = ImageAnalysis.objects.all()
    if user.is_super_admin:
        return qs
    if user.is_agronomist:
        return qs.filter(land__agronomist=user)
    return qs.filter(land__farmer=user)  # farmer


class LandViewSet(viewsets.ModelViewSet):
    serializer_class = LandSerializer

    def get_permissions(self):
        # Farmers may read their lands; only agronomists/admins mutate.
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated()]
        return [IsAgronomistOrSuperAdmin()]

    def get_queryset(self):
        qs = scoped_lands(self.request.user)
        farmer_id = self.request.query_params.get('farmer')
        if farmer_id:
            qs = qs.filter(farmer_id=farmer_id)
        return qs

    def perform_create(self, serializer):
        actor = self.request.user
        farmer = serializer.validated_data.get('farmer')
        if actor.is_agronomist:
            if farmer is None or farmer.managed_by_id != actor.id:
                raise PermissionDenied('You can only add lands for your own farmers.')
            serializer.save(agronomist=actor)
        elif actor.is_super_admin:
            # Super admin sets the managing agronomist from the farmer's owner.
            agronomist = getattr(farmer, 'managed_by', None) or actor
            serializer.save(agronomist=agronomist)
        else:
            raise PermissionDenied('Not allowed.')


class ReportViewSet(viewsets.ReadOnlyModelViewSet):
    """Report history, role-scoped. This is what farmers see."""

    serializer_class = ReportListSerializer

    def get_queryset(self):
        qs = scoped_analyses(self.request.user)
        land_id = self.request.query_params.get('land')
        if land_id:
            qs = qs.filter(land_id=land_id)
        return qs


# --------------------------------------------------------------------------
# Analysis pipeline endpoints (agronomist uploads for a land).
# --------------------------------------------------------------------------
def _parse_captured_at(raw):
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


def _analysis_payload(analysis):
    data = {
        'id': str(analysis.id),
        'status': analysis.status,
        'land': str(analysis.land_id) if analysis.land_id else None,
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
    return data


@api_view(['POST'])
@permission_classes([IsAgronomistOrSuperAdmin])
def analyze_image(request):
    image = request.FILES.get('image')
    if not image:
        return Response(
            {'error': 'No image file provided (expected multipart field "image").'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # A land must be supplied so the report is owned by a farmer.
    land_id = request.data.get('land') or request.data.get('land_id')
    if not land_id:
        return Response(
            {'error': 'A land id is required (field "land").'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        land = scoped_lands(request.user).get(id=land_id)
    except Land.DoesNotExist:
        return Response({'error': 'Land not found.'}, status=status.HTTP_404_NOT_FOUND)

    analysis = ImageAnalysis.objects.create(
        image=image, land=land, created_by=request.user
    )

    # Date & location: EXIF first, then manual overrides, then the land's own
    # coordinates as a final fallback so weather still resolves.
    meta = exif.extract_metadata(analysis.image.path)

    captured_at = _parse_captured_at(request.data.get('captured_at')) or meta.get('captured_at')
    if captured_at is not None and timezone.is_naive(captured_at):
        captured_at = timezone.make_aware(captured_at, timezone.get_current_timezone())

    manual_lat = _parse_float(request.data.get('latitude'))
    manual_lon = _parse_float(request.data.get('longitude'))

    analysis.captured_at = captured_at
    analysis.latitude = (
        manual_lat if manual_lat is not None else meta.get('latitude') or land.latitude
    )
    analysis.longitude = (
        manual_lon if manual_lon is not None else meta.get('longitude') or land.longitude
    )
    analysis.location_name = (
        (request.data.get('location_name') or '').strip()
        or land.location_name
        or None
    )
    analysis.save(update_fields=[
        'captured_at', 'latitude', 'longitude', 'location_name', 'updated_at',
    ])

    thread = threading.Thread(
        target=pipeline.process_analysis, args=(analysis.id,), daemon=True
    )
    thread.start()

    return Response(_analysis_payload(analysis), status=status.HTTP_202_ACCEPTED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def analysis_status(request, analysis_id):
    try:
        analysis = scoped_analyses(request.user).get(id=analysis_id)
    except ImageAnalysis.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(_analysis_payload(analysis))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def analysis_report_pdf(request, analysis_id):
    """Stream the generated PDF report for download (role-scoped)."""
    try:
        analysis = scoped_analyses(request.user).get(id=analysis_id)
    except ImageAnalysis.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    if not analysis.report_pdf:
        return Response({'error': 'Report not ready'}, status=status.HTTP_404_NOT_FOUND)

    response = FileResponse(analysis.report_pdf.open('rb'), content_type='application/pdf')
    response['Content-Disposition'] = (
        f'attachment; filename="aircrop-report-{analysis.id}.pdf"'
    )
    return response


# --------------------------------------------------------------------------
# Sample images (public — used by the upload UI).
# --------------------------------------------------------------------------
def _sample_files():
    if not SAMPLE_IMAGES_DIR.exists():
        return []
    return sorted(
        p for p in SAMPLE_IMAGES_DIR.iterdir() if p.suffix.lower() in SAMPLE_IMAGE_SUFFIXES
    )


@api_view(['GET'])
@permission_classes([AllowAny])
def list_samples(request):
    samples = [
        {'id': p.stem, 'image_url': f'/api/samples/{p.stem}/image/'}
        for p in _sample_files()
    ]
    return Response({'samples': samples})


@api_view(['GET'])
@permission_classes([AllowAny])
def sample_image(request, sample_id):
    for p in _sample_files():
        if p.stem == sample_id:
            return FileResponse(open(p, 'rb'), content_type='image/jpeg')
    return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
