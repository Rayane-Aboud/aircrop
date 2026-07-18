"""
Small, dependency-free geometry helpers for land boundaries.

Boundaries are stored as GeoJSON (WGS84 lon/lat) on ``Land.boundary`` — the
canonical source of truth. These helpers derive an area (hectares) and a
centroid from that GeoJSON so we can auto-fill ``area_hectares`` and the land's
location point without a spatial database.

Scalability note: keeping the geometry as GeoJSON means a later move to PostGIS
is a straight backfill — read ``boundary`` and populate a ``PolygonField`` —
without changing the API contract the frontend depends on.
"""

import math

# WGS84 mean radius (metres). Good enough for field-sized polygons.
EARTH_RADIUS_M = 6378137.0


def _exterior_ring(boundary):
    """Return the exterior ring (list of [lon, lat]) of a GeoJSON polygon."""
    if not isinstance(boundary, dict):
        return None
    geom = boundary
    gtype = boundary.get('type')
    if gtype == 'Feature':
        geom = boundary.get('geometry') or {}
        gtype = geom.get('type')
    if gtype == 'Polygon':
        rings = geom.get('coordinates') or []
        return rings[0] if rings else None
    if gtype == 'MultiPolygon':
        polys = geom.get('coordinates') or []
        return polys[0][0] if polys and polys[0] else None
    return None


def _clean(ring):
    """Coerce to float pairs and drop the GeoJSON closing-vertex duplicate."""
    pts = []
    for p in ring or []:
        try:
            pts.append((float(p[0]), float(p[1])))
        except (TypeError, ValueError, IndexError):
            continue
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def polygon_area_hectares(boundary):
    """
    Spherical polygon area in hectares, or None if the geometry is unusable.

    Uses the standard spherical-excess approximation — accurate to well under a
    percent at the scale of a farm plot.
    """
    pts = _clean(_exterior_ring(boundary))
    if len(pts) < 3:
        return None
    total = 0.0
    n = len(pts)
    for i in range(n):
        lon1, lat1 = pts[i]
        lon2, lat2 = pts[(i + 1) % n]
        total += math.radians(lon2 - lon1) * (
            2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2))
        )
    area_m2 = abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0)
    return round(area_m2 / 10000.0, 4)


def polygon_centroid(boundary):
    """
    Area-weighted centroid as ``(latitude, longitude)``, or None.

    Falls back to the vertex average for degenerate rings.
    """
    pts = _clean(_exterior_ring(boundary))
    if not pts:
        return None
    if len(pts) < 3:
        return (
            sum(p[1] for p in pts) / len(pts),
            sum(p[0] for p in pts) / len(pts),
        )

    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if a == 0:
        return (sum(p[1] for p in pts) / n, sum(p[0] for p in pts) / n)
    a *= 0.5
    cx /= 6 * a
    cy /= 6 * a
    return (round(cy, 6), round(cx, 6))  # (lat, lon)


def is_valid_polygon(boundary):
    """True if ``boundary`` is a GeoJSON polygon with a usable exterior ring."""
    return len(_clean(_exterior_ring(boundary))) >= 3
