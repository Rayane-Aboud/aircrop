"""
YOLO-based crop health detection.

Wraps a custom-trained Ultralytics YOLO model (2 classes: 'healthy',
'stressed') and exposes `analyze_with_yolo()` for use by the async
analysis pipeline in views.py.

The model is loaded lazily (on first use) and cached in-process, since
`ultralytics`/`torch` are slow to import and we only have one worker
process per pod. If the model or its dependencies aren't available,
`ModelUnavailable` is raised so callers can fall back to other behavior.
"""

import logging
import threading

from django.conf import settings

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.25

_model = None
_model_lock = threading.Lock()


class ModelUnavailable(Exception):
    """Raised when the YOLO model can't be loaded or inference fails."""


def _get_model():
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is None:
            try:
                from ultralytics import YOLO
            except ImportError as exc:
                raise ModelUnavailable(f'ultralytics is not installed: {exc}') from exc

            model_path = settings.YOLO_MODEL_PATH
            if not model_path.exists():
                raise ModelUnavailable(f'model weights not found at {model_path}')

            try:
                _model = YOLO(str(model_path))
            except Exception as exc:  # noqa: BLE001
                raise ModelUnavailable(f'failed to load model: {exc}') from exc

    return _model


def analyze_with_yolo(image_path, annotated_output_path):
    """
    Runs the crop-health YOLO model on the image at `image_path`.

    Saves an annotated (bounding-box) copy of the image to
    `annotated_output_path` and returns (report: dict, crop_health: dict).

    Raises ModelUnavailable if the model/dependencies can't be loaded or
    inference fails, so the caller can fall back to dummy data.
    """
    model = _get_model()

    try:
        results = model.predict(
            source=str(image_path),
            conf=CONFIDENCE_THRESHOLD,
            save=False,
            verbose=False,
        )
        result = results[0]

        detections = [
            {
                'class_name': result.names[int(box.cls[0])],
                'confidence': round(float(box.conf[0]), 3),
            }
            for box in result.boxes
        ]

        from PIL import Image

        annotated_bgr = result.plot()  # numpy array, BGR channel order
        Image.fromarray(annotated_bgr[..., ::-1]).save(annotated_output_path)
    except Exception as exc:  # noqa: BLE001
        raise ModelUnavailable(f'inference failed: {exc}') from exc

    crop_health = _summarize_health(detections)
    report = _build_report(crop_health, detections, source='yolo')
    return report, crop_health


def dummy_analysis():
    """Fallback used when the real model is unavailable (e.g. missing weights)."""
    import random

    status = random.choice(['healthy', 'stressed'])
    detections = [
        {'class_name': status, 'confidence': round(random.uniform(0.75, 0.99), 3)}
    ]
    crop_health = _summarize_health(detections)
    report = _build_report(crop_health, detections, source='dummy')
    return report, crop_health


def summarize_health(detections):
    """Public alias — aggregate a flat list of detections into a verdict."""
    return _summarize_health(detections)


def build_report(crop_health, detections, source='yolo'):
    """Public alias — build the templated report dict from a verdict."""
    return _build_report(crop_health, detections, source)


def _summarize_health(detections):
    if not detections:
        return {
            'status': 'no_detection',
            'confidence': 0.0,
            'issues_detected': [],
            'healthy_regions': 0,
            'stressed_regions': 0,
        }

    healthy = [d for d in detections if d['class_name'] == 'healthy']
    stressed = [d for d in detections if d['class_name'] == 'stressed']

    status = 'stressed' if stressed else 'healthy'
    relevant = stressed if stressed else healthy
    confidence = round(sum(d['confidence'] for d in relevant) / len(relevant), 3)

    return {
        'status': status,
        'confidence': confidence,
        'issues_detected': ['stressed'] if stressed else [],
        'healthy_regions': len(healthy),
        'stressed_regions': len(stressed),
    }


def _build_report(crop_health, detections, source):
    status = crop_health['status']

    if status == 'no_detection':
        summary = 'No plant regions were confidently detected in this image.'
        recommendations = ['Try a clearer, closer photo of the plant or leaves.']
    elif status == 'stressed':
        summary = (
            f"Detected {crop_health['stressed_regions']} stressed region(s) "
            f"and {crop_health['healthy_regions']} healthy region(s)."
        )
        recommendations = [
            'Inspect the flagged areas closely for pests, disease, or water stress.',
            'Increase monitoring frequency over the next few days.',
            'Consider consulting an agronomist if stress spreads.',
        ]
    else:
        summary = f"All {crop_health['healthy_regions']} detected region(s) appear healthy."
        recommendations = ['Continue current watering and fertilization schedule.']

    return {
        'summary': summary,
        'recommendations': recommendations,
        'detections': detections,
        'source': source,
    }
