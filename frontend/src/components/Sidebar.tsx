import { NavLink } from 'react-router-dom'
import type { Role } from '../api'
import { ROLE_LABEL, useAuth } from '../auth'
import { useTheme } from '../theme'
import mark from '../assets/aircrop-mark.svg'

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
    { to: '/projects', label: 'Projects', icon: '🗂' },
    { to: '/reports', label: 'Reports', icon: '📄' },
  ],
  farmer: [{ to: '/reports', label: 'My Reports', icon: '📄' }],
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  if (!user) return null
  const items = NAV[user.role]

  return (
    <div
      className="flex h-full w-64 flex-col"
      style={{ background: 'var(--bg-2)', borderRight: '1px solid var(--border)' }}
    >
      <div
        className="flex items-center gap-2 px-5 py-5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <img src={mark} alt="" className="h-8 w-8" />
        <span className="text-base font-bold tracking-[0.14em]" style={{ color: 'var(--text)' }}>
          Aircrop
        </span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/projects'}
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
            style={({ isActive }) => ({
              background: isActive ? 'var(--green-dim)' : 'transparent',
              color: isActive ? 'var(--green-hi)' : 'var(--muted)',
              boxShadow: isActive ? 'inset 2px 0 0 var(--green)' : 'none',
            })}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="mb-3 flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{ background: 'var(--green-dim)', color: 'var(--green-hi)' }}
          >
            {user.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>
              {user.display_name}
            </p>
            <p className="truncate text-xs" style={{ color: 'var(--faint)' }}>
              {ROLE_LABEL[user.role]}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggle}
            className="btn-ghost"
            aria-label="Toggle colour theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button type="button" onClick={logout} className="btn-ghost flex-1">
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
