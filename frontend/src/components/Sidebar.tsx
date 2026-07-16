import { NavLink } from 'react-router-dom'
import type { Role } from '../api'
import { ROLE_LABEL, useAuth } from '../auth'
import logo from '../assets/aircrop-logo.svg'

interface NavItem {
  to: string
  label: string
  icon: string
}

const NAV: Record<Role, NavItem[]> = {
  super_admin: [
    { to: '/agronomists', label: 'Agronomists', icon: '👥' },
    { to: '/reports', label: 'All Reports', icon: '📄' },
  ],
  agronomist: [
    { to: '/analyze', label: 'New Analysis', icon: '🔬' },
    { to: '/farmers', label: 'Farmers & Lands', icon: '🌾' },
    { to: '/reports', label: 'Reports', icon: '📄' },
  ],
  farmer: [{ to: '/reports', label: 'My Reports', icon: '📄' }],
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  if (!user) return null
  const items = NAV[user.role]

  return (
    <div className="flex h-full w-64 flex-col bg-white border-r border-slate-200">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-100">
        <img src={logo} alt="Aircrop" className="h-8 w-auto" />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
            {user.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{user.display_name}</p>
            <p className="truncate text-xs text-slate-500">{ROLE_LABEL[user.role]}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Log out
        </button>
      </div>
    </div>
  )
}
