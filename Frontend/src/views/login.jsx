import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import HabeasModal from '../components/HabeasModal'
import toast from 'react-hot-toast'
import './login.css'

const ROLE_ICONS  = { ADMIN: '⬡', MEDICO: '✚', PACIENTE: '◎' }
const ROLE_COLORS = { ADMIN: '#f59e0b', MEDICO: '#38bdf8', PACIENTE: '#10d48a' }

// ── Helper: ruta destino según rol ────────────────────────────────────────────
function roleHome(role) {
  if (role === 'PACIENTE') return '/my-profile'
  if (role === 'ADMIN')    return '/admin'
  return '/dashboard'
}

export default function Login() {
  const [accessKey, setAccessKey] = useState('')
  const [permKey,   setPermKey]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [authed,    setAuthed]    = useState(false)
  const { setAuth, token, role, needsHabeas } = useAuthStore()
  const navigate = useNavigate()

  // Already logged in — redirige según su rol
  useEffect(() => {
    if (token && !needsHabeas) navigate(roleHome(role), { replace: true })
  }, [token, needsHabeas, navigate, role])

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!accessKey.trim() || !permKey.trim()) return
    setLoading(true)
    try {
      const { data } = await authAPI.login(accessKey.trim(), permKey.trim())
      setAuth(data)
      setAuthed(true)
      if (!data.needs_habeas_data) {
        toast.success(`Bienvenido — ${data.role}`)
        navigate(roleHome(data.role?.toUpperCase()), { replace: true })  // ✅ fix
      }
    } catch (err) {
      const msg = err.response?.status === 401
        ? 'Credenciales inválidas'
        : 'Error de conexión'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      {/* Animated background grid lines */}
      <div className="login-grid" aria-hidden />

      {/* Floating corner decorations */}
      <div className="login-corner login-corner-tl" aria-hidden>
        <span>SYS:CLINAI_v2</span>
        <span>FHIR R4 · HL7</span>
      </div>
      <div className="login-corner login-corner-br" aria-hidden>
        <span>AES-256 · TLS</span>
        <span>Ley 1581/2012</span>
      </div>

      <div className="login-panel">
        {/* Logo / brand */}
        <div className="login-brand">
          <div className="login-logo">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <rect width="36" height="36" rx="8" fill="rgba(56,189,248,0.1)" stroke="rgba(56,189,248,0.4)" strokeWidth="1"/>
              <path d="M18 8v20M8 18h20" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round"/>
              <circle cx="18" cy="18" r="4" fill="none" stroke="#38bdf8" strokeWidth="1.5"/>
            </svg>
          </div>
          <div>
            <h1 className="login-title">ClinAI</h1>
            <p className="login-subtitle">Sistema Clínico de Apoyo Diagnóstico</p>
          </div>
        </div>

        {/* Role indicator (shows after login attempt) */}
        {authed && role && (
          <div className="login-role-badge" style={{ '--role-color': ROLE_COLORS[role] }}>
            <span>{ROLE_ICONS[role]}</span>
            <span>{role}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} className="login-form" noValidate>
          <div className="login-field">
            <label className="label" htmlFor="ak">X-Access-Key</label>
            <input
              id="ak"
              className="input login-input"
              type="password"
              placeholder="••••••••••••••••"
              value={accessKey}
              onChange={e => setAccessKey(e.target.value)}
              autoComplete="username"
              aria-label="X-Access-Key"
              required
            />
          </div>

          <div className="login-field">
            <label className="label" htmlFor="pk">X-Permission-Key</label>
            <input
              id="pk"
              className="input login-input"
              type="password"
              placeholder="••••••••••••••••"
              value={permKey}
              onChange={e => setPermKey(e.target.value)}
              autoComplete="current-password"
              aria-label="X-Permission-Key"
              required
            />
          </div>

          <button
            type="submit"
            className={`btn btn-primary login-submit ${loading ? 'loading' : ''}`}
            disabled={loading}
            aria-busy={loading}
          >
            {loading
              ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Autenticando...</>
              : 'Ingresar al Sistema'}
          </button>
        </form>

        {/* Footer note */}
        <p className="login-note">
          Autenticación de doble clave · Acceso auditado y cifrado
        </p>
      </div>

      {/* Persistent footer */}
      <footer className="footer-bar" role="contentinfo">
        Protegido bajo Ley 1581/2012 · Datos cifrados AES-256 · Sistema auditado · FHIR R4
      </footer>

      {/* Habeas Data modal — redirige según rol tras aceptar */}
      <HabeasModal onAccepted={() => navigate(roleHome(role), { replace: true })} />  {/* ✅ fix */}
    </div>
  )
}