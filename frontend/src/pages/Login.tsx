import { useState } from 'react'
import { useAuth } from '../auth'
import mark from '../assets/aircrop-mark.svg'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      // Routing to the right landing page is handled by the app shell.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cad-grid flex min-h-screen items-center justify-center p-4">
      <div className="panel w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src={mark} alt="" className="h-14 w-14" />
          <span className="text-xl font-bold tracking-[0.16em]" style={{ color: 'var(--text)' }}>
            Aircrop
          </span>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Crop Health Platform
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="field-label">
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="input"
            />
          </label>
          <label className="field-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="input"
            />
          </label>

          {error && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
