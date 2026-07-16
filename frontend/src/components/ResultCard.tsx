import { downloadReportPdf } from '../api'
import type { AnalysisResult } from '../api'

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

/** Renders a completed analysis (verdict, report, weather, PDF download). */
export default function ResultCard({ result }: { result: AnalysisResult }) {
  if (result.status !== 'done' || !result.report || !result.crop_health) return null
  const { crop_health, report, weather } = result

  const onDownload = () => {
    if (result.report_pdf_url) {
      downloadReportPdf(result.report_pdf_url, `aircrop-report-${result.id}.pdf`).catch(
        () => window.open(result.report_pdf_url!, '_blank'),
      )
    }
  }

  return (
    <div className="w-full rounded-xl bg-white p-6 shadow-sm">
      <h2 className={`text-lg font-semibold mb-2 ${STATUS_COLOR[crop_health.status] ?? 'text-slate-800'}`}>
        {STATUS_LABEL[crop_health.status] ?? crop_health.status}
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        Confidence: {(crop_health.confidence * 100).toFixed(0)}%
        {' · '}
        {crop_health.healthy_regions} healthy / {crop_health.stressed_regions} stressed region(s)
      </p>
      {report.severity && (
        <p className="mb-2 text-sm font-medium text-slate-600">
          Severity: <span className="capitalize">{report.severity}</span>
        </p>
      )}
      <p className="text-slate-700 mb-3">{report.summary}</p>

      {report.detailed_findings && (
        <p className="mb-3 whitespace-pre-line text-sm text-slate-600">{report.detailed_findings}</p>
      )}

      <p className="mb-1 text-sm font-medium text-slate-700">Recommendations</p>
      <ul className="list-disc list-inside text-slate-600 text-sm mb-3">
        {report.recommendations.map((rec) => (
          <li key={rec}>{rec}</li>
        ))}
      </ul>

      {report.confidence_note && (
        <p className="mb-3 text-xs italic text-slate-400">{report.confidence_note}</p>
      )}

      {(result.captured_at || result.location_name || result.latitude != null) && (
        <div className="mb-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
          {result.captured_at && <p>📅 {new Date(result.captured_at).toLocaleString()}</p>}
          {(result.location_name || result.latitude != null) && (
            <p>
              📍 {result.location_name ?? `${result.latitude?.toFixed(4)}, ${result.longitude?.toFixed(4)}`}
            </p>
          )}
        </div>
      )}

      {weather && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="mb-1 font-medium text-slate-700">Weather on {weather.date}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
            {weather.temperature_c != null && <span>🌡️ {weather.temperature_c.toFixed(1)}°C avg</span>}
            {weather.humidity_pct != null && <span>💧 {weather.humidity_pct.toFixed(0)}% humidity</span>}
            {weather.rainfall_mm != null && <span>🌧️ {weather.rainfall_mm.toFixed(1)} mm rain</span>}
            {weather.wind_kmh != null && <span>💨 {weather.wind_kmh.toFixed(0)} km/h wind</span>}
          </div>
        </div>
      )}

      {result.report_pdf_url && (
        <button
          type="button"
          onClick={onDownload}
          className="mt-2 mb-1 inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          ⬇ Download PDF report
        </button>
      )}

      {report.source === 'dummy' && (
        <p className="text-xs text-slate-400">(Model unavailable — showing placeholder data.)</p>
      )}
    </div>
  )
}
