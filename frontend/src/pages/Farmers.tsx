import { useEffect, useState } from 'react'
import { createLand, createUser, listLands, listUsers } from '../api'
import type { Land, User } from '../api'

export default function Farmers() {
  const [farmers, setFarmers] = useState<User[]>([])
  const [lands, setLands] = useState<Land[]>([])
  const [error, setError] = useState<string | null>(null)

  // New farmer form
  const [fName, setFName] = useState('')
  const [fUsername, setFUsername] = useState('')
  const [fPassword, setFPassword] = useState('')

  // New land form
  const [lName, setLName] = useState('')
  const [lFarmer, setLFarmer] = useState('')
  const [lCrop, setLCrop] = useState('')
  const [lLocation, setLLocation] = useState('')

  const reload = () => {
    listUsers('farmer')
      .then((f) => {
        setFarmers(f)
        if (f.length > 0 && !lFarmer) setLFarmer(String(f[0].id))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load farmers'))
    listLands().then(setLands).catch(() => setLands([]))
  }

  useEffect(reload, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add farmer')
    }
  }

  const addLand = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await createLand({
        name: lName.trim(),
        farmer: Number(lFarmer),
        crop_type: lCrop.trim(),
        location_name: lLocation.trim(),
      })
      setLName('')
      setLCrop('')
      setLLocation('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add land')
    }
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Farmers &amp; Lands</h1>
        <p className="text-sm text-slate-500">Manage the farmers you serve and their fields.</p>
      </div>

      {error && <p className="text-red-600">{error}</p>}

      {/* Farmers */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Your farmers</h2>
          {farmers.length === 0 ? (
            <p className="text-sm text-slate-400">No farmers yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {farmers.map((f) => (
                <li key={f.id} className="flex justify-between py-2">
                  <span className="text-slate-700">{f.display_name}</span>
                  <span className="text-slate-400">@{f.username}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={addFarmer} className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Add a farmer</h2>
          <label className="block text-xs text-slate-500">
            Full name
            <input value={fName} onChange={(e) => setFName(e.target.value)} className={inputCls} required />
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Username
            <input value={fUsername} onChange={(e) => setFUsername(e.target.value)} className={inputCls} required />
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Temporary password
            <input
              type="password"
              value={fPassword}
              onChange={(e) => setFPassword(e.target.value)}
              className={inputCls}
              minLength={6}
              required
            />
          </label>
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Add farmer
          </button>
        </form>
      </section>

      {/* Lands */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Lands</h2>
          {lands.length === 0 ? (
            <p className="text-sm text-slate-400">No lands yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {lands.map((l) => (
                <li key={l.id} className="flex justify-between py-2">
                  <span className="text-slate-700">
                    {l.name} <span className="text-slate-400">· {l.farmer_name}</span>
                  </span>
                  <span className="text-slate-400">{l.report_count} report(s)</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={addLand} className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Add a land</h2>
          <label className="block text-xs text-slate-500">
            Farmer
            <select
              value={lFarmer}
              onChange={(e) => setLFarmer(e.target.value)}
              className={inputCls}
              required
              disabled={farmers.length === 0}
            >
              {farmers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Land name
            <input value={lName} onChange={(e) => setLName(e.target.value)} className={inputCls} required />
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Crop type
            <input value={lCrop} onChange={(e) => setLCrop(e.target.value)} className={inputCls} placeholder="e.g. Wheat" />
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Location
            <input
              value={lLocation}
              onChange={(e) => setLLocation(e.target.value)}
              className={inputCls}
              placeholder="e.g. Blida, Algeria"
            />
          </label>
          <button
            type="submit"
            disabled={farmers.length === 0}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Add land
          </button>
        </form>
      </section>
    </div>
  )
}
