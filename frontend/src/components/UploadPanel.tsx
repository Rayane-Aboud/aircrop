import { useCallback, useEffect, useRef, useState } from 'react'
import { getAnalysisStatus, getSamples, sampleToFile, uploadImage } from '../api'
import type { AnalysisResult, PhotoMeta, Sample } from '../api'
import ResultCard from './ResultCard'

const POLL_INTERVAL_MS = 2000

/**
 * Self-contained analysis panel for a single land.
 * The land is fixed by the `landId` prop — no land selection here.
 */
export default function UploadPanel({ landId, onDone }: { landId: string; onDone?: () => void }) {
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
              if (data.status === 'done') onDone?.()
            }
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : 'Failed to check status')
            stopPolling()
          })
      }, POLL_INTERVAL_MS)
    },
    [stopPolling, onDone],
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

      uploadImage(file, landId, metaRef.current)
        .then((initial) => {
          setResult(initial)
          startPolling(initial.id)
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Upload failed'))
    },
    [landId, startPolling],
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
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        className="cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors"
        style={{
          borderColor: isDragging ? 'var(--green)' : 'var(--border-2)',
          background: isDragging ? 'var(--green-dim)' : 'var(--bg-2)',
        }}
      >
        {displayImage && (
          <img src={displayImage} alt="Preview" className="mx-auto mb-4 max-h-56 rounded-lg object-contain" />
        )}
        <p style={{ color: 'var(--muted)' }}>Drop a crop image here, or click to select one</p>
        <input id="file-input" type="file" accept="image/*" className="hidden" onChange={onSelect} />
      </div>

      <label className="field-label max-w-sm">
        Date &amp; time taken (optional)
        <input
          type="datetime-local"
          value={capturedAt}
          onChange={(e) => setCapturedAt(e.target.value)}
          className="input"
        />
      </label>

      {samples.length > 0 && (
        <div>
          <p className="mb-2 text-sm" style={{ color: 'var(--muted)' }}>
            Or try a sample:
          </p>
          <div className="flex gap-3">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => handleSampleClick(sample)}
                disabled={loadingSampleId !== null}
                className="h-16 w-16 overflow-hidden rounded-lg border-2 transition-opacity disabled:opacity-40"
                style={{
                  borderColor: loadingSampleId === sample.id ? 'var(--green)' : 'transparent',
                  opacity: loadingSampleId === sample.id ? 0.5 : 1,
                }}
              >
                <img src={sample.image_url} alt={sample.id} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {isProcessing && (
        <p className="animate-pulse" style={{ color: 'var(--muted)' }}>
          Analyzing image…
        </p>
      )}
      {result?.status === 'done' && <ResultCard result={result} />}
      {result?.status === 'failed' && (
        <p style={{ color: 'var(--danger)' }}>Analysis failed: {result.error}</p>
      )}
    </div>
  )
}
