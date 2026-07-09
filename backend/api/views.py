import random
import threading
import time

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import ImageAnalysis


def _run_external_or_dummy_analysis(image_path):
    """
    Placeholder for a real crop-health API integration.

    To wire in a real service (e.g. Plant.id, Kindwise), replace the body
    of this function with an HTTP call to that API using `image_path`,
    and map its response onto the (report, crop_health) shape below.
    Until then, this returns realistic dummy data.
    """
    del image_path  # unused for now, kept for future real API call

    health_status = random.choice(['healthy', 'moderate_stress', 'disease_detected'])

    issues = []
    if health_status != 'healthy':
        issues = random.sample(
            ['nutrient_deficiency', 'leaf_blight', 'pest_damage', 'water_stress'],
            k=random.randint(1, 2),
        )

    crop_health = {
        'status': health_status,
        'confidence': round(random.uniform(0.75, 0.99), 2),
        'issues_detected': issues,
    }

    recommendations = {
        'healthy': ['Continue current watering and fertilization schedule.'],
        'moderate_stress': ['Increase monitoring frequency.', 'Check irrigation levels.'],
        'disease_detected': [
            'Isolate affected area if possible.',
            'Consult an agronomist.',
            'Consider targeted treatment.',
        ],
    }[health_status]

    report = {
        'summary': f"Analysis complete. Crop appears {health_status.replace('_', ' ')}.",
        'recommendations': recommendations,
        'source': 'dummy',
    }

    return report, crop_health


def _process_analysis(analysis_id):
    """Runs on a background thread so the upload request returns immediately."""
    try:
        analysis = ImageAnalysis.objects.get(id=analysis_id)
        analysis.status = ImageAnalysis.Status.PROCESSING
        analysis.save(update_fields=['status', 'updated_at'])

        # Simulated processing latency (stand-in for a real external API call).
        time.sleep(3)

        report, crop_health = _run_external_or_dummy_analysis(analysis.image.path)

        analysis.report = report
        analysis.crop_health = crop_health
        analysis.status = ImageAnalysis.Status.DONE
        analysis.save(update_fields=['report', 'crop_health', 'status', 'updated_at'])
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
    }

    if analysis.status == ImageAnalysis.Status.DONE:
        data['report'] = analysis.report
        data['crop_health'] = analysis.crop_health
    elif analysis.status == ImageAnalysis.Status.FAILED:
        data['error'] = analysis.error

    return JsonResponse(data)
