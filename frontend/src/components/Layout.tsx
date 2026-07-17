import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

/** App shell: fixed sidebar on desktop, slide-over drawer on mobile. */
export default function Layout() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:block">
        <div className="sticky top-0 h-screen">
          <Sidebar />
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-0 h-full shadow-xl">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header
          className="flex items-center gap-3 px-4 py-3 md:hidden"
          style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md p-2"
            style={{ color: 'var(--muted)' }}
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="text-sm font-bold tracking-[0.18em]" style={{ color: 'var(--text)' }}>
            AIRCROP
          </span>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
