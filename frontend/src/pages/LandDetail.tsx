import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { downloadReportPdf, getAnalysisStatus, listLands, listReports } from '../api'
import type { AnalysisResult, Land, ReportRow } from '../api'
import AnalysisDrawer from '../components/AnalysisDrawer'
import UploadPanel from '../components/UploadPanel'

const POLL_INTERVAL_MS = 2000

const VERDICT_PILL: Record<string, string> = {
  healthy: 'pill pill-green',
  stressed: 'pill pill-warn',
  no_detection: 'pill',
}

const PROCESSING_LABEL: Record<string, string> = {
  pending: 'Queued',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
}

/**
 * A single land. The analysis lifecycle lives here: UploadPanel just submits,
 * then this page polls, drives the slide-over drawer, and keeps the report
 * history live (optimistic row that settles into the canonical report).
 */
export default function LandDetail() {
  const { farmerId, landId } = useParams<{ farmerId: string; landId: string }>()
  const [land, setLand] = useState<Land | null>(null)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const [active, setActive] = useState<AnalysisResult | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pollRef = useRef<number | null>(null)

  const loadReports = useCallback(() => {
    if (!landId) return
    listReports(landId)
      .then(setRows)
      .catch(() => setRows([]))
  }, [landId])

  useEffect(() => {
    if (!farmerId || !landId) return
    listLands(Number(farmerId))
      .then((all) => setLand(all.find((l) => l.id === landId) ?? null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load land'))
    loadReports()
  }, [farmerId, landId, loadReports])

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  // Patch a single history row in place (live status while a survey runs).
  const patchRow = useCallback((id: string, patch: Partial<ReportRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      pollRef.current = window.setInterval(() => {
        getAnalysisStatus(id)
          .then((data) => {
            setActive(data)
            patchRow(id, {
              status: data.status,
              status_label: PROCESSING_LABEL[data.status] ?? data.status,
              crop_health: data.crop_health ?? null,
              report_pdf_url: data.report_pdf_url ?? null,
            })
            if (data.status === 'done' || data.status === 'failed') {
              stopPolling()
              if (data.status === 'done') loadReports() // reconcile with canonical data
            }
          })
          .catch(() => stopPolling())
      }, POLL_INTERVAL_MS)
    },
    [stopPolling, patchRow, loadReports],
  )

  // UploadPanel finished the POST; take over the lifecycle.
  const onStarted = useCallback(
    (initial: AnalysisResult, imageCount: number) => {
      setActive(initial)
      setDrawerOpen(true)
      const optimistic: ReportRow = {
        id: initial.id,
        status: initial.status,
        status_label: PROCESSING_LABEL[initial.status] ?? initial.status,
        land: landId ?? null,
        land_name: land?.name ?? null,
        crop_health: initial.crop_health ?? null,
        report_pdf_url: initial.report_pdf_url ?? null,
        image_count: imageCount,
        created_at: new Date().toISOString(),
      }
      setRows((prev) => [optimistic, ...prev.filter((r) => r.id !== initial.id)])
      startPolling(initial.id)
    },
    [landId, land, startPolling],
  )

  // Re-open a finished (or running) report from history.
  const openReport = useCallback((id: string) => {
    getAnalysisStatus(id)
      .then((data) => {
        setActive(data)
        setDrawerOpen(true)
        if (data.status === 'pending' || data.status === 'processing') startPolling(id)
      })
      .catch(() => { /* ignore */ })
  }, [startPolling])

  const download = (row: ReportRow) => {
    if (row.report_pdf_url) {
      downloadReportPdf(row.report_pdf_url, `aircrop-report-${row.id}.pdf`).catch(() =>
        window.open(row.report_pdf_url!, '_blank'),
      )
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/projects/${farmerId}`} className="text-xs" style={{ color: 'var(--green-hi)' }}>
          ← {land?.farmer_name ?? 'Project'}
        </Link>
        <p className="eyebrow mt-2">Land</p>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
          {land?.name ?? 'Land'}
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {land?.crop_type || 'Crop n/a'}
          {land?.location_name ? ` · ${land.location_name}` : ''}
        </p>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel cad-grid p-5">
          <p className="eyebrow mb-3">New analysis</p>
          {landId && <UploadPanel landId={landId} onStarted={onStarted} />}
        </div>

        <div className="panel p-5">
          <p className="eyebrow mb-3">Report history</p>
          {rows.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              No reports for this land yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {rows.map((row) => {
                const running = row.status === 'pending' || row.status === 'processing'
                return (
                  <li
                    key={row.id}
                    onClick={() => openReport(row.id)}
                    className="flex cursor-pointer items-center justify-between gap-3 py-3 transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="min-w-0">
                      {row.crop_health ? (
                        <span className={VERDICT_PILL[row.crop_health.status] ?? 'pill'}>
                          {row.crop_health.status.replace('_', ' ')}
                        </span>
                      ) : (
                        <span
                          className={running ? 'pill' : 'text-xs'}
                          style={running ? { color: 'var(--green-hi)', borderColor: 'var(--green-line)' } : { color: 'var(--faint)' }}
                        >
                          {running && (
                            <span
                              className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                              style={{ background: 'var(--green)' }}
                            />
                          )}
                          {row.status_label}
                        </span>
                      )}
                      <p className="mt-1 text-xs" style={{ color: 'var(--faint)' }}>
                        {row.image_count} image{row.image_count === 1 ? '' : 's'}
                        {' · '}
                        {new Date(row.created_at).toLocaleString()}
                      </p>
                    </div>
                    {row.report_pdf_url ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          download(row)
                        }}
                        className="btn-ghost text-xs"
                      >
                        ⬇ PDF
                      </button>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--faint)' }}>
                        {running ? '…' : '—'}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <AnalysisDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} result={active} />
    </div>
  )
}
