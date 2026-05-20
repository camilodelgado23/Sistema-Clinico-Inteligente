import { useState } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { authAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import toast from 'react-hot-toast'
import './layout.css'

const NAV_ITEMS = [
  {
    path: '/dashboard',
    label: 'Pacientes',
    roles: ['ADMIN', 'MEDICO'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    path: '/agent',
    label: 'Agente RAG',
    roles: ['ADMIN', 'MEDICO'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
        <circle cx="9" cy="14" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1" fill="currentColor"/>
      </svg>
    ),
  },
  {
    path: '/admin',
    label: 'Administración',
    roles: ['ADMIN'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.07 4.93a9.81 9.81 0 0 1 1.63 2.09M22 12h-2M19.07 19.07a9.81 9.81 0 0 1-2.09 1.63M12 22v-2M4.93 19.07a9.81 9.81 0 0 1-1.63-2.09M2 12h2M4.93 4.93a9.81 9.81 0 0 1 2.09-1.63M12 2v2"/>
      </svg>
    ),
  },
]

export default function Layout() {
  const { role, clearAuth, pendingReports } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const normalizedRole = role?.toUpperCase()
  const [blockModal, setBlockModal] = useState(false)

  // Importar useState desde react — ya está importado en el módulo
  const guardedNavigate = (path) => {
    if (pendingReports > 0) { setBlockModal(true); return }
    navigate(path)
  }

  const handleLogout = async () => {
    if (pendingReports > 0) { setBlockModal(true); return }
    try { await authAPI.logout() } catch {}
    clearAuth()
    navigate('/login', { replace: true })
    toast.success('Sesión cerrada')
  }

  const visibleNav = NAV_ITEMS.filter(n => n.roles.includes(normalizedRole))

  const roleConfig = {
    ADMIN:    { label: 'Administrador',       color: '#f59e0b' },
    MEDICO:   { label: 'Médico Especialista', color: '#38bdf8' },
    PACIENTE: { label: 'Paciente',            color: '#22d3a5' },
  }
  const rc = roleConfig[normalizedRole] || { label: normalizedRole, color: '#8badc8' }

  return (
    <div className="layout">
      {blockModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:9999,
          display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--surface-1,#1e293b)',border:'1px solid #dc2626',
            borderRadius:12,padding:'2rem',maxWidth:420,width:'90%',textAlign:'center',boxShadow:'0 25px 50px rgba(0,0,0,0.5)'}}>
            <div style={{fontSize:'2.5rem',marginBottom:'0.75rem'}}>🔒</div>
            <h3 style={{color:'#fca5a5',marginBottom:'0.75rem',fontSize:'1.1rem',fontWeight:700}}>
              Reporte pendiente de firma
            </h3>
            <p style={{color:'var(--text-secondary,#94a3b8)',fontSize:'0.9rem',lineHeight:1.6,marginBottom:'1.5rem'}}>
              Hay reportes clínicos que aún no han sido firmados. Debe firmarlos antes de navegar a otra sección o cerrar sesión.
            </p>
            <button
              onClick={() => setBlockModal(false)}
              style={{background:'#06b6d4',color:'#000',border:'none',borderRadius:8,
                padding:'0.625rem 1.5rem',fontWeight:700,cursor:'pointer',fontSize:'0.95rem'}}>
              Entendido — volver a firmar
            </button>
          </div>
        </div>
      )}

      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2v20M2 12h20" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round"/>
              <circle cx="12" cy="12" r="5" stroke="#38bdf8" strokeWidth="1.5" fill="none" opacity="0.5"/>
            </svg>
          </div>
          <div>
            <div className="brand-name">ClinAI</div>
            <div className="brand-sub">Proyecto Final</div>
          </div>
        </div>

        {/* User pill */}
        <div className="sidebar-user" style={{ '--role-color': rc.color }}>
          <div className="user-avatar" style={{ background: `${rc.color}18`, borderColor: `${rc.color}30` }}>
            <span style={{ color: rc.color, fontSize: '0.7rem', fontWeight: 700 }}>
              {rc.label.charAt(0)}
            </span>
          </div>
          <div>
            <div className="user-role" style={{ color: rc.color }}>{rc.label}</div>
            <div className="user-system">Sistema activo</div>
          </div>
        </div>

        <div className="sidebar-divider" />

        {/* Navigation */}
        <nav className="sidebar-nav">
          <div className="nav-section-label">Módulos</div>
          {visibleNav.map(n => {
            const active = location.pathname.startsWith(n.path)
            return (
              <button
                key={n.path}
                className={`nav-item ${active ? 'nav-item--active' : ''}`}
                onClick={() => guardedNavigate(n.path)}
              >
                <span className="nav-icon">{n.icon}</span>
                <span>{n.label}</span>
                {active && <span className="nav-active-dot" />}
              </button>
            )
          })}
        </nav>

        {/* Bottom actions */}
        <div className="sidebar-bottom">
          <button className="nav-item nav-item--logout" onClick={handleLogout}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
            </svg>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="layout-main">
        <header className="layout-header">
          <div className="header-breadcrumb">
            {visibleNav.find(n => location.pathname.startsWith(n.path))?.label || 'ClinAI'}
          </div>
          <div className="header-right">
            <div className="header-badge">
              <span className="dot dot-low" />
              FHIR R4 activo
            </div>
            <div className="header-badge header-badge--security">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              AES-256
            </div>
          </div>
        </header>
        <main className="layout-content">
          <Outlet />
        </main>
        <footer className="layout-footer">
          ClinAI · FHIR R4 · Ley 1581/2012 · Resolución 866/2021 · AES-256
        </footer>
      </div>
    </div>
  )
}
