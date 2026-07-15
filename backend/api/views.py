import logging
import tempfile
import threading
from pathlib import Path

from django.core.files import File
from django.http import FileResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import ml
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
        analysis.status = ImageAnalysis.Status.DONE
        analysis.save(update_fields=update_fields)
    except Exception as exc:  # noqa: BLE001 - always record failure on the row
        ImageAnalysis.objects.filter(id=analysis_id).update(
            status=ImageAnalysis.Status.FAILED, error=str(exc)
        )


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
        'image_url': request.build_absolute_uri(analysis.image.url) if analysis.image else None,
        'annotated_image_url': (
            request.build_absolute_uri(analysis.annotated_image.url)
            if analysis.annotated_image
            else None
        ),
    }

    if analysis.status == ImageAnalysis.Status.DONE:
        data['report'] = analysis.report
        data['crop_health'] = analysis.crop_health
    elif analysis.status == ImageAnalysis.Status.FAILED:
        data['error'] = analysis.error

    return JsonResponse(data)


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
            'image_url': request.build_absolute_uri(f'/api/samples/{p.stem}/image/'),
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
