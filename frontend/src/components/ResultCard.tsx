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
  const images = result.images ?? []
  const multiImage = images.length > 1

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

      {multiImage && (
        <div className="mb-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Per-image breakdown</span>
            <span className="text-xs" style={{ color: 'var(--faint)' }}>
              {images.length} images in this survey
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((im, i) => {
              const st = im.crop_health?.status ?? 'no_detection'
              const src = im.annotated_image_url ?? im.image_url ?? undefined
              return (
                <div
                  key={im.id}
                  className="overflow-hidden rounded-lg"
                  style={{ border: '1px solid var(--border)', background: 'var(--panel-2)' }}
                >
                  <div className="relative aspect-square w-full">
                    {src ? (
                      <img src={src} alt={`Image ${i + 1}`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: 'var(--faint)' }}>
                        no preview
                      </div>
                    )}
                    <span
                      className="pill absolute left-1 top-1"
                      style={{ background: 'rgba(0,0,0,0.65)', color: STATUS_VAR[st] ?? 'var(--text)' }}
                    >
                      {STATUS_LABEL[st] ?? st}
                    </span>
                  </div>
                  <div className="px-2 py-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                    <span style={{ color: 'var(--text)' }}>Image {i + 1}</span>
                    {im.crop_health && (
                      <>
                        {' · '}
                        {(im.crop_health.confidence * 100).toFixed(0)}%
                      </>
                    )}
                    {' · '}
                    {im.detections.length} detection{im.detections.length === 1 ? '' : 's'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
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
