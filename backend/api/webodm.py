"""
Thin client for a WebODM server (https://github.com/WebODM/WebODM).

WebODM runs as its own service (its docker-compose: webapp, worker, db,
broker and a NodeODM processing node). Aircrop never shares a database or
users with it: the backend authenticates with one service account
(``WEBODM_USERNAME`` / ``WEBODM_PASSWORD``) and drives the REST API on behalf
of its own users. Each Aircrop ``Land`` maps to one WebODM project; each
orthomosaic run maps to one WebODM task.

Uploads use WebODM's partial-task flow (create with ``partial`` → upload image
batches → commit), so a survey with hundreds of photos never has to fit in a
single HTTP request.

Every call raises ``WebODMError`` on failure; callers turn that into a 502.
"""

import json
import logging
import threading
import time

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_S = 30
# Image batches can be tens of MB; give the upload leg more headroom.
UPLOAD_TIMEOUT_S = 300
# WebODM JWTs last 6h by default; renew well before that.
TOKEN_TTL_S = 5 * 60 * 60

# WebODM task status codes (app/models/task.py → StatusCodes).
STATUS_QUEUED = 10
STATUS_RUNNING = 20
STATUS_FAILED = 30
STATUS_COMPLETED = 40
STATUS_CANCELED = 50

# Processing presets exposed in the UI → ODM options.
PRESETS = {
    # 2D only: skips the 3D mesh. Much faster; ideal for crop scouting maps.
    'fast': [{'name': 'fast-orthophoto', 'value': True}],
    # Full pipeline: orthophoto + DSM/DTM + point cloud + textured model.
    'full': [{'name': 'dsm', 'value': True}, {'name': 'dtm', 'value': True}],
}


class WebODMError(Exception):
    """Any failure talking to WebODM (network, auth, or an API error)."""


class ProjectMissing(WebODMError):
    """The mapped WebODM project was deleted on the WebODM side."""


def is_configured():
    return bool(settings.WEBODM_URL and settings.WEBODM_USERNAME)


_token_lock = threading.Lock()
_token = {'value': None, 'issued_at': 0.0}


def _url(path):
    return f"{settings.WEBODM_URL.rstrip('/')}{path}"


def _get_token(force=False):
    with _token_lock:
        fresh = time.monotonic() - _token['issued_at'] < TOKEN_TTL_S
        if _token['value'] and fresh and not force:
            return _token['value']
        try:
            res = requests.post(
                _url('/api/token-auth/'),
                data={
                    'username': settings.WEBODM_USERNAME,
                    'password': settings.WEBODM_PASSWORD,
                },
                timeout=REQUEST_TIMEOUT_S,
            )
        except requests.RequestException as exc:
            raise WebODMError(f'WebODM is unreachable: {exc}') from exc
        if res.status_code != 200 or 'token' not in res.json():
            raise WebODMError('WebODM rejected the service-account credentials.')
        _token['value'] = res.json()['token']
        _token['issued_at'] = time.monotonic()
        return _token['value']


def _request(method, path, *, timeout=REQUEST_TIMEOUT_S, stream=False, **kwargs):
    """Authenticated request; re-authenticates once if the token was rejected."""
    if not is_configured():
        raise WebODMError('WebODM is not configured (set WEBODM_URL).')
    for attempt in range(2):
        headers = {'Authorization': f'JWT {_get_token(force=attempt > 0)}'}
        try:
            res = requests.request(
                method, _url(path), headers=headers, timeout=timeout,
                stream=stream, **kwargs,
            )
        except requests.RequestException as exc:
            raise WebODMError(f'WebODM is unreachable: {exc}') from exc
        if res.status_code not in (401, 403):
            return res
    return res


def _json_or_raise(res, what):
    if res.status_code >= 400:
        detail = res.text[:300]
        raise WebODMError(f'{what} failed ({res.status_code}): {detail}')
    return res.json()


# --------------------------------------------------------------------------
# Projects & tasks
# --------------------------------------------------------------------------
def create_project(name, description=''):
    res = _request('POST', '/api/projects/', data={'name': name, 'description': description})
    return _json_or_raise(res, 'Creating WebODM project')['id']


def create_partial_task(project_id, name, preset='fast'):
    """Open a task that accepts image batches until ``commit_task``."""
    res = _request(
        'POST',
        f'/api/projects/{project_id}/tasks/',
        data={
            'name': name,
            'partial': 'true',
            'options': json.dumps(PRESETS.get(preset, PRESETS['fast'])),
        },
    )
    if res.status_code == 404:
        raise ProjectMissing(project_id)
    return _json_or_raise(res, 'Creating WebODM task')['id']


def upload_images(project_id, task_id, files):
    """Forward a batch of uploaded files (Django UploadedFile) to the task."""
    payload = [
        ('images', (f.name, f, getattr(f, 'content_type', None) or 'image/jpeg'))
        for f in files
    ]
    res = _request(
        'POST',
        f'/api/projects/{project_id}/tasks/{task_id}/upload/',
        files=payload,
        timeout=UPLOAD_TIMEOUT_S,
    )
    return _json_or_raise(res, 'Uploading images to WebODM')


def commit_task(project_id, task_id):
    res = _request('POST', f'/api/projects/{project_id}/tasks/{task_id}/commit/')
    return _json_or_raise(res, 'Starting WebODM processing')


def get_task(project_id, task_id):
    res = _request('GET', f'/api/projects/{project_id}/tasks/{task_id}/')
    return _json_or_raise(res, 'Reading WebODM task')


def orthophoto_tilejson(project_id, task_id):
    res = _request(
        'GET', f'/api/projects/{project_id}/tasks/{task_id}/orthophoto/tiles.json'
    )
    return _json_or_raise(res, 'Reading orthophoto tiles')


# --------------------------------------------------------------------------
# Streamed passthroughs (downloads + map tiles)
# --------------------------------------------------------------------------
def open_asset(project_id, task_id, asset):
    """Streaming response for a task asset (orthophoto.tif, all.zip, …)."""
    res = _request(
        'GET',
        f'/api/projects/{project_id}/tasks/{task_id}/download/{asset}',
        timeout=REQUEST_TIMEOUT_S,
        stream=True,
    )
    if res.status_code >= 400:
        res.close()
        raise WebODMError(f'Downloading {asset} failed ({res.status_code}).')
    return res


def get_tile(project_id, task_id, z, x, y):
    """One orthophoto PNG tile, or ``None`` when the tile is outside the map."""
    res = _request(
        'GET',
        f'/api/projects/{project_id}/tasks/{task_id}/orthophoto/tiles/{z}/{x}/{y}.png',
    )
    if res.status_code == 404:
        return None
    if res.status_code >= 400:
        raise WebODMError(f'Tile fetch failed ({res.status_code}).')
    return res.content
