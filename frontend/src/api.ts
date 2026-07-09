export interface CropHealth {
  status: string
  confidence: number
  issues_detected: string[]
}

export interface AnalysisReport {
  summary: string
  recommendations: string[]
  source: string
}

export interface AnalysisResult {
  id: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  image_url: string | null
  report?: AnalysisReport
  crop_health?: CropHealth
  error?: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

export async function uploadImage(file: File): Promise<AnalysisResult> {
  const formData = new FormData()
  formData.append('image', file)

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
