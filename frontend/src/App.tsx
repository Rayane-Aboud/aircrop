import { Navigate, Route, Routes } from 'react-router-dom'
import type { Role } from './api'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Agronomists from './pages/Agronomists'
import LandDetail from './pages/LandDetail'
import Login from './pages/Login'
import ProjectDetail from './pages/ProjectDetail'
import Projects from './pages/Projects'
import Reports from './pages/Reports'

// Where each role lands after login.
const HOME: Record<Role, string> = {
  super_admin: '/agronomists',
  agronomist: '/projects',
  farmer: '/reports',
}

function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'var(--bg)', color: 'var(--muted)' }}
      >
        Loading…
      </div>
    )
  }

  if (!user) return <Login />

  const home = HOME[user.role]

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Shared */}
        <Route path="/reports" element={<Reports />} />

        {/* Agronomist — projects (farmers) → lands → analysis */}
        {user.role === 'agronomist' && (
          <>
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:farmerId" element={<ProjectDetail />} />
            <Route path="/projects/:farmerId/lands/:landId" element={<LandDetail />} />
          </>
        )}

        {/* Super admin */}
        {user.role === 'super_admin' && <Route path="/agronomists" element={<Agronomists />} />}

        {/* Anything else → the role's home. */}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  )
}

export default App
