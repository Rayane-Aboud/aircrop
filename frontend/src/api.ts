// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Role = 'super_admin' | 'agronomist' | 'farmer'

export interface User {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  display_name: string
  role: Role
  phone: string
  managed_by: number | null
  is_active: boolean
  date_joined: string
}

/** GeoJSON Polygon (WGS84 lon/lat). Rings are arrays of [lon, lat] pairs. */
export interface GeoPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

export interface Land {
  id: string
  name: string
  farmer: number
  farmer_name: string
  agronomist: number
  agronomist_name: string
  area_hectares: number | null
  crop_type: string
  location_name: string
  latitude: number | null
  longitude: number | null
  boundary: GeoPolygon | null
  boundary_updated_at: string | null
  report_count: number
  created_at: string
}

export interface Detection {
  class_name: string
  confidence: number
}

export interface CropHealth {
  status: 'healthy' | 'stressed' | 'no_detection'
  confidence: number
  issues_detected: string[]
  healthy_regions: number
  stressed_regions: number
}

export interface AnalysisReport {
  summary: string
  recommendations: string[]
  detections: Detection[]
  source: 'yolo' | 'dummy' | 'llm'
  detailed_findings?: string
  severity?: string
  confidence_note?: string
}

export interface Weather {
  date: string
  temperature_c: number | null
  temperature_min_c: number | null
  temperature_max_c: number | null
  humidity_pct: number | null
  rainfall_mm: number | null
  wind_kmh: number | null
  source: 'archive' | 'forecast'
}

export interface AnalysisImageOut {
  id: string
  image_url: string | null
  annotated_image_url: string | null
  crop_health: CropHealth | null
  detections: Detection[]
}

export interface AnalysisResult {
  id: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  land?: string | null
  image_url: string | null
  annotated_image_url: string | null
  images?: AnalysisImageOut[]
  image_count?: number
  captured_at?: string | null
  latitude?: number | null
  longitude?: number | null
  location_name?: string | null
  weather?: Weather | null
  report?: AnalysisReport
  crop_health?: CropHealth
  report_pdf_url?: string | null
  error?: string
}

export interface ReportRow {
  id: string
  status: AnalysisResult['status']
  status_label: string
  land: string | null
  land_name: string | null
  crop_health: CropHealth | null
  report_pdf_url: string | null
  image_count: number
  created_at: string
}

export interface PhotoMeta {
  capturedAt?: string
  latitude?: string
  longitude?: string
  locationName?: string
}

export interface Sample {
  id: string
  image_url: string
}

export interface CurrentWeather {
  temperature_c: number | null
  apparent_temperature_c: number | null
  humidity_pct: number | null
  precipitation_mm: number | null
  wind_kmh: number | null
  weather_code: number | null
  condition: string | null
  time: string | null
}

export interface ForecastDay {
  date: string
  temperature_max_c: number | null
  temperature_min_c: number | null
  precipitation_mm: number | null
  precipitation_prob_pct: number | null
  wind_kmh: number | null
  weather_code: number | null
  condition: string | null
}

export interface LiveWeather {
  latitude: number | null
  longitude: number | null
  location_name: string | null
  current: CurrentWeather | null
  forecast: ForecastDay[]
  fetched_at: string
}

interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

// ---------------------------------------------------------------------------
// Token storage + authenticated fetch (with one-shot refresh on 401)
// ---------------------------------------------------------------------------
const ACCESS_KEY = 'aircrop_access'
const REFRESH_KEY = 'aircrop_refresh'

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

async function tryRefresh(): Promise<boolean> {
  const refresh = tokenStore.refresh
  if (!refresh) return false
  const res = await fetch(`${API_BASE}/auth/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  })
  if (!res.ok) return false
  const data = (await res.json()) as { access: string }
  tokenStore.set(data.access)
  return true
}

/** fetch() wrapper that injects the Bearer token and refreshes once on 401. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const withAuth = (): RequestInit => {
    const headers = new Headers(init.headers)
    const access = tokenStore.access
    if (access) headers.set('Authorization', `Bearer ${access}`)
    return { ...init, headers }
  }

  let res = await fetch(`${API_BASE}${path}`, withAuth())
  if (res.status === 401 && (await tryRefresh())) {
    res = await fetch(`${API_BASE}${path}`, withAuth())
  }
  return res
}

async function jsonOrThrow<T>(res: Response, msg: string): Promise<T> {
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body.detail || body.error || JSON.stringify(body)
    } catch {
      /* ignore */
    }
    throw new Error(detail || `${msg} (${res.status})`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export async function login(username: string, password: string): Promise<User> {
  const res = await fetch(`${API_BASE}/auth/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await jsonOrThrow<{ access: string; refresh: string; user: User }>(
    res,
    'Login failed',
  )
  tokenStore.set(data.access, data.refresh)
  return data.user
}

export async function fetchMe(): Promise<User> {
  const res = await authFetch('/auth/me/')
  return jsonOrThrow<User>(res, 'Not authenticated')
}

export function logout() {
  tokenStore.clear()
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function listUsers(role?: Role): Promise<User[]> {
  const q = role ? `?role=${role}` : ''
  const res = await authFetch(`/users/${q}`)
  const data = await jsonOrThrow<Paginated<User>>(res, 'Failed to load users')
  return data.results
}

export interface NewUser {
  username: string
  password: string
  role: Role
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

export async function createUser(payload: NewUser): Promise<User> {
  const res = await authFetch('/users/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return jsonOrThrow<User>(res, 'Failed to create user')
}

// ---------------------------------------------------------------------------
// Lands
// ---------------------------------------------------------------------------
export async function listLands(farmerId?: number): Promise<Land[]> {
  const q = farmerId ? `?farmer=${farmerId}` : ''
  const res = await authFetch(`/lands/${q}`)
  const data = await jsonOrThrow<Paginated<Land>>(res, 'Failed to load lands')
  return data.results
}

export interface NewLand {
  name: string
  farmer: number
  area_hectares?: number | null
  crop_type?: string
  location_name?: string
  latitude?: number | null
  longitude?: number | null
}

export async function createLand(payload: NewLand): Promise<Land> {
  const res = await authFetch('/lands/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return jsonOrThrow<Land>(res, 'Failed to create land')
}

/**
 * Save (or clear) a land's boundary polygon. The backend derives
 * area_hectares + centroid (latitude/longitude) from the geometry, so the
 * returned Land carries the freshly computed values.
 */
export async function updateLandBoundary(
  landId: string,
  boundary: GeoPolygon | null,
): Promise<Land> {
  const res = await authFetch(`/lands/${landId}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boundary }),
  })
  return jsonOrThrow<Land>(res, 'Failed to save boundary')
}

// ---------------------------------------------------------------------------
// Reports (history)
// ---------------------------------------------------------------------------
export async function listReports(landId?: string): Promise<ReportRow[]> {
  const q = landId ? `?land=${landId}` : ''
  const res = await authFetch(`/reports/${q}`)
  const data = await jsonOrThrow<Paginated<ReportRow>>(res, 'Failed to load reports')
  return data.results
}

// ---------------------------------------------------------------------------
// Analysis pipeline
// ---------------------------------------------------------------------------
/** Upload one or more drone images as a single survey/report. */
export async function uploadImages(
  files: File[],
  landId: string,
  meta?: PhotoMeta,
): Promise<AnalysisResult> {
  const formData = new FormData()
  for (const file of files) formData.append('images', file)
  formData.append('land', landId)
  if (meta?.capturedAt) formData.append('captured_at', meta.capturedAt)
  if (meta?.latitude) formData.append('latitude', meta.latitude)
  if (meta?.longitude) formData.append('longitude', meta.longitude)
  if (meta?.locationName) formData.append('location_name', meta.locationName)

  const res = await authFetch('/analyze/', { method: 'POST', body: formData })
  return jsonOrThrow<AnalysisResult>(res, 'Upload failed')
}

/** Convenience wrapper for a single image. */
export function uploadImage(
  file: File,
  landId: string,
  meta?: PhotoMeta,
): Promise<AnalysisResult> {
  return uploadImages([file], landId, meta)
}

export async function getAnalysisStatus(id: string): Promise<AnalysisResult> {
  const res = await authFetch(`/analyze/${id}/`)
  return jsonOrThrow<AnalysisResult>(res, 'Status check failed')
}

// ---------------------------------------------------------------------------
// Live weather (current conditions + short forecast)
// ---------------------------------------------------------------------------
export async function getLiveWeather(
  params: { landId?: string; lat?: number; lon?: number },
): Promise<LiveWeather> {
  const q = new URLSearchParams()
  if (params.landId) q.set('land', params.landId)
  if (params.lat != null) q.set('lat', String(params.lat))
  if (params.lon != null) q.set('lon', String(params.lon))
  const res = await authFetch(`/weather/?${q.toString()}`)
  return jsonOrThrow<LiveWeather>(res, 'Failed to load weather')
}

export async function getSamples(): Promise<Sample[]> {
  const res = await authFetch('/samples/')
  const data = await jsonOrThrow<{ samples: Sample[] }>(res, 'Failed to load samples')
  return data.samples
}

export async function sampleToFile(sample: Sample): Promise<File> {
  const res = await fetch(sample.image_url)
  if (!res.ok) throw new Error(`Failed to fetch sample image (${res.status})`)
  const blob = await res.blob()
  return new File([blob], `${sample.id}.jpg`, { type: blob.type || 'image/jpeg' })
}

/** Download a PDF through authFetch (so the Bearer token is sent) and open it. */
export async function downloadReportPdf(url: string, filename: string): Promise<void> {
  // url comes back as an absolute path like /api/analyze/<id>/report.pdf
  const path = url.startsWith(API_BASE) ? url.slice(API_BASE.length) : url.replace(/^\/api/, '')
  const res = await authFetch(path)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}
