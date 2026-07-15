import { useCallback, useEffect, useRef, useState } from 'react'
import { getAnalysisStatus, getSamples, sampleToFile, uploadImage } from './api'
import type { AnalysisResult, Sample } from './api'

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

      uploadImage(file)
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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-800">Crop Health Check</h1>

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
          <p className="text-slate-700 mb-3">{result.report.summary}</p>
          <ul className="list-disc list-inside text-slate-600 text-sm mb-3">
            {result.report.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
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
