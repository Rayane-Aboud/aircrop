"""
Weather lookup via Open-Meteo (https://open-meteo.com).

Free, no API key, non-commercial use. Given a latitude/longitude/date this
returns a compact dict with temperature, humidity, rainfall and wind for that
day. Uses stdlib urllib only, so there's no extra dependency to install.

Two endpoints are used:
  * The historical archive (ERA5) for dates older than ~5 days.
  * The forecast API with ``past_days`` for very recent dates, because the
    archive lags real time by about 5 days.

Also exposes ``geocode()`` to turn a typed place name into coordinates, so the
manual-entry path works when the user types a location instead of a photo with
GPS EXIF.

Every function fails soft: on any network/parse error it returns ``None`` (or
an ``error`` marker) rather than raising, so weather is a best-effort add-on
that never blocks the core analysis.
"""

import json
import logging
import urllib.parse
import urllib.request
from datetime import date, timedelta

logger = logging.getLogger(__name__)

ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'

# Archive (ERA5) trails real time by ~5 days; within this window use forecast.
ARCHIVE_LAG_DAYS = 6
REQUEST_TIMEOUT_S = 10

_DAILY_VARS = [
    'temperature_2m_mean',
    'temperature_2m_max',
    'temperature_2m_min',
    'relative_humidity_2m_mean',
    'precipitation_sum',
    'wind_speed_10m_max',
]


def _get_json(url, params):
    query = urllib.parse.urlencode(params, doseq=True)
    full_url = f'{url}?{query}'
    req = urllib.request.Request(full_url, headers={'User-Agent': 'aircrop/1.0'})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
        return json.load(resp)


def geocode(name):
    """Resolve a place name to {latitude, longitude, location_name} or None."""
    if not name or not name.strip():
        return None
    try:
        data = _get_json(GEOCODE_URL, {'name': name.strip(), 'count': 1, 'format': 'json'})
    except Exception as exc:  # noqa: BLE001
        logger.warning('Geocoding failed for %r: %s', name, exc)
        return None

    results = data.get('results') or []
    if not results:
        return None

    top = results[0]
    label_parts = [top.get('name'), top.get('admin1'), top.get('country')]
    return {
        'latitude': top.get('latitude'),
        'longitude': top.get('longitude'),
        'location_name': ', '.join(p for p in label_parts if p),
    }


def get_weather(latitude, longitude, target_date):
    """
    Fetch daily weather for a coordinate on ``target_date`` (a date/datetime).

    Returns a dict like::

        {
            'date': '2026-06-01',
            'temperature_c': 24.3,
            'temperature_min_c': 18.1,
            'temperature_max_c': 30.2,
            'humidity_pct': 55.0,
            'rainfall_mm': 0.0,
            'wind_kmh': 12.4,
            'source': 'archive',
        }

    or ``None`` if coordinates/date are missing, the date is in the future, or
    the lookup fails.
    """
    if latitude is None or longitude is None or target_date is None:
        return None

    day = target_date.date() if hasattr(target_date, 'date') else target_date
    today = date.today()
    if day > today:
        return None  # can't get weather for a photo dated in the future

    iso_day = day.isoformat()
    use_forecast = (today - day) < timedelta(days=ARCHIVE_LAG_DAYS)

    params = {
        'latitude': latitude,
        'longitude': longitude,
        'daily': ','.join(_DAILY_VARS),
        'timezone': 'auto',
    }

    try:
        if use_forecast:
            # past_days covers the last N days including today.
            params['past_days'] = min(max((today - day).days + 1, 1), 92)
            params['forecast_days'] = 1
            data = _get_json(FORECAST_URL, params)
        else:
            params['start_date'] = iso_day
            params['end_date'] = iso_day
            data = _get_json(ARCHIVE_URL, params)
    except Exception as exc:  # noqa: BLE001
        logger.warning('Weather lookup failed for %s,%s @ %s: %s',
                       latitude, longitude, iso_day, exc)
        return None

    return _extract_day(data, iso_day, source='forecast' if use_forecast else 'archive')


def _extract_day(data, iso_day, source):
    daily = data.get('daily') or {}
    times = daily.get('time') or []
    if not times:
        return None

    # Forecast responses can span several days; find the row for our date.
    try:
        idx = times.index(iso_day)
    except ValueError:
        idx = len(times) - 1  # fall back to the last available day

    def val(key):
        arr = daily.get(key) or []
        return arr[idx] if idx < len(arr) else None

    return {
        'date': times[idx],
        'temperature_c': val('temperature_2m_mean'),
        'temperature_min_c': val('temperature_2m_min'),
        'temperature_max_c': val('temperature_2m_max'),
        'humidity_pct': val('relative_humidity_2m_mean'),
        'rainfall_mm': val('precipitation_sum'),
        'wind_kmh': val('wind_speed_10m_max'),
        'source': source,
    }
