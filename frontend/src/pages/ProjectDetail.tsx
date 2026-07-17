import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createLand, listLands, listUsers } from '../api'
import type { Land, User } from '../api'

/**
 * A single project (farmer). Shows the farmer's info and their lands as
 * clickable cards. The farmer is fixed by the route — no farmer dropdown.
 */
export default function ProjectDetail() {
  const { farmerId } = useParams<{ farmerId: string }>()
  const id = Number(farmerId)

  const [farmer, setFarmer] = useState<User | null>(null)
  const [lands, setLands] = useState<Land[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const [lName, setLName] = useState('')
  const [lCrop, setLCrop] = useState('')
  const [lLocation, setLLocation] = useState('')

  const reload = () => {
    listUsers('farmer')
      .then((all) => setFarmer(all.find((u) => u.id === id) ?? null))
      .catch(() => setFarmer(null))
    listLands(id)
      .then(setLands)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load lands'))
  }

  useEffect(reload, [id])

  const addLand = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await createLand({
        name: lName.trim(),
        farmer: id,
        crop_type: lCrop.trim(),
        location_name: lLocation.trim(),
      })
      setLName('')
      setLCrop('')
      setLLocation('')
      setShowAdd(false)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add land')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/projects" className="text-xs" style={{ color: 'var(--green-hi)' }}>
          ← All projects
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Project</p>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
              {farmer?.display_name ?? 'Farmer'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {farmer ? `@${farmer.username}` : ''}
              {farmer?.email ? ` · ${farmer.email}` : ''}
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? 'Cancel' : '+ Add land'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {showAdd && (
        <form onSubmit={addLand} className="panel max-w-lg space-y-3 p-5">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            New land for {farmer?.display_name ?? 'this farmer'}
          </p>
          <label className="field-label">
            Land name
            <input value={lName} onChange={(e) => setLName(e.target.value)} className="input" required />
          </label>
          <label className="field-label">
            Crop type
            <input
              value={lCrop}
              onChange={(e) => setLCrop(e.target.value)}
              className="input"
              placeholder="e.g. Wheat"
            />
          </label>
          <label className="field-label">
            Location
            <input
              value={lLocation}
              onChange={(e) => setLLocation(e.target.value)}
              className="input"
              placeholder="e.g. Blida, Algeria"
            />
          </label>
          <button type="submit" className="btn-primary w-full">
            Add land
          </button>
        </form>
      )}

      <div>
        <p className="eyebrow mb-3">Lands</p>
        {lands.length === 0 ? (
          <p className="panel p-6 text-sm" style={{ color: 'var(--muted)' }}>
            No lands yet. Add one to run an analysis.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lands.map((l) => (
              <Link key={l.id} to={`/projects/${id}/lands/${l.id}`} className="card-select">
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  {l.name}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--faint)' }}>
                  {l.crop_type || 'Crop n/a'}
                  {l.location_name ? ` · ${l.location_name}` : ''}
                </p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="pill">{l.report_count} report(s)</span>
                  <span className="text-xs" style={{ color: 'var(--green-hi)' }}>
                    Open →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
