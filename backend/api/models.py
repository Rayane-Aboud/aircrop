import uuid

from django.conf import settings
from django.db import models


class Land(models.Model):
    """
    A plot/field belonging to a farmer and managed by an agronomist.

    Reports (ImageAnalysis rows) are attached to a Land, which is how a report
    ends up owned by a specific farmer and visible to their agronomist.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)

    # The farmer who owns this land. The managing agronomist is derived from
    # farmer.managed_by, but we also store agronomist explicitly so scoping
    # queries stay a single hop and survive a farmer being re-assigned.
    farmer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='lands',
    )
    agronomist = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='managed_lands',
    )

    area_hectares = models.FloatField(null=True, blank=True)
    crop_type = models.CharField(max_length=120, blank=True)
    location_name = models.CharField(max_length=255, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class ImageAnalysis(models.Model):
    """
    A crop-health *survey* and its generated report.

    A survey groups one or more drone images (see ``AnalysisImage``). The
    per-image YOLO detections are aggregated into this row's ``crop_health``
    and ``report`` (the overall verdict) plus a single PDF. The ``image`` /
    ``annotated_image`` fields hold the *primary* (first) image so older code,
    thumbnails and single-image reports keep working unchanged.
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        DONE = 'done', 'Done'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Ownership. Null on legacy/anonymous rows created before auth existed.
    land = models.ForeignKey(
        Land,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='reports',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_reports',
    )

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


class AnalysisImage(models.Model):
    """
    One drone image belonging to a survey (``ImageAnalysis``).

    Each image is run through YOLO independently; its ``detections`` and
    per-image ``crop_health`` are stored here, then aggregated up onto the
    parent survey. ``order`` preserves upload order (0 = primary image).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    analysis = models.ForeignKey(
        ImageAnalysis,
        on_delete=models.CASCADE,
        related_name='images',
    )
    image = models.ImageField(upload_to='crop_images/%Y/%m/%d/')
    annotated_image = models.ImageField(
        upload_to='crop_annotated/%Y/%m/%d/', null=True, blank=True
    )
    detections = models.JSONField(null=True, blank=True)
    crop_health = models.JSONField(null=True, blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'created_at']

    def __str__(self):
        return f'{self.analysis_id} · image {self.order}'
