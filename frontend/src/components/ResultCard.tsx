import { downloadReportPdf } from '../api'
import type { AnalysisResult } from '../api'

const STATUS_LABEL: Record<string, string> = {
  healthy: 'Healthy',
  stressed: 'Stressed',
  no_detection: 'No plant detected',
}

const STATUS_VAR: Record<string, string> = {
  healthy: 'var(--green-hi)',
  stressed: 'var(--warn)',
  no_detection: 'var(--muted)',
}

/** Renders a completed analysis (verdict, report, weather, PDF download). */
export default function ResultCard({ result }: { result: AnalysisResult }) {
  if (result.status !== 'done' || !result.report || !result.crop_health) return null
  const { crop_health, report, weather } = result

  const onDownload = () => {
    if (result.report_pdf_url) {
      downloadReportPdf(result.report_pdf_url, `aircrop-report-${result.id}.pdf`).catch(() =>
        window.open(result.report_pdf_url!, '_blank'),
      )
    }
  }

  return (
    <div className="panel w-full p-5" style={{ background: 'var(--bg-2)' }}>
      <h2
        className="mb-2 text-lg font-semibold"
        style={{ color: STATUS_VAR[crop_health.status] ?? 'var(--text)' }}
      >
        {STATUS_LABEL[crop_health.status] ?? crop_health.status}
      </h2>
      <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>
        Confidence: {(crop_health.confidence * 100).toFixed(0)}%
        {' · '}
        {crop_health.healthy_regions} healthy / {crop_health.stressed_regions} stressed region(s)
      </p>
      {report.severity && (
        <p className="mb-2 text-sm font-medium" style={{ color: 'var(--muted)' }}>
          Severity: <span className="capitalize">{report.severity}</span>
        </p>
      )}
      <p className="mb-3" style={{ color: 'var(--text)' }}>
        {report.summary}
      </p>

      {report.detailed_findings && (
        <p className="mb-3 whitespace-pre-line text-sm" style={{ color: 'var(--muted)' }}>
          {report.detailed_findings}
        </p>
      )}

      <p className="mb-1 text-sm font-medium" style={{ color: 'var(--text)' }}>
        Recommendations
      </p>
      <ul className="mb-3 list-inside list-disc text-sm" style={{ color: 'var(--muted)' }}>
        {report.recommendations.map((rec) => (
          <li key={rec}>{rec}</li>
        ))}
      </ul>

      {report.confidence_note && (
        <p className="mb-3 text-xs italic" style={{ color: 'var(--faint)' }}>
          {report.confidence_note}
        </p>
      )}

      {(result.captured_at || result.location_name || result.latitude != null) && (
        <div
          className="mb-3 pt-3 text-sm"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          {result.captured_at && <p>📅 {new Date(result.captured_at).toLocaleString()}</p>}
          {(result.location_name || result.latitude != null) && (
            <p>
              📍 {result.location_name ?? `${result.latitude?.toFixed(4)}, ${result.longitude?.toFixed(4)}`}
            </p>
          )}
        </div>
      )}

      {weather && (
        <div className="mb-3 rounded-lg p-3 text-sm" style={{ background: 'var(--panel-2)' }}>
          <p className="mb-1 font-medium" style={{ color: 'var(--text)' }}>
            Weather on {weather.date}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1" style={{ color: 'var(--muted)' }}>
            {weather.temperature_c != null && <span>🌡️ {weather.temperature_c.toFixed(1)}°C avg</span>}
            {weather.humidity_pct != null && <span>💧 {weather.humidity_pct.toFixed(0)}% humidity</span>}
            {weather.rainfall_mm != null && <span>🌧️ {weather.rainfall_mm.toFixed(1)} mm rain</span>}
            {weather.wind_kmh != null && <span>💨 {weather.wind_kmh.toFixed(0)} km/h wind</span>}
          </div>
        </div>
      )}

      {result.report_pdf_url && (
        <button type="button" onClick={onDownload} className="btn-primary mt-2 w-full">
          ⬇ Download PDF report
        </button>
      )}

      {report.source === 'dummy' && (
        <p className="mt-2 text-xs" style={{ color: 'var(--faint)' }}>
          (Model unavailable — showing placeholder data.)
        </p>
      )}
    </div>
  )
}
