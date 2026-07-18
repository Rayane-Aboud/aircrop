import { useCallback, useEffect, useRef, useState } from 'react'
import { LayersControl, MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import '@geoman-io/leaflet-geoman-free'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import { updateLandBoundary } from '../api'
import type { GeoPolygon, Land } from '../api'

// Esri World Imagery — free, keyless, sub-metre aerial. Sharpest base for
// tracing field corners, so it's the default.
const ESRI_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTR =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community'

// Sentinel-2 cloudless mosaic (EOX) — free, keyless, cloud-free 10 m imagery.
// Coarser than Esri (upscaled past its native ~z15) but a true, recent
// vegetation view; offered as an alternate base layer.
const S2_YEAR = 2024
const S2_URL = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${S2_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`
const S2_ATTR = `Sentinel-2 cloudless ${S2_YEAR} by EOX IT Services GmbH — contains modified Copernicus Sentinel data`

// Sensible fallback view when a land has no coordinates yet (roughly Algeria).
const FALLBACK_CENTER: [number, number] = [28.0, 2.0]
const FALLBACK_ZOOM = 5

const EARTH_RADIUS_M = 6378137.0

/** Spherical polygon area in hectares — mirrors the backend geo helper so the
 *  live readout matches what gets saved. */
function areaHectares(poly: GeoPolygon | null): number | null {
  const ring = poly?.coordinates?.[0]
  if (!ring || ring.length < 3) return null
  const pts = ring.map((p) => [Number(p[0]), Number(p[1])] as [number, number])
  if (pts.length >= 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts.pop()
  }
  if (pts.length < 3) return null
  const rad = (d: number) => (d * Math.PI) / 180
  let total = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = pts[i]
    const [lon2, lat2] = pts[(i + 1) % n]
    total += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  const areaM2 = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2)
  return areaM2 / 10000
}

function layerToPolygon(layer: L.Layer): GeoPolygon | null {
  const gj = (layer as unknown as { toGeoJSON: () => GeoJSON.Feature }).toGeoJSON()
  const geom = gj?.geometry
  if (geom && geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates as number[][][] }
  }
  return null
}

/** GeoJSON ring [lon,lat] → Leaflet latlngs [lat,lon]. */
function ringToLatLngs(poly: GeoPolygon): L.LatLngExpression[] {
  const ring = poly.coordinates?.[0] ?? []
  const pts = ring.map((p) => [p[1], p[0]] as [number, number])
  if (pts.length >= 2) {
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) pts.pop()
  }
  return pts
}

interface DrawLayerProps {
  land: Land
  onDraft: (poly: GeoPolygon | null) => void
  registerSave: (fn: () => Promise<void>) => void
  registerClear: (fn: () => void) => void
  onSaved: (land: Land) => void
  setSaving: (v: boolean) => void
  setError: (v: string | null) => void
}

/**
 * The interactive layer: Esri Geoman controls + the land's boundary polygon.
 * Runs inside <MapContainer> so it can grab the Leaflet map via useMap().
 */
function DrawLayer({
  land,
  onDraft,
  registerSave,
  registerClear,
  onSaved,
  setSaving,
  setError,
}: DrawLayerProps) {
  const map = useMap()
  const layerRef = useRef<L.Layer | null>(null)

  const styleLayer = (layer: L.Layer) => {
    ;(layer as L.Path).setStyle?.({
      color: '#35c07f',
      weight: 2,
      fillColor: '#2ea86a',
      fillOpacity: 0.2,
    })
  }

  const setLayer = useCallback(
    (layer: L.Layer | null) => {
      if (layerRef.current && layerRef.current !== layer) {
        map.removeLayer(layerRef.current)
      }
      layerRef.current = layer
      onDraft(layer ? layerToPolygon(layer) : null)
    },
    [map, onDraft],
  )

  // One-time: Geoman toolbar + event wiring.
  useEffect(() => {
    const pm = (map as unknown as { pm: any }).pm
    pm.addControls({
      position: 'topright',
      drawMarker: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: true,
      drawPolygon: true,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
    })
    pm.setGlobalOptions({ snappable: true, allowSelfIntersection: false })

    const onCreate = (e: { layer: L.Layer }) => {
      setLayer(e.layer)
      styleLayer(e.layer)
      wireEdit(e.layer)
    }
    const wireEdit = (layer: L.Layer) => {
      const handler = () => onDraft(layerToPolygon(layer))
      ;(layer as unknown as L.Evented).on('pm:edit', handler)
      ;(layer as unknown as L.Evented).on('pm:dragend', handler)
    }

    map.on('pm:create', onCreate)

    // Load the existing boundary, if any.
    if (land.boundary) {
      const poly = L.polygon(ringToLatLngs(land.boundary))
      poly.addTo(map)
      styleLayer(poly)
      wireEdit(poly)
      layerRef.current = poly
      onDraft(land.boundary)
      map.fitBounds(poly.getBounds(), { padding: [24, 24], maxZoom: 18 })
    } else if (land.latitude != null && land.longitude != null) {
      map.setView([land.latitude, land.longitude], 16)
    }

    return () => {
      map.off('pm:create', onCreate)
      pm.removeControls()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // Register the save action for the parent's Save button.
  useEffect(() => {
    registerSave(async () => {
      const poly = layerRef.current ? layerToPolygon(layerRef.current) : null
      setSaving(true)
      setError(null)
      try {
        const updated = await updateLandBoundary(land.id, poly)
        onSaved(updated)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save boundary')
      } finally {
        setSaving(false)
      }
    })
    registerClear(() => setLayer(null))
  }, [land.id, registerSave, registerClear, onSaved, setSaving, setError, setLayer])

  return null
}

interface LandMapProps {
  land: Land
  onSaved: (land: Land) => void
}

/**
 * Satellite map with draw/edit tools for a land's boundary. Draw or edit the
 * polygon, watch the live hectare readout, then Save — the backend derives the
 * authoritative area + centroid and returns the updated land.
 */
export default function LandMap({ land, onSaved }: LandMapProps) {
  const [draft, setDraft] = useState<GeoPolygon | null>(land.boundary)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const clearRef = useRef<() => void>(() => {})

  const center: [number, number] =
    land.latitude != null && land.longitude != null
      ? [land.latitude, land.longitude]
      : FALLBACK_CENTER
  const zoom = land.latitude != null && land.longitude != null ? 16 : FALLBACK_ZOOM

  const liveArea = areaHectares(draft)
  const hasBoundary = !!draft

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Boundary</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {hasBoundary
              ? 'Draw or drag the corners to adjust, then save.'
              : 'Use the polygon tool (top-right) to trace this field.'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="eyebrow">Area</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {liveArea != null ? `${liveArea.toFixed(2)} ha` : '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => clearRef.current()}
            className="btn-ghost text-xs"
            disabled={!hasBoundary || saving}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => saveRef.current()}
            className="btn-primary text-xs"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save boundary'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div
        className="overflow-hidden rounded-lg"
        style={{ border: '1px solid var(--border)', height: 460 }}
      >
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ height: '100%', width: '100%', background: 'var(--bg-2)' }}
          scrollWheelZoom
        >
          <LayersControl position="topleft">
            <LayersControl.BaseLayer checked name="Satellite (Esri)">
              <TileLayer url={ESRI_URL} attribution={ESRI_ATTR} maxZoom={19} />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Sentinel-2 (cloudless)">
              <TileLayer
                url={S2_URL}
                attribution={S2_ATTR}
                maxZoom={19}
                maxNativeZoom={15}
              />
            </LayersControl.BaseLayer>
          </LayersControl>
          <DrawLayer
            land={land}
            onDraft={setDraft}
            registerSave={(fn) => (saveRef.current = fn)}
            registerClear={(fn) => (clearRef.current = fn)}
            onSaved={onSaved}
            setSaving={setSaving}
            setError={setError}
          />
        </MapContainer>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint)' }}>
        Saving recomputes the field area and centre point from the polygon.
        {land.boundary_updated_at
          ? ` Last updated ${new Date(land.boundary_updated_at).toLocaleString()}.`
          : ''}
      </p>
    </div>
  )
}
