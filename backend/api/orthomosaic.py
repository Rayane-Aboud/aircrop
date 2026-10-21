"""
Orthomosaic runs: the glue between Aircrop lands and WebODM tasks.

WebODM does the processing (api/webodm.py is the HTTP client). This module
maps a Land to its WebODM project, mirrors task state onto
``OrthomosaicTask`` rows, and signs the tile/download URLs handed to the
browser. Leaflet's tile requests and plain download links can't carry a
Bearer header, so those URLs carry a short-lived signed token instead, issued
only to users who can already see the task.

There's no worker: state is pulled from WebODM when someone reads a task that
isn't finished (throttled by ``SYNC_INTERVAL``), which the UI does by polling.
"""

import logging
from datetime import timedelta

from django.core import signing
from django.utils import timezone

from . import webodm
from .models import OrthomosaicTask

logger = logging.getLogger(__name__)

SYNC_INTERVAL = timedelta(seconds=5)
ACCESS_SALT = 'aircrop.orthomosaic.access'
ACCESS_MAX_AGE_S = 12 * 60 * 60

_WEBODM_STATUS = {
    None: OrthomosaicTask.Status.QUEUED,  # committed, waiting for a node
    webodm.STATUS_QUEUED: OrthomosaicTask.Status.QUEUED,
    webodm.STATUS_RUNNING: OrthomosaicTask.Status.RUNNING,
    webodm.STATUS_FAILED: OrthomosaicTask.Status.FAILED,
    webodm.STATUS_COMPLETED: OrthomosaicTask.Status.COMPLETED,
    webodm.STATUS_CANCELED: OrthomosaicTask.Status.CANCELED,
}


# --------------------------------------------------------------------------
# Lifecycle
# --------------------------------------------------------------------------
def _ensure_project(land):
    if land.webodm_project_id is None:
        land.webodm_project_id = webodm.create_project(
            f'Aircrop · {land.name}', description=f'Aircrop land {land.id}'
        )
        land.save(update_fields=['webodm_project_id', 'updated_at'])
    return land.webodm_project_id


def start_task(land, user, name, preset):
    """Open a partial WebODM task for ``land``; images are uploaded next."""
    project_id = _ensure_project(land)
    try:
        task_id = webodm.create_partial_task(project_id, name, preset)
    except webodm.ProjectMissing:
        # Project deleted inside WebODM — forget it and make a fresh one.
        land.webodm_project_id = None
        project_id = _ensure_project(land)
        task_id = webodm.create_partial_task(project_id, name, preset)

    return OrthomosaicTask.objects.create(
        land=land,
        created_by=user,
        name=name,
        preset=preset,
        webodm_project_id=project_id,
        webodm_task_id=str(task_id),
    )


def add_images(task, files):
    webodm.upload_images(task.webodm_project_id, task.webodm_task_id, files)
    # F() would race-proof this, but batches are sent sequentially by one client.
    task.image_count += len(files)
    task.save(update_fields=['image_count', 'updated_at'])


def commit(task):
    webodm.commit_task(task.webodm_project_id, task.webodm_task_id)
    task.status = OrthomosaicTask.Status.QUEUED
    task.save(update_fields=['status', 'updated_at'])


def sync(task, force=False):
    """
    Pull the latest state from WebODM onto ``task``. Fail-soft: if WebODM is
    unreachable the row keeps its last known state.
    """
    if task.is_finished or task.status == OrthomosaicTask.Status.UPLOADING:
        return task
    if not force and task.synced_at and timezone.now() - task.synced_at < SYNC_INTERVAL:
        return task

    try:
        info = webodm.get_task(task.webodm_project_id, task.webodm_task_id)
    except webodm.WebODMError as exc:
        logger.warning('Orthomosaic %s: sync failed: %s', task.id, exc)
        return task

    task.status = _WEBODM_STATUS.get(info.get('status'), task.status)
    task.progress = round(float(info.get('running_progress') or 0) * 100, 1)
    task.image_count = info.get('images_count') or task.image_count
    task.available_assets = info.get('available_assets') or []
    task.processing_time_ms = info.get('processing_time')
    if task.status == OrthomosaicTask.Status.FAILED:
        task.error = info.get('last_error') or 'Processing failed.'
    if task.status == OrthomosaicTask.Status.COMPLETED:
        task.progress = 100
        _attach_tilejson(task)
    task.synced_at = timezone.now()
    task.save()
    return task


def _attach_tilejson(task):
    if 'orthophoto.tif' not in task.available_assets:
        return
    try:
        tj = webodm.orthophoto_tilejson(task.webodm_project_id, task.webodm_task_id)
    except webodm.WebODMError as exc:
        logger.warning('Orthomosaic %s: no tiles.json: %s', task.id, exc)
        return
    task.orthophoto_bounds = tj.get('bounds')
    task.orthophoto_minzoom = tj.get('minzoom')
    task.orthophoto_maxzoom = tj.get('maxzoom')


# --------------------------------------------------------------------------
# Signed access for tiles + downloads
# --------------------------------------------------------------------------
def access_token(task):
    return signing.dumps(str(task.id), salt=ACCESS_SALT)


def check_access_token(task_id, token):
    try:
        value = signing.loads(token or '', salt=ACCESS_SALT, max_age=ACCESS_MAX_AGE_S)
    except signing.BadSignature:
        return False
    return value == str(task_id)


def payload(task):
    base = f'/api/orthomosaics/{task.id}'
    data = {
        'id': str(task.id),
        'land': str(task.land_id),
        'name': task.name,
        'preset': task.preset,
        'status': task.status,
        'status_label': task.get_status_display(),
        'progress': task.progress,
        'image_count': task.image_count,
        'processing_time_ms': task.processing_time_ms,
        'error': task.error or None,
        'created_at': task.created_at.isoformat(),
        'assets': [],
        'orthophoto': None,
    }
    if task.status == OrthomosaicTask.Status.COMPLETED:
        sig = access_token(task)
        data['assets'] = [
            {'name': a, 'url': f'{base}/download/{a}?sig={sig}'}
            for a in task.available_assets
        ]
        if task.orthophoto_bounds:
            data['orthophoto'] = {
                'bounds': task.orthophoto_bounds,
                'minzoom': task.orthophoto_minzoom,
                'maxzoom': task.orthophoto_maxzoom,
                'tiles_url': f'{base}/tiles/{{z}}/{{x}}/{{y}}.png?sig={sig}',
            }
    return data
