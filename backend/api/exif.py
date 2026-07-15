"""
EXIF extraction for uploaded crop photos.

Pulls the capture timestamp (DateTimeOriginal) and GPS coordinates from an
image's EXIF metadata using Pillow. EXIF is frequently missing or partial —
screenshots, downloads, and many processed images have it stripped — so every
function here degrades gracefully and returns ``None`` rather than raising.
The caller falls back to user-supplied values in that case.
"""

import logging
from datetime import datetime

from PIL import ExifTags, Image

logger = logging.getLogger(__name__)

# Tag-name -> numeric-id lookups, so we can read tags by their human names.
_TAG_IDS = {name: num for num, name in ExifTags.TAGS.items()}
_GPS_IDS = {name: num for num, name in ExifTags.GPSTAGS.items()}


def extract_metadata(image_path):
    """
    Returns a dict with any of ``captured_at`` (datetime), ``latitude`` and
    ``longitude`` (floats) that could be read from the image's EXIF. Missing
    values are simply absent from the dict. Never raises.
    """
    result = {}
    try:
        with Image.open(image_path) as img:
            exif = img.getexif()
    except Exception as exc:  # noqa: BLE001 - bad/unsupported files shouldn't break upload
        logger.debug('Could not read EXIF from %s: %s', image_path, exc)
        return result

    if not exif:
        return result

    captured_at = _read_datetime(exif)
    if captured_at is not None:
        result['captured_at'] = captured_at

    coords = _read_gps(exif)
    if coords is not None:
        result['latitude'], result['longitude'] = coords

    return result


def _read_datetime(exif):
    # DateTimeOriginal is the capture time; DateTime is a fallback (last edit).
    for tag_name in ('DateTimeOriginal', 'DateTime'):
        raw = exif.get(_TAG_IDS.get(tag_name))
        if not raw:
            continue
        try:
            # EXIF datetimes look like "2024:07:15 14:30:00".
            return datetime.strptime(str(raw), '%Y:%m:%d %H:%M:%S')
        except ValueError:
            continue
    return None


def _read_gps(exif):
    gps_ifd_id = _TAG_IDS.get('GPSInfo')
    if gps_ifd_id is None:
        return None

    try:
        gps = exif.get_ifd(gps_ifd_id)
    except Exception:  # noqa: BLE001
        gps = exif.get(gps_ifd_id)
    if not gps:
        return None

    lat = _to_decimal(
        gps.get(_GPS_IDS['GPSLatitude']), gps.get(_GPS_IDS['GPSLatitudeRef'])
    )
    lon = _to_decimal(
        gps.get(_GPS_IDS['GPSLongitude']), gps.get(_GPS_IDS['GPSLongitudeRef'])
    )
    if lat is None or lon is None:
        return None
    return lat, lon


def _to_decimal(dms, ref):
    """Convert EXIF degrees/minutes/seconds + hemisphere ref to a signed float."""
    if not dms or ref is None:
        return None
    try:
        degrees, minutes, seconds = (float(v) for v in dms)
    except (TypeError, ValueError):
        return None

    decimal = degrees + minutes / 60 + seconds / 3600
    if str(ref).upper() in ('S', 'W'):
        decimal = -decimal
    return round(decimal, 6)
