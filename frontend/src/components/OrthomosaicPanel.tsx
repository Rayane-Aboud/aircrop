import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, Polygon, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { listOrthomosaics, runOrthomosaic } from '../api'
import type { Land, Orthomosaic, OrthomosaicPreset } from '../api'

const POLL_INTERVAL_MS = 5000

const ESRI_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTR =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community'

const STATUS_PILL: Record<Orthomosaic['status'], string> = {
  uploading: 'pill',
  queued: 'pill',
  running: 'pill',
  completed: 'pill pill-green',
  failed: 'pill pill-danger',
  canceled: 'pill pill-warn',
}

const PRESETS: { id: OrthomosaicPreset; label: string; hint: string }[] = [
  { id: 'fast', label: 'Fast orthophoto', hint: '2D map only — quickest' },
  { id: 'full', label: 'Full 3D', hint: 'Adds elevation models + 3D model' },
]

// Friendly names for the WebODM assets we expect; anything else shows raw.
const ASSET_LABELS: Record<string, string> = {
  'orthophoto.tif': 'Orthophoto (GeoTIFF)',
  'orthophoto.png': 'Orthophoto (PNG)',
  'orthophoto.mbtiles': 'Orthophoto (MBTiles)',
  'dsm.tif': 'Surface model (DSM)',
  'dtm.tif': 'Terrain model (DTM)',
  'georeferenced_model.laz': 'Point cloud (LAZ)',
  'textured_model.zip': '3D model (OBJ)',
  'report.pdf': 'Processing report',
  'all.zip': 'Everything (ZIP)',
}

const isRunning = (t: Orthomosaic) =>
  t.status === 'uploading' || t.status === 'queued' || t.status === 'running'

function FitBounds({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(bounds, { padding: [16, 16] })
  }, [map, bounds])
  return null
}

function OrthoMap({ task, land }: { task: Orthomosaic; land: Land }) {
  const ortho = task.orthophoto!
  const bounds = useMemo(() => {
    const [w, s, e, n] = ortho.bounds
    return L.latLngBounds([s, w], [n, e])
  }, [ortho.bounds])
  const boundary = land.boundary?.coordinates?.[0]?.map(
    (p) => [p[1], p[0]] as [number, number],
  )

  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ border: '1px solid var(--border)', height: 480 }}
    >
      <MapContainer
        key={task.id}
        bounds={bounds}
        maxZoom={23}
        style={{ height: '100%', width: '100%', background: 'var(--bg-2)' }}
        scrollWheelZoom
      >
        <TileLayer url={ESRI_URL} attribution={ESRI_ATTR} maxZoom={23} maxNativeZoom={19} />
        <TileLayer
          url={ortho.tiles_url}
          bounds={bounds}
          maxZoom={23}
          maxNativeZoom={ortho.maxzoom ?? 22}
          minNativeZoom={ortho.minzoom ?? undefined}
          attribution="Orthophoto processed with WebODM"
        />
        {boundary && (
          <Polygon
            positions={boundary}
            pathOptions={{ color: '#35c07f', weight: 2, fillOpacity: 0 }}
          />
        )}
        <FitBounds bounds={bounds} />
      </MapContainer>
    </div>
  )
}

/**
 * Orthomosaic tab: stitch overlapping drone photos into one georeferenced map
 * via WebODM. Upload → runs list (polled while processing) → map + downloads.
 */
export default function OrthomosaicPanel({ land }: { land: Land }) {
  const [runs, setRuns] = useState<Orthomosaic[]>([])
  const [configured, setConfigured] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [files, setFiles] = useState<File[]>([])
  const [preset, setPreset] = useState<OrthomosaicPreset>('fast')
  const [sent, setSent] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    listOrthomosaics(land.id)
      .then((data) => {
        setConfigured(data.configured)
        setRuns(data.results)
        // Default the map to the newest finished run.
        setSelectedId(
          (cur) => cur ?? data.results.find((r) => r.orthophoto)?.id ?? null,
        )
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [land.id])

  useEffect(load, [load])

  // Poll while any run is still going; WebODM jobs take minutes to hours.
  const anyRunning = runs.some(isRunning)
  useEffect(() => {
    if (!anyRunning) return
    const id = window.setInterval(load, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [anyRunning, load])

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const images = Array.from(list).filter((f) => f.type.startsWith('image/'))
    setFiles((prev) => [...prev, ...images])
  }

  const start = async () => {
    setError(null)
    setSent(0)
    try {
      const task = await runOrthomosaic(land.id, files, preset, (n, t) => {
        setSent(n)
        setRuns((prev) => [t, ...prev.filter((r) => r.id !== t.id)])
      })
      setRuns((prev) => [task, ...prev.filter((r) => r.id !== task.id)])
      setFiles([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      load()
    } finally {
      setSent(null)
    }
  }

  const uploading = sent !== null
  const selected = runs.find((r) => r.id === selectedId) ?? null
  const totalMb = files.reduce((n, f) => n + f.size, 0) / (1024 * 1024)

  if (!configured) {
    return (
      <section className="panel p-5">
        <p className="eyebrow mb-2">Orthomosaic</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Orthomosaic processing isn't enabled on this server. An administrator
          needs to connect a WebODM instance (WEBODM_URL).
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel cad-grid space-y-4 p-5">
          <p className="eyebrow">New orthomosaic</p>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              addFiles(e.dataTransfer.files)
            }}
            onClick={() => !uploading && document.getElementById('ortho-input')?.click()}
            className="cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors"
            style={{
              borderColor: isDragging ? 'var(--green)' : 'var(--border-2)',
              background: isDragging ? 'var(--green-dim)' : 'var(--bg-2)',
            }}
          >
            <p style={{ color: 'var(--muted)' }}>
              Drop the full flight's photos here, or click to select
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--faint)' }}>
              Overlapping, GPS-tagged shots (70%+ overlap) stitch into one map.
            </p>
            <input
              id="ortho-input"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>

          {files.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--text)' }}>
                {files.length} image{files.length === 1 ? '' : 's'} · {totalMb.toFixed(0)} MB
              </span>
              {!uploading && (
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="text-xs"
                  style={{ color: 'var(--faint)' }}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const on = preset === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  disabled={uploading}
                  className="rounded-lg px-3 py-2 text-left text-sm"
                  style={{
                    border: `1px solid ${on ? 'var(--green-line)' : 'var(--border)'}`,
                    background: on ? 'var(--green-dim)' : 'transparent',
                    color: on ? 'var(--green-hi)' : 'var(--muted)',
                  }}
                >
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-xs" style={{ color: 'var(--faint)' }}>
                    {p.hint}
                  </span>
                </button>
              )
            })}
          </div>

          {error && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={start}
            disabled={files.length < 2 || uploading}
            className="btn-primary"
          >
            {uploading
              ? `Uploading ${sent}/${files.length}…`
              : files.length === 1
                ? 'Add at least 2 images'
                : 'Build orthomosaic'}
          </button>
        </div>

        <div className="panel p-5">
          <p className="eyebrow mb-3">Runs</p>
          {runs.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              No orthomosaics for this land yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {runs.map((run) => {
                const active = run.id === selectedId
                return (
                  <li
                    key={run.id}
                    onClick={() => setSelectedId(run.id)}
                    className="cursor-pointer space-y-2 py-3"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className="truncate text-sm font-medium"
                        style={{ color: active ? 'var(--green-hi)' : 'var(--text)' }}
                      >
                        {run.name}
                      </span>
                      <span className={STATUS_PILL[run.status]}>
                        {run.status === 'running'
                          ? `${run.status_label} ${Math.round(run.progress)}%`
                          : run.status_label}
                      </span>
                    </div>
                    {run.status === 'running' && (
                      <div className="h-1 overflow-hidden rounded" style={{ background: 'var(--bg-2)' }}>
                        <div
                          className="h-full transition-all"
                          style={{ width: `${run.progress}%`, background: 'var(--green)' }}
                        />
                      </div>
                    )}
                    <p className="text-xs" style={{ color: 'var(--faint)' }}>
                      {run.image_count} image{run.image_count === 1 ? '' : 's'}
                      {' · '}
                      {run.preset === 'full' ? 'Full 3D' : 'Fast'}
                      {' · '}
                      {new Date(run.created_at).toLocaleString()}
                    </p>
                    {run.error && (
                      <p className="text-xs" style={{ color: 'var(--danger)' }}>
                        {run.error}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {selected?.status === 'completed' && (
        <section className="panel space-y-4 p-5">
          <div>
            <p className="eyebrow">Orthophoto</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {selected.name}
              {selected.processing_time_ms
                ? ` · processed in ${Math.round(selected.processing_time_ms / 60000)} min`
                : ''}
            </p>
          </div>
          {selected.orthophoto ? (
            <OrthoMap task={selected} land={land} />
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              This run produced no orthophoto to display.
            </p>
          )}
          {selected.assets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.assets.map((a) => (
                <a key={a.name} href={a.url} className="btn-ghost text-xs">
                  ⬇ {ASSET_LABELS[a.name] ?? a.name}
                </a>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
