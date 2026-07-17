import { useEffect, useState } from 'react'
import { downloadReportPdf, listReports } from '../api'
import type { ReportRow } from '../api'
import { useAuth } from '../auth'

const VERDICT_PILL: Record<string, string> = {
  healthy: 'pill pill-green',
  stressed: 'pill pill-warn',
  no_detection: 'pill',
}

export default function Reports() {
  const { user } = useAuth()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listReports()
      .then(setRows)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const title = user?.role === 'farmer' ? 'My Reports' : 'Reports'

  const download = (row: ReportRow) => {
    if (row.report_pdf_url) {
      downloadReportPdf(row.report_pdf_url, `aircrop-report-${row.id}.pdf`).catch(() =>
        window.open(row.report_pdf_url!, '_blank'),
      )
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Archive</p>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
          {title}
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Generated crop-health reports.
        </p>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="panel p-6 text-sm" style={{ color: 'var(--muted)' }}>
          No reports yet.
        </p>
      )}

      {rows.length > 0 && (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg-2)' }}>
              <tr className="text-left" style={{ color: 'var(--faint)' }}>
                {user?.role !== 'farmer' && <th className="px-4 py-3 text-xs uppercase">Land</th>}
                <th className="px-4 py-3 text-xs uppercase">Verdict</th>
                <th className="px-4 py-3 text-xs uppercase">Generated</th>
                <th className="px-4 py-3 text-right text-xs uppercase">Report</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                  {user?.role !== 'farmer' && (
                    <td className="px-4 py-3" style={{ color: 'var(--text)' }}>
                      {row.land_name ?? '—'}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {row.crop_health ? (
                      <span className={VERDICT_PILL[row.crop_health.status] ?? 'pill'}>
                        {row.crop_health.status.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--faint)' }}>
                        {row.status_label}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>
                    {new Date(row.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.report_pdf_url ? (
                      <button type="button" onClick={() => download(row)} className="btn-ghost text-xs">
                        ⬇ PDF
                      </button>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--faint)' }}>
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
