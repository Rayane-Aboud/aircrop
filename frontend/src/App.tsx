import { useCallback, useEffect, useRef, useState } from 'react'
import { getAnalysisStatus, getSamples, sampleToFile, uploadImage } from './api'
import type { AnalysisResult, PhotoMeta, Sample } from './api'
import logo from './assets/aircrop-logo.svg'

const POLL_INTERVAL_MS = 2000

const STATUS_LABEL: Record<string, string> = {
  healthy: 'Healthy',
  stressed: 'Stressed',
  no_detection: 'No plant detected',
}

const STATUS_COLOR: Record<string, string> = {
  healthy: 'text-emerald-600',
  stressed: 'text-amber-600',
  no_detection: 'text-slate-500',
}

function App() {
  const [isDragging, setIsDragging] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  // Optional date/location the user can fill in before uploading (feature 1).
  // Held in a ref too, so the drag/drop handler reads the latest values
  // without being re-created on every keystroke.
  const [capturedAt, setCapturedAt] = useState('')
  const [locationName, setLocationName] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const metaRef = useRef<PhotoMeta>({})
  metaRef.current = {
    capturedAt: capturedAt || undefined,
    locationName: locationName || undefined,
    latitude: latitude || undefined,
    longitude: longitude || undefined,
  }

  useEffect(() => {
    getSamples()
      .then(setSamples)
      .catch(() => setSamples([]))
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      pollRef.current = window.setInterval(() => {
        getAnalysisStatus(id)
          .then((data) => {
            setResult(data)
            if (data.status === 'done' || data.status === 'failed') {
              stopPolling()
            }
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : 'Failed to check status')
            stopPolling()
          })
      }, POLL_INTERVAL_MS)
    },
    [stopPolling],
  )

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Please drop an image file.')
        return
      }

      setError(null)
      setResult(null)
      setPreview(URL.createObjectURL(file))

      uploadImage(file, metaRef.current)
        .then((initial) => {
          setResult(initial)
          startPolling(initial.id)
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Upload failed')
        })
    },
    [startPolling],
  )

  const handleSampleClick = useCallback(
    (sample: Sample) => {
      setLoadingSampleId(sample.id)
      sampleToFile(sample)
        .then((file) => handleFile(file))
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to load sample')
        })
        .finally(() => setLoadingSampleId(null))
    },
    [handleFile],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const isProcessing = result?.status === 'pending' || result?.status === 'processing'
  const displayImage = result?.annotated_image_url ?? preview

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 sm:gap-6 p-4 sm:p-6">
      <header className="flex flex-col items-center gap-1 w-full">
        <img
          src={logo}
          alt="Aircrop"
          className="h-16 w-auto max-w-[70vw] sm:h-20 md:h-24"
        />
        <p className="text-xs sm:text-sm text-slate-500 text-center">Crop Health Check</p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        className={`w-full max-w-md rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
          isDragging ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-white'
        }`}
      >
        {displayImage && (
          <img
            src={displayImage}
            alt="Preview"
            className="mx-auto mb-4 max-h-48 rounded-lg object-contain"
          />
        )}
        <p className="text-slate-500">Drop a crop image here, or click to select one</p>
        <input id="file-input" type="file" accept="image/*" className="hidden" onChange={onSelect} />
      </div>

      <details className="w-full max-w-md rounded-xl bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm text-slate-600">
          Date &amp; location (optional — auto-detected from the photo when available)
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs text-slate-500">
            Date &amp; time taken
            <input
              type="datetime-local"
              value={capturedAt}
              onChange={(e) => setCapturedAt(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-700"
            />
          </label>
          <label className="col-span-2 text-xs text-slate-500">
            Location (place name)
            <input
              type="text"
              placeholder="e.g. Blida, Algeria"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-700"
            />
          </label>
          <label className="text-xs text-slate-500">
            Latitude
            <input
              type="number"
              step="any"
              placeholder="36.47"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-700"
            />
          </label>
          <label className="text-xs text-slate-500">
            Longitude
            <input
              type="number"
              step="any"
              placeholder="2.83"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-700"
            />
          </label>
          <p className="col-span-2 text-xs text-slate-400">
            A place name or coordinates lets us look up the weather for that day.
          </p>
        </div>
      </details>

      {samples.length > 0 && (
        <div className="w-full max-w-md">
          <p className="text-sm text-slate-500 mb-2">Or try a sample:</p>
          <div className="flex gap-3 justify-center">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => handleSampleClick(sample)}
                disabled={loadingSampleId !== null}
                className={`h-16 w-16 overflow-hidden rounded-lg border-2 transition-opacity ${
                  loadingSampleId === sample.id ? 'opacity-50' : 'border-transparent hover:border-emerald-400'
                }`}
              >
                <img src={sample.image_url} alt={sample.id} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-red-600">{error}</p>}

      {isProcessing && <p className="text-slate-500 animate-pulse">Analyzing image…</p>}

      {result?.status === 'done' && result.report && result.crop_health && (
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow">
          <h2 className={`text-lg font-semibold mb-2 ${STATUS_COLOR[result.crop_health.status] ?? 'text-slate-800'}`}>
            {STATUS_LABEL[result.crop_health.status] ?? result.crop_health.status}
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            Confidence: {(result.crop_health.confidence * 100).toFixed(0)}%
            {' · '}
            {result.crop_health.healthy_regions} healthy / {result.crop_health.stressed_regions} stressed region(s)
          </p>
          {result.report.severity && (
            <p className="mb-2 text-sm font-medium text-slate-600">
              Severity: <span className="capitalize">{result.report.severity}</span>
            </p>
          )}
          <p className="text-slate-700 mb-3">{result.report.summary}</p>

          {result.report.detailed_findings && (
            <p className="mb-3 whitespace-pre-line text-sm text-slate-600">
              {result.report.detailed_findings}
            </p>
          )}

          <p className="mb-1 text-sm font-medium text-slate-700">Recommendations</p>
          <ul className="list-disc list-inside text-slate-600 text-sm mb-3">
            {result.report.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>

          {result.report.confidence_note && (
            <p className="mb-3 text-xs italic text-slate-400">
              {result.report.confidence_note}
            </p>
          )}

          {(result.captured_at || result.location_name || result.latitude != null) && (
            <div className="mb-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
              {result.captured_at && (
                <p>📅 {new Date(result.captured_at).toLocaleString()}</p>
              )}
              {(result.location_name || result.latitude != null) && (
                <p>
                  📍 {result.location_name
                    ?? `${result.latitude?.toFixed(4)}, ${result.longitude?.toFixed(4)}`}
                </p>
              )}
            </div>
          )}

          {result.weather && (
            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="mb-1 font-medium text-slate-700">
                Weather on {result.weather.date}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
                {result.weather.temperature_c != null && (
                  <span>🌡️ {result.weather.temperature_c.toFixed(1)}°C avg</span>
                )}
                {result.weather.humidity_pct != null && (
                  <span>💧 {result.weather.humidity_pct.toFixed(0)}% humidity</span>
                )}
                {result.weather.rainfall_mm != null && (
                  <span>🌧️ {result.weather.rainfall_mm.toFixed(1)} mm rain</span>
                )}
                {result.weather.wind_kmh != null && (
                  <span>💨 {result.weather.wind_kmh.toFixed(0)} km/h wind</span>
                )}
              </div>
            </div>
          )}

          {result.report_pdf_url && (
            <a
              href={result.report_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 mb-1 inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              ⬇ Download PDF report
            </a>
          )}

          {result.report.source === 'dummy' && (
            <p className="text-xs text-slate-400">
              (Model unavailable — showing placeholder data.)
            </p>
          )}
        </div>
      )}

      {result?.status === 'failed' && (
        <p className="text-red-600">Analysis failed: {result.error}</p>
      )}
    </div>
  )
}

export default App
