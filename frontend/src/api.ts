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
  source: 'yolo' | 'dummy'
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

export interface AnalysisResult {
  id: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  image_url: string | null
  annotated_image_url: string | null
  captured_at?: string | null
  latitude?: number | null
  longitude?: number | null
  location_name?: string | null
  weather?: Weather | null
  report?: AnalysisReport
  crop_health?: CropHealth
  error?: string
}

// Optional date/location the user can supply on upload (feature 1). Any of
// these override what EXIF provides; all are optional.
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

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

export async function uploadImage(file: File, meta?: PhotoMeta): Promise<AnalysisResult> {
  const formData = new FormData()
  formData.append('image', file)
  if (meta?.capturedAt) formData.append('captured_at', meta.capturedAt)
  if (meta?.latitude) formData.append('latitude', meta.latitude)
  if (meta?.longitude) formData.append('longitude', meta.longitude)
  if (meta?.locationName) formData.append('location_name', meta.locationName)

  const res = await fetch(`${API_BASE}/analyze/`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`)
  }

  return res.json() as Promise<AnalysisResult>
}

export async function getAnalysisStatus(id: string): Promise<AnalysisResult> {
  const res = await fetch(`${API_BASE}/analyze/${id}/`)

  if (!res.ok) {
    throw new Error(`Status check failed (${res.status})`)
  }

  return res.json() as Promise<AnalysisResult>
}

export async function getSamples(): Promise<Sample[]> {
  const res = await fetch(`${API_BASE}/samples/`)

  if (!res.ok) {
    throw new Error(`Failed to load samples (${res.status})`)
  }

  const data = (await res.json()) as { samples: Sample[] }
  return data.samples
}

export async function sampleToFile(sample: Sample): Promise<File> {
  const res = await fetch(sample.image_url)

  if (!res.ok) {
    throw new Error(`Failed to fetch sample image (${res.status})`)
  }

  const blob = await res.blob()
  return new File([blob], `${sample.id}.jpg`, { type: blob.type || 'image/jpeg' })
}
