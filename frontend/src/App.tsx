import { Navigate, Route, Routes } from 'react-router-dom'
import type { Role } from './api'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Agronomists from './pages/Agronomists'
import Analyze from './pages/Analyze'
import Farmers from './pages/Farmers'
import Login from './pages/Login'
import Reports from './pages/Reports'

// Where each role lands after login.
const HOME: Record<Role, string> = {
  super_admin: '/agronomists',
  agronomist: '/analyze',
  farmer: '/reports',
}

function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">
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

        {/* Agronomist */}
        {user.role === 'agronomist' && (
          <>
            <Route path="/analyze" element={<Analyze />} />
            <Route path="/farmers" element={<Farmers />} />
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
