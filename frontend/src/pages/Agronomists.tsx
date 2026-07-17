import { useEffect, useState } from 'react'
import { createUser, listUsers } from '../api'
import type { User } from '../api'

export default function Agronomists() {
  const [agronomists, setAgronomists] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const reload = () => {
    listUsers('agronomist')
      .then(setAgronomists)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }

  useEffect(reload, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const [first_name, ...rest] = name.trim().split(' ')
      await createUser({
        username: username.trim(),
        password,
        role: 'agronomist',
        email: email.trim(),
        first_name: first_name || '',
        last_name: rest.join(' '),
      })
      setName('')
      setUsername('')
      setEmail('')
      setPassword('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add agronomist')
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
          Agronomists
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Provision and oversee agronomist accounts.
        </p>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <section className="grid gap-6 md:grid-cols-2">
        <div className="panel p-5">
          <p className="eyebrow mb-3">All agronomists</p>
          {agronomists.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--faint)' }}>
              None yet.
            </p>
          ) : (
            <ul className="divide-y text-sm" style={{ borderColor: 'var(--border)' }}>
              {agronomists.map((a) => (
                <li key={a.id} className="flex justify-between py-2">
                  <span style={{ color: 'var(--text)' }}>{a.display_name}</span>
                  <span style={{ color: 'var(--faint)' }}>@{a.username}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={add} className="panel p-5">
          <p className="eyebrow mb-3">Add an agronomist</p>
          <label className="field-label">
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" required />
          </label>
          <label className="field-label mt-3">
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" required />
          </label>
          <label className="field-label mt-3">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </label>
          <label className="field-label mt-3">
            Temporary password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              minLength={6}
              required
            />
          </label>
          <button type="submit" className="btn-primary mt-4 w-full">
            Add agronomist
          </button>
        </form>
      </section>
    </div>
  )
}
