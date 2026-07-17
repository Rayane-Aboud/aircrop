import { useEffect } from 'react'
import type { AnalysisResult } from '../api'
import ProgressStepper from './ProgressStepper'
import type { Step, StepState } from './ProgressStepper'
import ResultCard from './ResultCard'

const STATUS_PILL: Record<string, string> = {
  pending: 'pill',
  processing: 'pill',
  done: 'pill pill-green',
  failed: 'pill pill-danger',
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'Queued',
  processing: 'Analyzing',
  done: 'Complete',
  failed: 'Failed',
}

/**
 * Derive the pipeline timeline from what the backend actually reports.
 * Real signals drive it: an id means the survey uploaded; a weather object
 * means detection finished; `done` means the report + PDF are ready.
 */
function buildSteps(result: AnalysisResult | null): Step[] {
  const status = result?.status
  const failed = status === 'failed'
  const done = status === 'done'
  const hasWeather = !!result?.weather
  const hasPdf = !!result?.report_pdf_url

  // Index of the first stage still in flight (0-based) while processing.
  let active = 0
  if (result) active = 1 // uploaded
  if (hasWeather || done) active = 2 // detection done
  if ((hasWeather && done) || done) active = 3 // building report
  if (done) active = 4 // report done → pdf
  if (done && hasPdf) active = 5 // everything done

  const stageState = (idx: number): StepState => {
    if (failed) return idx < active ? 'done' : idx === active ? 'failed' : 'pending'
    if (idx < active) return 'done'
    if (idx === active) return 'active'
    return 'pending'
  }

  return [
    { label: 'Images uploaded', state: stageState(0) },
    {
      label: 'Detecting crop health',
      hint: result?.image_count ? `${result.image_count} image(s) via YOLO` : undefined,
      state: stageState(1),
    },
    { label: 'Fetching weather context', state: stageState(2) },
    { label: 'Compiling report', state: stageState(3) },
    { label: 'Generating PDF', state: stageState(4) },
  ]
}

interface Props {
  open: boolean
  onClose: () => void
  result: AnalysisResult | null
}

/** Right-side slide-over that tracks one survey from upload to finished report. */
export default function AnalysisDrawer({ open, onClose, result }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const status = result?.status ?? 'pending'
  const isDone = status === 'done'
  const isFailed = status === 'failed'
  const inFlight = !isDone && !isFailed

  return (
    <>
      {open && <div className="drawer-overlay" data-open={open} onClick={onClose} />}
      <aside
        className="drawer-panel"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="min-w-0">
            <p className="eyebrow">Drone survey</p>
            <h2 className="truncate text-base font-semibold" style={{ color: 'var(--text)' }}>
              {isDone ? 'Analysis report' : isFailed ? 'Analysis failed' : 'Analyzing survey…'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className={STATUS_PILL[status] ?? 'pill'}>{STATUS_TEXT[status] ?? status}</span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded"
              style={{ color: 'var(--muted)', border: '1px solid var(--border-2)' }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {inFlight && (
            <div>
              <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>
                Your images are being processed. You can close this panel — it keeps running and
                the report lands in history when it's ready.
              </p>
              <ProgressStepper steps={buildSteps(result)} />
            </div>
          )}

          {isFailed && (
            <div>
              <p className="mb-4 text-sm" style={{ color: 'var(--danger)' }}>
                {result?.error || 'The analysis could not be completed.'}
              </p>
              <ProgressStepper steps={buildSteps(result)} />
            </div>
          )}

          {isDone && result && <ResultCard result={result} />}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end px-5 py-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            {isDone || isFailed ? 'Close' : 'Run in background'}
          </button>
        </div>
      </aside>
    </>
  )
}
