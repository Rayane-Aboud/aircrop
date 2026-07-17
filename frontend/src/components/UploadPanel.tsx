import { useCallback, useEffect, useRef, useState } from 'react'
import { getSamples, sampleToFile, uploadImages } from '../api'
import type { AnalysisResult, PhotoMeta, Sample } from '../api'

interface Selected {
  file: File
  preview: string
  key: string
}

/**
 * Multi-image selection + submit for a single land. Drone surveys usually
 * produce several shots, so images accumulate into one selection and are
 * uploaded together as a single report. The lifecycle after submit (polling,
 * results) is owned by the parent via `onStarted`.
 */
export default function UploadPanel({
  landId,
  onStarted,
}: {
  landId: string
  onStarted: (initial: AnalysisResult, imageCount: number) => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [selected, setSelected] = useState<Selected[]>([])
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [busy, setBusy] = useState(false)

  const [capturedAt, setCapturedAt] = useState('')
  const metaRef = useRef<PhotoMeta>({})
  metaRef.current = { capturedAt: capturedAt || undefined }

  useEffect(() => {
    getSamples()
      .then(setSamples)
      .catch(() => setSamples([]))
  }, [])

  const addFiles = useCallback((files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      setError('Please add image files.')
      return
    }
    setError(null)
    setSelected((prev) => [
      ...prev,
      ...images.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      })),
    ])
  }, [])

  const removeAt = useCallback((key: string) => {
    setSelected((prev) => {
      const gone = prev.find((s) => s.key === key)
      if (gone) URL.revokeObjectURL(gone.preview)
      return prev.filter((s) => s.key !== key)
    })
  }, [])

  const clearAll = useCallback(() => {
    setSelected((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.preview))
      return []
    })
    setError(null)
  }, [])

  const analyze = useCallback(() => {
    if (selected.length === 0) {
      setError('Add at least one image first.')
      return
    }
    setError(null)
    setBusy(true)
    const chosen = selected
    uploadImages(chosen.map((s) => s.file), landId, metaRef.current)
      .then((initial) => {
        onStarted(initial, chosen.length)
        // Hand off to the parent (drawer + polling); reset the form.
        chosen.forEach((s) => URL.revokeObjectURL(s.preview))
        setSelected([])
        setCapturedAt('')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Upload failed')
      })
      .finally(() => setBusy(false))
  }, [selected, landId, onStarted])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      addFiles(Array.from(e.dataTransfer.files ?? []))
    },
    [addFiles],
  )

  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(Array.from(e.target.files ?? []))
      e.target.value = '' // allow re-selecting the same file
    },
    [addFiles],
  )

  const addSample = useCallback(
    (sample: Sample) => {
      sampleToFile(sample)
        .then((file) => addFiles([file]))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load sample'))
    },
    [addFiles],
  )

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
        className="cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors"
        style={{
          borderColor: isDragging ? 'var(--green)' : 'var(--border-2)',
          background: isDragging ? 'var(--green-dim)' : 'var(--bg-2)',
        }}
      >
        <p style={{ color: 'var(--muted)' }}>Drop drone images here, or click to select</p>
        <p className="mt-1 text-xs" style={{ color: 'var(--faint)' }}>
          Add as many as you like — they’re analyzed together as one report.
        </p>
        <input
          id="file-input"
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onSelect}
        />
      </div>

      {selected.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">
              {selected.length} image{selected.length > 1 ? 's' : ''} selected
            </span>
            <button type="button" onClick={clearAll} className="text-xs" style={{ color: 'var(--faint)' }}>
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.map((s) => (
              <div key={s.key} className="relative h-16 w-16 overflow-hidden rounded-lg" style={{ border: '1px solid var(--border)' }}>
                <img src={s.preview} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAt(s.key)}
                  className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center text-xs"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
            Or add a sample:
          </p>
          <div className="flex gap-3">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => addSample(sample)}
                className="h-16 w-16 overflow-hidden rounded-lg border-2 border-transparent transition-opacity hover:opacity-80"
              >
                <img src={sample.image_url} alt={sample.id} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={analyze} disabled={selected.length === 0 || busy} className="btn-primary">
        {busy
          ? 'Starting…'
          : `Analyze ${selected.length || ''} image${selected.length === 1 ? '' : 's'}`.trim()}
      </button>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
