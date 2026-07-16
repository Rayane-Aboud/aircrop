import { useEffect, useState } from 'react'
import { downloadReportPdf, listReports } from '../api'
import type { ReportRow } from '../api'
import { useAuth } from '../auth'

const VERDICT_STYLE: Record<string, string> = {
  healthy: 'bg-emerald-50 text-emerald-700',
  stressed: 'bg-amber-50 text-amber-700',
  no_detection: 'bg-slate-100 text-slate-500',
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
        <h1 className="text-xl font-semibold text-slate-800">{title}</h1>
        <p className="text-sm text-slate-500">Generated crop-health reports.</p>
      </div>

      {loading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No reports yet.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {user?.role !== 'farmer' && <th className="px-4 py-3">Land</th>}
                <th className="px-4 py-3">Verdict</th>
                <th className="px-4 py-3">Generated</th>
                <th className="px-4 py-3 text-right">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  {user?.role !== 'farmer' && (
                    <td className="px-4 py-3 text-slate-700">{row.land_name ?? '—'}</td>
                  )}
                  <td className="px-4 py-3">
                    {row.crop_health ? (
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          VERDICT_STYLE[row.crop_health.status] ?? 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {row.crop_health.status.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">{row.status_label}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(row.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.report_pdf_url ? (
                      <button
                        type="button"
                        onClick={() => download(row)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        ⬇ PDF
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
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
