import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createUser, listLands, listUsers } from '../api'
import type { Land, User } from '../api'

/**
 * Projects = the agronomist's client farmers. Each farmer is a project;
 * clicking a card drills into that farmer's lands. No dropdowns.
 */
export default function Projects() {
  const [farmers, setFarmers] = useState<User[]>([])
  const [lands, setLands] = useState<Land[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const [fName, setFName] = useState('')
  const [fUsername, setFUsername] = useState('')
  const [fPassword, setFPassword] = useState('')

  const reload = () => {
    listUsers('farmer')
      .then(setFarmers)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load farmers'))
    listLands()
      .then(setLands)
      .catch(() => setLands([]))
  }

  useEffect(reload, [])

  const landCount = useMemo(() => {
    const map: Record<number, number> = {}
    for (const l of lands) map[l.farmer] = (map[l.farmer] ?? 0) + 1
    return map
  }, [lands])

  const addFarmer = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const [first_name, ...rest] = fName.trim().split(' ')
      await createUser({
        username: fUsername.trim(),
        password: fPassword,
        role: 'farmer',
        first_name: first_name || '',
        last_name: rest.join(' '),
      })
      setFName('')
      setFUsername('')
      setFPassword('')
      setShowAdd(false)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add farmer')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
            Projects
          </h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Each project is a farmer you manage. Open one to see their lands and reports.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ New project'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {showAdd && (
        <form onSubmit={addFarmer} className="panel max-w-lg space-y-3 p-5">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            New farmer / project
          </p>
          <label className="field-label">
            Full name
            <input value={fName} onChange={(e) => setFName(e.target.value)} className="input" required />
          </label>
          <label className="field-label">
            Username
            <input value={fUsername} onChange={(e) => setFUsername(e.target.value)} className="input" required />
          </label>
          <label className="field-label">
            Temporary password
            <input
              type="password"
              value={fPassword}
              onChange={(e) => setFPassword(e.target.value)}
              className="input"
              minLength={6}
              required
            />
          </label>
          <button type="submit" className="btn-primary w-full">
            Create project
          </button>
        </form>
      )}

      {farmers.length === 0 ? (
        <p className="panel p-6 text-sm" style={{ color: 'var(--muted)' }}>
          No projects yet. Create your first one to get started.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {farmers.map((f) => (
            <Link key={f.id} to={`/projects/${f.id}`} className="card-select">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
                  style={{ background: 'var(--green-dim)', color: 'var(--green-hi)' }}
                >
                  {f.display_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>
                    {f.display_name}
                  </p>
                  <p className="truncate text-xs" style={{ color: 'var(--faint)' }}>
                    @{f.username}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="pill">{landCount[f.id] ?? 0} land(s)</span>
                <span className="text-xs" style={{ color: 'var(--green-hi)' }}>
                  Open →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
