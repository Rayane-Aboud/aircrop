import uuid

from django.db import models


class ImageAnalysis(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        DONE = 'done', 'Done'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ImageField(upload_to='crop_images/%Y/%m/%d/')
    annotated_image = models.ImageField(upload_to='crop_annotated/%Y/%m/%d/', null=True, blank=True)
    # Generated PDF report (annotated image + detailed report + weather + detections).
    report_pdf = models.FileField(upload_to='crop_reports/%Y/%m/%d/', null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    report = models.JSONField(null=True, blank=True)
    crop_health = models.JSONField(null=True, blank=True)

    # When/where the photo was taken. Auto-filled from EXIF when present,
    # otherwise supplied manually by the user on upload.
    captured_at = models.DateTimeField(null=True, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    location_name = models.CharField(max_length=255, null=True, blank=True)

    # Weather at that location/date, looked up from Open-Meteo (see weather.py).
    weather = models.JSONField(null=True, blank=True)

    error = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.id} ({self.status})'
