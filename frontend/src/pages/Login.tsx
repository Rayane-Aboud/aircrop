import { useState } from 'react'
import { useAuth } from '../auth'

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
          <span
            className="flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold"
            style={{ background: 'var(--green)', color: '#06130c' }}
          >
            A
          </span>
          <span className="text-lg font-bold tracking-[0.2em]" style={{ color: 'var(--text)' }}>
            AIRCROP
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
