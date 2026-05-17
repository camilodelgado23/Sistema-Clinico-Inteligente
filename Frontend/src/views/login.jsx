import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI, superuserAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import HabeasModal from '../components/HabeasModal'
import toast from 'react-hot-toast'
import './login.css'

const ROLE_ICONS  = { ADMIN: '⬡', MEDICO: '✚', PACIENTE: '◎' }
const ROLE_COLORS = { ADMIN: '#f59e0b', MEDICO: '#38bdf8', PACIENTE: '#10d48a' }

function roleHome(role) {
  if (role === 'PACIENTE') return '/my-profile'
  if (role === 'ADMIN')    return '/admin'
  return '/dashboard'
}

export default function Login() {
  const [isSuperUser, setIsSuperUser] = useState(false)

  // Normal login state
  const [accessKey, setAccessKey] = useState('')
  const [permKey,   setPermKey]   = useState('')
  const [authed,    setAuthed]    = useState(false)

  // SuperUser login state
  const [suEmail,   setSuEmail]   = useState('')
  const [suPass,    setSuPass]    = useState('')
  const [suLicense, setSuLicense] = useState('')

  const [loading, setLoading] = useState(false)
  const { setAuth, token, role, needsHabeas } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (token && !needsHabeas) navigate(roleHome(role), { replace: true })
  }, [token, needsHabeas, navigate, role])

  const handleNormalLogin = async (e) => {
    e.preventDefault()
    if (!accessKey.trim() || !permKey.trim()) return
    setLoading(true)
    try {
      const { data } = await authAPI.login(accessKey.trim(), permKey.trim())
      setAuth(data)
      setAuthed(true)
      if (!data.needs_habeas_data) {
        toast.success(`Bienvenido — ${data.role}`)
        navigate(roleHome(data.role?.toUpperCase()), { replace: true })
      }
    } catch (err) {
      toast.error(err.response?.status === 401 ? 'Credenciales inválidas' : 'Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  const handleSuperUserLogin = async (e) => {
    e.preventDefault()
    if (!suEmail.trim() || !suPass.trim() || !suLicense.trim()) return
    setLoading(true)
    try {
      const data = await superuserAPI.login({ email: suEmail.trim(), password: suPass, license_number: suLicense.trim() })
      toast.success('Acceso SuperUser concedido')
      navigate('/superuser', { state: { suToken: data.access_token, practitioner: { full_name: suEmail } } })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Credenciales SuperUser inválidas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      <div className="login-grid" aria-hidden />

      <div className="login-corner login-corner-tl" aria-hidden>
        <span>SYS:CLINAI_v2</span>
        <span>FHIR R4 · HL7</span>
      </div>
      <div className="login-corner login-corner-br" aria-hidden>
        <span>AES-256 · TLS</span>
        <span>Ley 1581/2012</span>
      </div>

      <div className="login-panel">
        {/* Brand */}
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

        {/* Mode toggle */}
        <div className="login-mode-toggle">
          <button
            type="button"
            className={`login-mode-btn ${!isSuperUser ? 'active' : ''}`}
            onClick={() => setIsSuperUser(false)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Sistema Interno
          </button>
          <button
            type="button"
            className={`login-mode-btn ${isSuperUser ? 'active' : ''}`}
            onClick={() => setIsSuperUser(true)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Médico Externo
          </button>
        </div>

        {/* Role indicator (normal login) */}
        {authed && role && !isSuperUser && (
          <div className="login-role-badge" style={{ '--role-color': ROLE_COLORS[role] }}>
            <span>{ROLE_ICONS[role]}</span>
            <span>{role}</span>
          </div>
        )}

        {/* Normal login form */}
        {!isSuperUser && (
          <form onSubmit={handleNormalLogin} className="login-form" noValidate>
            <div className="login-field">
              <label className="label" htmlFor="ak">X-Access-Key</label>
              <input id="ak" className="input login-input" type="password"
                placeholder="••••••••••••••••" value={accessKey}
                onChange={e => setAccessKey(e.target.value)} autoComplete="username" required />
            </div>
            <div className="login-field">
              <label className="label" htmlFor="pk">X-Permission-Key</label>
              <input id="pk" className="input login-input" type="password"
                placeholder="••••••••••••••••" value={permKey}
                onChange={e => setPermKey(e.target.value)} autoComplete="current-password" required />
            </div>
            <button type="submit" className={`btn btn-primary login-submit ${loading ? 'loading' : ''}`} disabled={loading}>
              {loading ? <><span className="spinner" style={{width:16,height:16}}/> Autenticando...</> : 'Ingresar al Sistema'}
            </button>
          </form>
        )}

        {/* SuperUser login form */}
        {isSuperUser && (
          <form onSubmit={handleSuperUserLogin} className="login-form" noValidate>
            <div className="login-su-banner">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Acceso SuperUser — Médico con identificador profesional
            </div>
            <div className="login-field">
              <label className="label" htmlFor="su-email">Email médico</label>
              <input id="su-email" className="input login-input" type="email"
                placeholder="medico@hospital.com" value={suEmail}
                onChange={e => setSuEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div className="login-field">
              <label className="label" htmlFor="su-pass">Contraseña</label>
              <input id="su-pass" className="input login-input" type="password"
                placeholder="••••••••" value={suPass}
                onChange={e => setSuPass(e.target.value)} autoComplete="current-password" required />
            </div>
            <div className="login-field">
              <label className="label" htmlFor="su-lic">Número de licencia médica</label>
              <input id="su-lic" className="input login-input"
                placeholder="REG-12345" value={suLicense}
                onChange={e => setSuLicense(e.target.value)} required />
            </div>
            <button type="submit" className={`btn login-submit login-submit--su ${loading ? 'loading' : ''}`} disabled={loading}>
              {loading ? <><span className="spinner" style={{width:16,height:16}}/> Verificando...</> : 'Acceder como Médico Externo'}
            </button>
          </form>
        )}

        <p className="login-note">
          {isSuperUser
            ? 'Acceso SuperUser · Interoperabilidad FHIR R4 · JWT firmado'
            : 'Autenticación de doble clave · Acceso auditado y cifrado'}
        </p>
      </div>

      <footer className="footer-bar" role="contentinfo">
        Protegido bajo Ley 1581/2012 · Datos cifrados AES-256 · Sistema auditado · FHIR R4
      </footer>

      <HabeasModal onAccepted={() => navigate(roleHome(role), { replace: true })} />
    </div>
  )
}