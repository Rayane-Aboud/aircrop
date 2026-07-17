import { useCallback, useEffect, useState } from 'react'
import { getLiveWeather } from '../api'
import type { LiveWeather } from '../api'

/** Emoji for a WMO weather code (Open-Meteo standard). */
function icon(code: number | null): string {
  if (code == null) return '🌡️'
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code <= 48) return '🌫️'
  if (code <= 57) return '🌦️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '🌨️'
  if (code <= 82) return '🌧️'
  if (code <= 86) return '🌨️'
  return '⛈️'
}

const num = (n: number | null, digits = 0) => (n == null ? '—' : n.toFixed(digits))

function dayLabel(iso: string, i: number): string {
  if (i === 0) return 'Today'
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })
}

/** Live weather for a land: current conditions + a short daily forecast. */
export default function WeatherStrip({ landId }: { landId: string }) {
  const [data, setData] = useState<LiveWeather | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getLiveWeather({ landId })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Weather unavailable'))
      .finally(() => setLoading(false))
  }, [landId])

  useEffect(() => {
    load()
  }, [load])

  const cur = data?.current

  return (
    <div className="panel p-4" style={{ background: 'var(--bg-2)' }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Live weather</p>
          {data?.location_name && (
            <p className="truncate text-xs" style={{ color: 'var(--faint)' }}>
              📍 {data.location_name}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs"
          style={{ color: 'var(--green-hi)' }}
          aria-label="Refresh weather"
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {error}
        </p>
      )}

      {!error && cur && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none">{icon(cur.weather_code)}</span>
            <div>
              <p className="text-2xl font-semibold leading-none" style={{ color: 'var(--text)' }}>
                {num(cur.temperature_c)}°C
              </p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {cur.condition ?? '—'}
                {cur.apparent_temperature_c != null && ` · feels ${num(cur.apparent_temperature_c)}°`}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-x-5 gap-y-1 text-xs" style={{ color: 'var(--muted)' }}>
            <span>💧 {num(cur.humidity_pct)}%</span>
            <span>🌧️ {num(cur.precipitation_mm, 1)} mm</span>
            <span>💨 {num(cur.wind_kmh)} km/h</span>
          </div>
        </div>
      )}

      {!error && data && data.forecast.length > 1 && (
        <div
          className="mt-3 grid gap-2 pt-3"
          style={{
            borderTop: '1px solid var(--border)',
            gridTemplateColumns: `repeat(${Math.min(data.forecast.length, 5)}, minmax(0, 1fr))`,
          }}
        >
          {data.forecast.slice(0, 5).map((d, i) => (
            <div key={d.date} className="text-center">
              <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                {dayLabel(d.date, i)}
              </p>
              <div className="my-0.5 text-lg leading-none">{icon(d.weather_code)}</div>
              <p className="text-xs" style={{ color: 'var(--text)' }}>
                {num(d.temperature_max_c)}° <span style={{ color: 'var(--faint)' }}>/ {num(d.temperature_min_c)}°</span>
              </p>
              {d.precipitation_prob_pct != null && d.precipitation_prob_pct > 0 && (
                <p className="text-xs" style={{ color: 'var(--green-hi)' }}>
                  💧{num(d.precipitation_prob_pct)}%
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
