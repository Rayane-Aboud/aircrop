import { useCallback, useEffect, useRef, useState } from 'react'
import { getAnalysisStatus, uploadImage } from './api'
import type { AnalysisResult } from './api'

const POLL_INTERVAL_MS = 2000

function App() {
  const [isDragging, setIsDragging] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

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
        {preview && (
          <img
            src={preview}
            alt="Preview"
            className="mx-auto mb-4 max-h-48 rounded-lg object-contain"
          />
        )}
        <p className="text-slate-500">Drop a crop image here, or click to select one</p>
        <input id="file-input" type="file" accept="image/*" className="hidden" onChange={onSelect} />
      </div>

      {error && <p className="text-red-600">{error}</p>}

      {isProcessing && <p className="text-slate-500 animate-pulse">Analyzing image…</p>}

      {result?.status === 'done' && result.report && result.crop_health && (
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-slate-800 mb-2">
            Health: {result.crop_health.status.replace(/_/g, ' ')}
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            Confidence: {(result.crop_health.confidence * 100).toFixed(0)}%
          </p>
          {result.crop_health.issues_detected.length > 0 && (
            <p className="text-sm text-slate-700 mb-2">
              Issues: {result.crop_health.issues_detected.join(', ')}
            </p>
          )}
          <p className="text-slate-700 mb-3">{result.report.summary}</p>
          <ul className="list-disc list-inside text-slate-600 text-sm">
            {result.report.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.status === 'failed' && (
        <p className="text-red-600">Analysis failed: {result.error}</p>
      )}
    </div>
  )
}

export default App
