import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAnalysisStatus,
  getSamples,
  listLands,
  sampleToFile,
  uploadImage,
} from '../api'
import type { AnalysisResult, Land, PhotoMeta, Sample } from '../api'
import ResultCard from '../components/ResultCard'

const POLL_INTERVAL_MS = 2000

export default function Analyze() {
  const [lands, setLands] = useState<Land[]>([])
  const [landId, setLandId] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  const [capturedAt, setCapturedAt] = useState('')
  const metaRef = useRef<PhotoMeta>({})
  metaRef.current = { capturedAt: capturedAt || undefined }
  const landRef = useRef('')
  landRef.current = landId

  useEffect(() => {
    listLands()
      .then((l) => {
        setLands(l)
        if (l.length > 0) setLandId(l[0].id)
      })
      .catch(() => setLands([]))
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
            if (data.status === 'done' || data.status === 'failed') stopPolling()
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
      if (!landRef.current) {
        setError('Select a land first.')
        return
      }
      if (!file.type.startsWith('image/')) {
        setError('Please drop an image file.')
        return
      }
      setError(null)
      setResult(null)
      setPreview(URL.createObjectURL(file))

      uploadImage(file, landRef.current, metaRef.current)
        .then((initial) => {
          setResult(initial)
          startPolling(initial.id)
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Upload failed'))
    },
    [startPolling],
  )

  const handleSampleClick = useCallback(
    (sample: Sample) => {
      setLoadingSampleId(sample.id)
      sampleToFile(sample)
        .then(handleFile)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load sample'))
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
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">New Analysis</h1>
        <p className="text-sm text-slate-500">Upload a crop photo for one of your farmers' lands.</p>
      </div>

      {lands.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          You have no lands yet. Add a farmer and a land first, then come back to run an analysis.
        </div>
      ) : (
        <label className="block max-w-md text-sm text-slate-600">
          Land
          <select
            value={landId}
            onChange={(e) => setLandId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          >
            {lands.map((land) => (
              <option key={land.id} value={land.id}>
                {land.name} — {land.farmer_name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        className={`max-w-md rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          lands.length === 0
            ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-60'
            : isDragging
              ? 'cursor-pointer border-emerald-500 bg-emerald-50'
              : 'cursor-pointer border-slate-300 bg-white'
        }`}
      >
        {displayImage && (
          <img src={displayImage} alt="Preview" className="mx-auto mb-4 max-h-48 rounded-lg object-contain" />
        )}
        <p className="text-slate-500">Drop a crop image here, or click to select one</p>
        <input id="file-input" type="file" accept="image/*" className="hidden" onChange={onSelect} />
      </div>

      <label className="block max-w-md text-xs text-slate-500">
        Date &amp; time taken (optional)
        <input
          type="datetime-local"
          value={capturedAt}
          onChange={(e) => setCapturedAt(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-700"
        />
      </label>

      {samples.length > 0 && (
        <div className="max-w-md">
          <p className="mb-2 text-sm text-slate-500">Or try a sample:</p>
          <div className="flex gap-3">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => handleSampleClick(sample)}
                disabled={loadingSampleId !== null || lands.length === 0}
                className={`h-16 w-16 overflow-hidden rounded-lg border-2 transition-opacity disabled:opacity-40 ${
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
      {isProcessing && <p className="animate-pulse text-slate-500">Analyzing image…</p>}
      {result?.status === 'done' && (
        <div className="max-w-md">
          <ResultCard result={result} />
        </div>
      )}
      {result?.status === 'failed' && <p className="text-red-600">Analysis failed: {result.error}</p>}
    </div>
  )
}
