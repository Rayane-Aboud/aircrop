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

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Agronomists</h1>
        <p className="text-sm text-slate-500">Provision and oversee agronomist accounts.</p>
      </div>

      {error && <p className="text-red-600">{error}</p>}

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">All agronomists</h2>
          {agronomists.length === 0 ? (
            <p className="text-sm text-slate-400">None yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {agronomists.map((a) => (
                <li key={a.id} className="flex justify-between py-2">
                  <span className="text-slate-700">{a.display_name}</span>
                  <span className="text-slate-400">@{a.username}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={add} className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Add an agronomist</h2>
          <label className="block text-xs text-slate-500">
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} required />
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Temporary password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              minLength={6}
              required
            />
          </label>
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Add agronomist
          </button>
        </form>
      </section>
    </div>
  )
}
