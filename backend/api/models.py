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

    # Field boundary as a GeoJSON polygon (WGS84 lon/lat) — the canonical
    # geometry. ``area_hectares`` and lat/lon (centroid) are derived from it on
    # save (see api/geo.py). Stored as JSON now; a future PostGIS PolygonField
    # can be backfilled straight from this without changing the API.
    boundary = models.JSONField(null=True, blank=True)
    boundary_updated_at = models.DateTimeField(null=True, blank=True)

    # The WebODM project holding this land's orthomosaic tasks (api/webodm.py).
    # Created lazily on the first run.
    webodm_project_id = models.IntegerField(null=True, blank=True)

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


class OrthomosaicTask(models.Model):
    """
    One WebODM processing run for a land: overlapping drone photos stitched
    into a georeferenced orthophoto (and, with the full preset, DSM/DTM and a
    3D model).

    WebODM owns the processing and the outputs; this row mirrors its state so
    lists stay role-scoped and fast. It's re-synced lazily from WebODM when
    someone reads a task that isn't finished yet (see api/orthomosaic.py).
    """

    class Status(models.TextChoices):
        UPLOADING = 'uploading', 'Uploading'
        QUEUED = 'queued', 'Queued'
        RUNNING = 'running', 'Processing'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'
        CANCELED = 'canceled', 'Canceled'

    class Preset(models.TextChoices):
        FAST = 'fast', 'Fast orthophoto'
        FULL = 'full', 'Full 3D'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    land = models.ForeignKey(
        Land,
        on_delete=models.CASCADE,
        related_name='orthomosaics',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_orthomosaics',
    )
    name = models.CharField(max_length=255)
    preset = models.CharField(max_length=10, choices=Preset.choices, default=Preset.FAST)

    webodm_project_id = models.IntegerField()
    webodm_task_id = models.CharField(max_length=64)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.UPLOADING)
    # 0–100, from WebODM's running_progress.
    progress = models.FloatField(default=0)
    image_count = models.PositiveIntegerField(default=0)
    # Names WebODM reports as downloadable (orthophoto.tif, all.zip, …).
    available_assets = models.JSONField(default=list, blank=True)
    # From the orthophoto tiles.json: [west, south, east, north] + zoom range.
    orthophoto_bounds = models.JSONField(null=True, blank=True)
    orthophoto_minzoom = models.PositiveSmallIntegerField(null=True, blank=True)
    orthophoto_maxzoom = models.PositiveSmallIntegerField(null=True, blank=True)
    processing_time_ms = models.BigIntegerField(null=True, blank=True)

    error = models.TextField(blank=True)
    synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.status})'

    @property
    def is_finished(self):
        return self.status in (
            self.Status.COMPLETED, self.Status.FAILED, self.Status.CANCELED,
        )
