import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { downloadReportPdf, listLands, listReports } from '../api'
import type { Land, ReportRow } from '../api'
import UploadPanel from '../components/UploadPanel'

const VERDICT_PILL: Record<string, string> = {
  healthy: 'pill pill-green',
  stressed: 'pill pill-warn',
  no_detection: 'pill',
}

/**
 * A single land. Fixed by the route, so the analysis panel needs no land
 * dropdown. Shows the upload panel and this land's report history.
 */
export default function LandDetail() {
  const { farmerId, landId } = useParams<{ farmerId: string; landId: string }>()
  const [land, setLand] = useState<Land | null>(null)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [error, setError] = useState<string | null>(null)

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
          {landId && <UploadPanel landId={landId} onDone={loadReports} />}
        </div>

        <div className="panel p-5">
          <p className="eyebrow mb-3">Report history</p>
          {rows.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              No reports for this land yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    {row.crop_health ? (
                      <span className={VERDICT_PILL[row.crop_health.status] ?? 'pill'}>
                        {row.crop_health.status.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--faint)' }}>
                        {row.status_label}
                      </span>
                    )}
                    <p className="mt-1 text-xs" style={{ color: 'var(--faint)' }}>
                      {new Date(row.created_at).toLocaleString()}
                    </p>
                  </div>
                  {row.report_pdf_url ? (
                    <button type="button" onClick={() => download(row)} className="btn-ghost text-xs">
                      ⬇ PDF
                    </button>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--faint)' }}>
                      —
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
