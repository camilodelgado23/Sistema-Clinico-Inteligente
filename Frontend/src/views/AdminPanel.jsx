import { useState, useEffect, useCallback } from 'react'
import { adminAPI, assignmentAPI, arcoAPI } from '../services/api'
import './AdminPanel.css'

// ── Umbrales por defecto ───────────────────────────────────────────────────────
const DEFAULT_THRESHOLDS = {
  pending_signature_warn:     10,   // ⚠️ amarillo
  pending_signature_critical: 20,   // 🔴 rojo
  rejection_rate_warn:        30,   // % de rechazo — amarillo
  rejection_rate_critical:    50,   // % de rechazo — rojo
  acceptance_rate_warn:       25,   // % aceptación MUY baja — amarillo
  acceptance_rate_critical:   10,   // % aceptación MUY baja — rojo
}

const LS_KEY = 'clinai_alert_thresholds'

function loadThresholds() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) } : { ...DEFAULT_THRESHOLDS }
  } catch { return { ...DEFAULT_THRESHOLDS } }
}

function saveThresholds(t) {
  localStorage.setItem(LS_KEY, JSON.stringify(t))
}

// ── Evaluador de alertas ───────────────────────────────────────────────────────
function evaluateAlerts(stats, thresholds) {
  if (!stats) return []
  const alerts = []

  const rejRate = stats.total_inferences > 0
    ? ((stats.rejected / stats.total_inferences) * 100)
    : 0
  const accRate = stats.acceptance_rate != null
    ? stats.acceptance_rate * 100
    : null

  const pend = stats.pending_signature ?? 0
  if (pend >= thresholds.pending_signature_critical) {
    alerts.push({
      id: 'pending_critical', level: 'critical', stat: 'pending_signature',
      message: `${pend} inferencias pendientes de firma — supera el umbral crítico de ${thresholds.pending_signature_critical}`,
    })
  } else if (pend >= thresholds.pending_signature_warn) {
    alerts.push({
      id: 'pending_warn', level: 'warning', stat: 'pending_signature',
      message: `${pend} inferencias pendientes de firma — supera el umbral de advertencia de ${thresholds.pending_signature_warn}`,
    })
  }

  if (stats.total_inferences > 0) {
    if (rejRate >= thresholds.rejection_rate_critical) {
      alerts.push({
        id: 'rejection_critical', level: 'critical', stat: 'rejected',
        message: `Tasa de rechazo en ${rejRate.toFixed(1)}% — supera el umbral crítico de ${thresholds.rejection_rate_critical}%`,
      })
    } else if (rejRate >= thresholds.rejection_rate_warn) {
      alerts.push({
        id: 'rejection_warn', level: 'warning', stat: 'rejected',
        message: `Tasa de rechazo en ${rejRate.toFixed(1)}% — supera el umbral de advertencia de ${thresholds.rejection_rate_warn}%`,
      })
    }
  }

  if (accRate !== null && stats.total_inferences > 5) {
    if (accRate <= thresholds.acceptance_rate_critical) {
      alerts.push({
        id: 'acceptance_critical', level: 'critical', stat: 'acceptance_rate',
        message: `Tasa de aceptación crítica: ${accRate.toFixed(1)}% — por debajo del umbral de ${thresholds.acceptance_rate_critical}%`,
      })
    } else if (accRate <= thresholds.acceptance_rate_warn) {
      alerts.push({
        id: 'acceptance_warn', level: 'warning', stat: 'acceptance_rate',
        message: `Tasa de aceptación baja: ${accRate.toFixed(1)}% — por debajo del umbral de ${thresholds.acceptance_rate_warn}%`,
      })
    }
  }

  return alerts
}

function getStatAlertLevel(statKey, alerts) {
  const match = alerts.find(a => a.stat === statKey)
  return match?.level ?? null
}

// ── FIX: Validación de contraseña en el frontend ──────────────────────────────
// Replica las mismas reglas que _validate_password() del backend (admin.py)
// para mostrar errores claros ANTES de hacer la petición.
function validatePassword(password) {
  if (password.length < 10)
    return 'La contraseña debe tener al menos 10 caracteres'
  if (!/[A-Z]/.test(password))
    return 'La contraseña debe tener al menos una letra mayúscula'
  if (!/\d/.test(password))
    return 'La contraseña debe tener al menos un número'
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password))
    return 'La contraseña debe tener al menos un símbolo (!@#$%^&*...)'
  return null
}

// ── Banner de alertas ─────────────────────────────────────────────────────────
function AlertsBanner({ alerts, onDismiss }) {
  if (!alerts.length) return null
  return (
    <div className="alerts-banner">
      <div className="alerts-banner-header">
        <span className="alerts-banner-icon">
          {alerts.some(a => a.level === 'critical') ? '🚨' : '⚠️'}
        </span>
        <strong className="alerts-banner-title">
          {alerts.some(a => a.level === 'critical')
            ? `${alerts.filter(a => a.level === 'critical').length} alerta(s) crítica(s) detectada(s)`
            : `${alerts.length} advertencia(s) del sistema`}
        </strong>
        <button className="btn-icon alerts-dismiss" onClick={onDismiss} title="Cerrar alertas">✕</button>
      </div>
      <ul className="alerts-list">
        {alerts.map(a => (
          <li key={a.id} className={`alert-item alert-item-${a.level}`}>
            <span className="alert-item-icon">{a.level === 'critical' ? '🔴' : '🟡'}</span>
            {a.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Modal de configuración de umbrales ────────────────────────────────────────
function ThresholdsModal({ thresholds, onSave, onClose }) {
  const [local, setLocal] = useState({ ...thresholds })

  const field = (key, label, unit = '') => (
    <div className="threshold-field">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="number"
          className="input threshold-input"
          min={0}
          max={unit === '%' ? 100 : 9999}
          value={local[key]}
          onChange={e => setLocal(l => ({ ...l, [key]: Number(e.target.value) }))}
        />
        {unit && <span className="threshold-unit">{unit}</span>}
      </div>
    </div>
  )

  const handleSave = () => {
    saveThresholds(local)
    onSave(local)
    onClose()
  }

  const handleReset = () => {
    setLocal({ ...DEFAULT_THRESHOLDS })
  }

  return (
    <div className="modal-overlay">
      <div className="modal thresholds-modal">
        <div className="modal-header">
          <h3>⚙️ Configurar umbrales de alerta</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
          Las alertas se evalúan cada vez que se cargan las estadísticas del panel.
        </p>

        <div className="threshold-section">
          <div className="threshold-section-title">⏳ Pendientes de firma</div>
          <div className="threshold-row">
            {field('pending_signature_warn',     '⚠️ Advertencia (≥)', '')}
            {field('pending_signature_critical', '🔴 Crítico (≥)',     '')}
          </div>
        </div>

        <div className="threshold-section">
          <div className="threshold-section-title">❌ Tasa de rechazo</div>
          <div className="threshold-row">
            {field('rejection_rate_warn',     '⚠️ Advertencia (≥)', '%')}
            {field('rejection_rate_critical', '🔴 Crítico (≥)',     '%')}
          </div>
        </div>

        <div className="threshold-section">
          <div className="threshold-section-title">📊 Tasa de aceptación baja</div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0 0 0.5rem' }}>
            Activo solo con más de 5 inferencias totales.
          </p>
          <div className="threshold-row">
            {field('acceptance_rate_warn',     '⚠️ Advertencia (≤)', '%')}
            {field('acceptance_rate_critical', '🔴 Crítico (≤)',     '%')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button className="btn btn-ghost" onClick={handleReset}>Restaurar valores</button>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave}>Guardar</button>
        </div>
      </div>
    </div>
  )
}

// ── Stats cards ───────────────────────────────────────────────────────────────
function StatsBar({ stats, alerts }) {
  if (!stats) return null

  const cards = [
    { key: 'total_patients',   label: 'Total Pacientes',  value: stats.total_patients,   icon: '👥' },
    { key: 'total_inferences', label: 'Inferencias',      value: stats.total_inferences, icon: '🤖' },
    { key: 'accepted',         label: 'Aceptadas',        value: stats.accepted,         icon: '✅' },
    { key: 'rejected',         label: 'Rechazadas',       value: stats.rejected,         icon: '❌' },
    { key: 'pending_signature',label: 'Pendientes firma', value: stats.pending_signature, icon: '⏳' },
    {
      key: 'acceptance_rate',
      label: 'Tasa aceptación',
      value: stats.acceptance_rate != null
        ? `${(stats.acceptance_rate * 100).toFixed(1)}%` : '—',
      icon: '📊',
    },
    { key: 'total_users', label: 'Usuarios', value: stats.total_users, icon: '👤' },
  ]

  return (
    <div className="stats-bar">
      {cards.map(c => {
        const level = getStatAlertLevel(c.key, alerts)
        return (
          <div
            key={c.label}
            className={`stat-card ${level ? `stat-card-${level}` : ''}`}
            title={level ? `Alerta ${level === 'critical' ? 'crítica' : 'de advertencia'}` : ''}
          >
            <span className="stat-icon">
              {c.icon}
              {level === 'critical' && <span className="stat-alert-dot stat-alert-dot-critical">●</span>}
              {level === 'warning'  && <span className="stat-alert-dot stat-alert-dot-warning">●</span>}
            </span>
            <span className={`stat-value ${level ? `stat-value-${level}` : ''}`}>
              {c.value ?? '—'}
            </span>
            <span className="stat-label">{c.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Modal crear usuario ───────────────────────────────────────────────────────
function CreateUserModal({ onClose, onCreated }) {
  const [form,    setForm]    = useState({ username: '', password: '', role: 'MEDICO' })
  const [saving,  setSaving]  = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState('')
  // FIX: validación en tiempo real de la contraseña
  const [pwdError, setPwdError] = useState('')

  const handlePasswordChange = (e) => {
    const val = e.target.value
    setForm(f => ({ ...f, password: val }))
    setPwdError(val ? (validatePassword(val) || '') : '')
  }

  const submit = async () => {
    // FIX: validar antes de enviar para dar mensaje claro al usuario
    const pwdValidation = validatePassword(form.password)
    if (pwdValidation) {
      setPwdError(pwdValidation)
      return
    }
    if (!form.username.trim()) {
      setError('El nombre de usuario es obligatorio')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data } = await adminAPI.createUser(form)
      setResult(data)
      onCreated?.()
    } catch (e) {
      // FIX: mostrar el mensaje exacto del backend (ya sea string o array)
      const detail = e.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
      } else if (Array.isArray(detail)) {
        setError(detail.map(d => d.msg).join(', '))
      } else {
        setError('Error al crear usuario')
      }
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Crear nuevo usuario</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ color: 'var(--success)', fontWeight: 600 }}>
              ✅ Usuario creado exitosamente
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
              padding: '1rem', fontSize: '0.85rem', lineHeight: 1.8 }}>
              <div><strong>Usuario:</strong> {result.username}</div>
              <div><strong>Rol:</strong> {result.role}</div>
              <div style={{ marginTop: '0.5rem', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                Guarda estas claves — no se volverán a mostrar:
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                <div><strong>X-Access-Key:</strong> {result.access_key}</div>
                <div><strong>X-Permission-Key:</strong> {result.permission_key}</div>
              </div>
            </div>
            <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label className="form-label">Usuario</label>
              <input
                className="input"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="nombre_usuario"
              />
            </div>
            <div>
              <label className="form-label">Contraseña</label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={handlePasswordChange}
                placeholder="Mín. 10 chars, mayúscula, número, símbolo"
                style={pwdError ? { borderColor: 'var(--danger)' } : {}}
              />
              {/* FIX: checklist visual de requisitos de contraseña */}
              <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', lineHeight: 1.8,
                color: 'var(--text-tertiary)', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                {[
                  [form.password.length >= 10,          '10 caracteres mínimo'],
                  [/[A-Z]/.test(form.password),          'Una letra mayúscula'],
                  [/\d/.test(form.password),             'Un número'],
                  [/[!@#$%^&*(),.?":{}|<>]/.test(form.password), 'Un símbolo (!@#$%...)'],
                ].map(([ok, label]) => (
                  <span key={label} style={{ color: ok ? 'var(--success)' : 'var(--text-tertiary)' }}>
                    {ok ? '✓' : '○'} {label}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Rol</label>
              <select
                className="input"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                {/* FIX: values en MAYÚSCULAS exactas para que el backend los acepte */}
                <option value="MEDICO">Médico</option>
                <option value="ADMIN">Administrador</option>
                <option value="PACIENTE">Paciente</option>
              </select>
            </div>
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.85rem',
                background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)',
                borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem' }}>
                ⚠️ {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={saving || !form.username || !form.password || !!validatePassword(form.password)}
                onClick={submit}
              >
                {saving ? 'Creando…' : 'Crear usuario'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Regen keys modal ──────────────────────────────────────────────────────────
function RegenModal({ userId, onClose }) {
  const [keys,    setKeys]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAPI.regenKeys(userId)
      .then(r => setKeys(r.data))
      .catch(e => alert(e.response?.data?.detail || 'Error'))
      .finally(() => setLoading(false))
  }, [userId])

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>API Keys regeneradas</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        {loading ? <p>Generando…</p> : keys && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
              ⚠️ Las keys anteriores quedan inválidas inmediatamente.
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
              padding: '1rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
              wordBreak: 'break-all', lineHeight: 1.8 }}>
              <div><strong>X-Access-Key:</strong> {keys.access_key}</div>
              <div><strong>X-Permission-Key:</strong> {keys.permission_key}</div>
            </div>
            <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Panel de migración masiva pacientes → usuarios PACIENTE ───────────────────
function MigrationPanel() {
  const [status,    setStatus]    = useState('idle') // idle | loading | done | error
  const [result,    setResult]    = useState(null)
  const [copiedRow, setCopiedRow] = useState(null)

  const copyField = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopiedRow(key)
    setTimeout(() => setCopiedRow(null), 2000)
  }

  const copyAllCSV = () => {
    if (!result?.entry?.length) return
    const header = 'patient_name,username,access_key,permission_key'
    const rows = result.entry.map(
      e => `"${e.patient_name}","${e.username}","${e.access_key}","${e.permission_key}"`
    )
    navigator.clipboard.writeText([header, ...rows].join('\n'))
  }

  const run = async () => {
    setStatus('loading')
    setResult(null)
    try {
      const { data } = await adminAPI.migratePatientUsers()
      setResult(data)
      setStatus('done')
    } catch (e) {
      setResult({ error: e.response?.data?.detail || e.message })
      setStatus('error')
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-icon">🔄</span>
        <div>
          <h3 style={{ margin: 0 }}>Migrar pacientes existentes a usuarios</h3>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Crea un usuario con rol <strong style={{ color: 'var(--cyan)' }}>PACIENTE</strong> para
            cada paciente que aún no tenga credenciales de acceso al sistema.
          </p>
        </div>
      </div>

      {status === 'idle' && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 'var(--radius-sm)', padding: '0.625rem 0.875rem',
          fontSize: '0.8rem', color: '#fbbf24', marginBottom: '0.875rem' }}>
          ⚠️ Las claves generadas se mostrarán <strong>una sola vez</strong> — descárgalas antes de cerrar.
        </div>
      )}

      {status !== 'done' && (
        <button
          className="btn btn-primary"
          style={{ alignSelf: 'flex-start', opacity: status === 'loading' ? 0.6 : 1 }}
          disabled={status === 'loading'}
          onClick={run}
        >
          {status === 'loading' ? '⏳ Procesando…' : '▶ Ejecutar migración'}
        </button>
      )}

      {status === 'error' && (
        <div style={{ color: 'var(--danger)', fontSize: '0.85rem',
          background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem', marginTop: '0.75rem' }}>
          ⚠️ {result?.error}
        </div>
      )}

      {status === 'done' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginTop: '0.75rem' }}>
          <div style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.9rem' }}>
            ✅ {result.message}
          </div>

          {result.entry?.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                  🔑 Guarda estas credenciales — no se volverán a mostrar
                </span>
                <button className="btn btn-ghost btn-sm" onClick={copyAllCSV}>
                  📋 Copiar todo como CSV
                </button>
              </div>

              <div className="table-wrap" style={{ borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)', overflow: 'auto' }}>
                <table className="table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Paciente</th>
                      <th>Usuario</th>
                      <th>X-Access-Key</th>
                      <th>X-Permission-Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.entry.map((row, i) => (
                      <tr key={i}>
                        <td>{row.patient_name}</td>
                        <td style={{ color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
                          {row.username}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                              color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                              {row.access_key}
                            </code>
                            <button className="btn btn-ghost btn-sm"
                              style={{ whiteSpace: 'nowrap', padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}
                              onClick={() => copyField(row.access_key, `ak-${i}`)}>
                              {copiedRow === `ak-${i}` ? '✓' : '⧉'}
                            </button>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                              color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                              {row.permission_key}
                            </code>
                            <button className="btn btn-ghost btn-sm"
                              style={{ whiteSpace: 'nowrap', padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}
                              onClick={() => copyField(row.permission_key, `pk-${i}`)}>
                              {copiedRow === `pk-${i}` ? '✓' : '⧉'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button className="btn btn-ghost"
                style={{ alignSelf: 'flex-start', fontSize: '0.8rem' }}
                onClick={run}>
                🔄 Volver a ejecutar (nuevos pacientes sin usuario)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sección Usuarios ──────────────────────────────────────────────────────────
function UsersSection() {
  const [users,        setUsers]        = useState([])
  const [total,        setTotal]        = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [showCreate,   setShowCreate]   = useState(false)
  const [regenId,      setRegenId]      = useState(null)
  const [page,         setPage]         = useState(0)
  const [showDeleted,  setShowDeleted]  = useState(false)
  const [roleFilter,   setRoleFilter]   = useState('')   // ← NUEVO: filtro de rol
  const LIMIT = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.listUsers({
        limit: LIMIT,
        offset: page * LIMIT,
        include_deleted: showDeleted,
        role: roleFilter || undefined,           // ← NUEVO
      })
      setUsers(data.entry || [])
      setTotal(data.total)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [page, showDeleted, roleFilter])             // ← NUEVO dep

  useEffect(() => { load() }, [load])

  const toggleActive = async (u) => {
    try {
      await adminAPI.updateUser(u.id, { is_active: !u.is_active })
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error') }
  }

  const softDelete = async (u) => {
    if (!confirm(`¿Desactivar y eliminar a ${u.username}?`)) return
    try {
      await adminAPI.deleteUser(u.id)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error') }
  }

  const restoreUser = async (u) => {
    if (!confirm(`¿Restaurar al usuario ${u.username}?`)) return
    try {
      await adminAPI.restoreUser(u.id)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error al restaurar') }
  }

  const ROLE_BADGE = {
    ADMIN:    { cls: 'badge-warning',  label: 'Admin'   },
    MEDICO:   { cls: 'badge-success',  label: 'Médico'  },
    PACIENTE: { cls: 'badge-info',     label: 'Paciente'},
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}
      {regenId && (
        <RegenModal userId={regenId} onClose={() => { setRegenId(null); load() }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Usuarios del sistema ({total})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem',
            fontSize: '0.78rem', color: showDeleted ? 'var(--danger)' : 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={e => { setShowDeleted(e.target.checked); setPage(0) }}
              style={{ accentColor: 'var(--danger)', cursor: 'pointer' }}
            />
            Mostrar eliminados
          </label>
          {/* ── Filtro por rol ── */}
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            {['', 'ADMIN', 'MEDICO', 'PACIENTE'].map(r => (
              <button
                key={r || 'TODOS'}
                onClick={() => { setRoleFilter(r); setPage(0) }}
                style={{
                  padding: '0.25rem 0.75rem', fontSize: '0.72rem', borderRadius: '999px',
                  border: '1px solid',
                  borderColor: roleFilter === r ? 'var(--cyan)' : 'var(--border-subtle)',
                  background: roleFilter === r ? 'rgba(6,182,212,0.12)' : 'transparent',
                  color: roleFilter === r ? 'var(--cyan)' : 'var(--text-tertiary)',
                  cursor: 'pointer', fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em', transition: 'all 0.15s',
                }}
              >
                {r || 'TODOS'}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Crear usuario
        </button>
      </div>

      {showDeleted && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.875rem',
          fontSize: '0.8rem', color: '#fca5a5',
        }}>
          🗑 Mostrando todos los usuarios, incluidos los eliminados con soft-delete.
        </div>
      )}

      <MigrationPanel />

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Creado</th>
                {showDeleted && <th>Eliminado</th>}
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={showDeleted ? 6 : 5} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Cargando…</td></tr>
              ) : users.map(u => {
                const isDeleted = !!u.deleted_at
                return (
                  <tr key={u.id} style={isDeleted ? { opacity: 0.6, background: 'rgba(220,38,38,0.04)' } : {}}>
                    <td style={{ fontWeight: 500 }}>
                      {u.username}
                      {isDeleted && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem',
                          color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                          [eliminado]
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${ROLE_BADGE[u.role]?.cls || ''}`}>
                        {ROLE_BADGE[u.role]?.label || u.role}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${isDeleted ? '' : u.is_active ? 'badge-success' : 'badge-warning'}`}
                        style={isDeleted ? { background: 'rgba(220,38,38,0.15)',
                          color: 'var(--danger)', border: '1px solid rgba(220,38,38,0.3)' } : {}}>
                        {isDeleted ? 'Eliminado' : u.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                      {new Date(u.created_at).toLocaleDateString('es-CO')}
                    </td>
                    {showDeleted && (
                      <td style={{ color: 'var(--danger)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                        {isDeleted ? new Date(u.deleted_at).toLocaleDateString('es-CO') : '—'}
                      </td>
                    )}
                    <td>
                      <div style={{ display: 'flex', gap: '0.375rem' }}>
                        {isDeleted ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--success)', borderColor: 'rgba(34,197,94,0.3)' }}
                            onClick={() => restoreUser(u)}
                          >
                            ♻ Restaurar
                          </button>
                        ) : (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)}
                              title={u.is_active ? 'Desactivar' : 'Activar'}>
                              {u.is_active ? '⏸' : '▶'}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setRegenId(u.id)}
                              title="Regenerar API Keys">🔑</button>
                            <button className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--danger)' }}
                              onClick={() => softDelete(u)}
                              title="Eliminar (soft-delete)">🗑</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Ant.</button>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {page + 1} / {totalPages}
          </span>
          <button className="btn btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Sig. →</button>
        </div>
      )}
    </div>
  )
}

// ── Sección Audit Log ─────────────────────────────────────────────────────────
function AuditSection() {
  const [logs,    setLogs]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ action: '', user_id: '', date_from: '', date_to: '' })
  const [page,    setPage]    = useState(0)
  const LIMIT = 20

  const load = useCallback(async () => {
    setLoading(true)
    const params = { limit: LIMIT, offset: page * LIMIT }
    if (filters.action)    params.action    = filters.action
    if (filters.user_id)   params.user_id   = filters.user_id
    if (filters.date_from) params.date_from = filters.date_from
    if (filters.date_to)   params.date_to   = filters.date_to
    try {
      const { data } = await adminAPI.auditLog(params)
      setLogs(data.entry || [])
      setTotal(data.total)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [page, filters])

  useEffect(() => { load() }, [load])

  const exportLog = async (fmt) => {
    try {
      const { data } = await adminAPI.exportAudit(fmt)
      const url  = URL.createObjectURL(new Blob([data]))
      const link = document.createElement('a')
      link.href = url
      link.download = `audit_log.${fmt}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) { alert('Error al exportar') }
  }

  const RESULT_COLOR = { SUCCESS: 'var(--success)', FAILURE: 'var(--danger)', null: 'var(--text-tertiary)' }
  const totalPages = Math.ceil(total / LIMIT)

  const COMMON_ACTIONS = [
    '', 'LOGIN', 'LOGOUT', 'VIEW_PATIENT', 'LIST_PATIENTS',
    'UPLOAD_IMAGE', 'RUN_INFERENCE', 'SIGN_REPORT',
    'CRITICAL_ALERT_TRIGGERED', 'CREATE_USER', 'DELETE_USER',
    'HABEAS_DATA_ACCEPTED', 'CLOSE_PATIENT', 'ASSIGN_PATIENT', 'REMOVE_ASSIGNMENT',
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="card">
        <div className="card-header">
          <span className="card-icon">🔍</span>
          <h3>Filtros del Audit Log</h3>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">Acción</label>
            <select className="input" style={{ width: 200 }} value={filters.action}
              onChange={e => { setFilters(f => ({ ...f, action: e.target.value })); setPage(0) }}>
              {COMMON_ACTIONS.map(a => (
                <option key={a} value={a}>{a || '— Todas —'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Desde</label>
            <input type="date" className="input" value={filters.date_from}
              onChange={e => { setFilters(f => ({ ...f, date_from: e.target.value })); setPage(0) }} />
          </div>
          <div>
            <label className="form-label">Hasta</label>
            <input type="date" className="input" value={filters.date_to}
              onChange={e => { setFilters(f => ({ ...f, date_to: e.target.value })); setPage(0) }} />
          </div>
          <button className="btn btn-ghost"
            onClick={() => { setFilters({ action: '', user_id: '', date_from: '', date_to: '' }); setPage(0) }}>
            Limpiar
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={() => exportLog('json')}>⬇ JSON</button>
            <button className="btn btn-ghost" onClick={() => exportLog('csv')}>⬇ CSV</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th><th>Usuario</th><th>Rol</th>
                <th>Acción</th><th>Recurso</th><th>IP</th><th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Cargando…</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Sin registros</td></tr>
              ) : logs.map(log => (
                <tr key={log.id}>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {new Date(log.ts).toLocaleString('es-CO')}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>
                    <code>{log.user_id?.slice(0, 8) || '—'}…</code>
                  </td>
                  <td><span className="badge" style={{ fontSize: '0.7rem' }}>{log.role || '—'}</span></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--cyan)' }}>
                    {log.action}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{log.resource_type || '—'}</td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {log.ip_address || '—'}
                  </td>
                  <td>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600,
                      color: RESULT_COLOR[log.result] || 'var(--text-secondary)' }}>
                      {log.result || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Ant.</button>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Página {page + 1} de {totalPages} · {total} registros
          </span>
          <button className="btn btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Sig. →</button>
        </div>
      )}
    </div>
  )
}

// ── Sección Asignaciones ──────────────────────────────────────────────────────
function AssignmentsSection() {
  const [assignments, setAssignments] = useState([])
  const [doctors,     setDoctors]     = useState([])
  const [patients,    setPatients]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [filterDoc,   setFilterDoc]   = useState('')
  const [form,        setForm]        = useState({ patient_id: '', doctor_id: '' })
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (filterDoc) params.doctor_id = filterDoc
      const [aRes, dRes, pRes] = await Promise.all([
        assignmentAPI.list(params),
        assignmentAPI.listDoctors(),
        assignmentAPI.listPatients(),
      ])
      setAssignments(aRes.data.entry || [])
      setDoctors(dRes.data)
      setPatients(pRes.data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [filterDoc])

  useEffect(() => { load() }, [load])

  const handleAssign = async () => {
    if (!form.patient_id || !form.doctor_id) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await assignmentAPI.create(form)
      setSuccess('Paciente asignado correctamente.')
      setForm({ patient_id: '', doctor_id: '' })
      load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al asignar')
    } finally { setSaving(false) }
  }

  const handleRemove = async (aid, patName, docUser) => {
    if (!confirm(`¿Quitar la asignación de "${patName}" al médico "${docUser}"?`)) return
    try {
      await assignmentAPI.remove(aid)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error al quitar asignación') }
  }

  const assignedToSelected = new Set(
    form.doctor_id
      ? assignments.filter(a => a.doctor_id === form.doctor_id).map(a => a.patient_id)
      : []
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="card">
        <div className="card-header">
          <span className="card-icon">🔗</span>
          <h3>Nueva asignación</h3>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Médico</label>
            <select className="input" value={form.doctor_id}
              onChange={e => setForm(f => ({ ...f, doctor_id: e.target.value }))}>
              <option value="">— Seleccionar médico —</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.username}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Paciente</label>
            <select className="input" value={form.patient_id}
              onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))}>
              <option value="">— Seleccionar paciente —</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}
                  disabled={assignedToSelected.has(p.id)}
                  style={assignedToSelected.has(p.id) ? { color: 'var(--text-tertiary)' } : {}}>
                  {p.name}{assignedToSelected.has(p.id) ? ' (ya asignado)' : ''}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary"
            disabled={saving || !form.patient_id || !form.doctor_id}
            onClick={handleAssign}>
            {saving ? 'Asignando…' : '+ Asignar'}
          </button>
        </div>
        {error   && <div style={{ marginTop: '0.5rem', color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}
        {success && <div style={{ marginTop: '0.5rem', color: 'var(--success)', fontSize: '0.85rem' }}>✅ {success}</div>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label className="form-label" style={{ margin: 0 }}>Filtrar por médico:</label>
          <select className="input" style={{ width: 220 }} value={filterDoc}
            onChange={e => setFilterDoc(e.target.value)}>
            <option value="">— Todos —</option>
            {doctors.map(d => (
              <option key={d.id} value={d.id}>{d.username}</option>
            ))}
          </select>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {assignments.length} asignación{assignments.length !== 1 ? 'es' : ''}
        </span>
        {filterDoc && (
          <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }}
            onClick={() => setFilterDoc('')}>Limpiar filtro</button>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Paciente</th><th>Médico asignado</th>
                <th>Asignado por</th><th>Fecha asignación</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Cargando…</td></tr>
              ) : assignments.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem',
                  color: 'var(--text-tertiary)' }}>
                  {filterDoc
                    ? 'Este médico no tiene pacientes asignados aún.'
                    : 'No hay asignaciones. Crea una arriba.'}
                </td></tr>
              ) : assignments.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500 }}>{a.patient_name}</td>
                  <td>
                    <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>
                      {a.doctor_username}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {a.assigned_by || '—'}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {new Date(a.assigned_at).toLocaleString('es-CO')}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)', fontSize: '0.8rem' }}
                      onClick={() => handleRemove(a.id, a.patient_name, a.doctor_username)}
                      title="Quitar asignación">
                      ✕ Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!filterDoc && doctors.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-icon">📋</span>
            <h3>Resumen por médico</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {doctors.map(d => {
              const count = assignments.filter(a => a.doctor_id === d.id).length
              return (
                <div key={d.id} onClick={() => setFilterDoc(d.id)}
                  style={{
                    background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)', padding: '0.625rem 1rem',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.625rem',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-active)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                >
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{d.username}</span>
                  <span style={{
                    background: count > 0 ? 'rgba(6,182,212,0.15)' : 'var(--surface-1)',
                    color: count > 0 ? 'var(--cyan)' : 'var(--text-tertiary)',
                    border: `1px solid ${count > 0 ? 'rgba(6,182,212,0.3)' : 'var(--border-subtle)'}`,
                    borderRadius: '999px', padding: '0.1rem 0.5rem',
                    fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700,
                  }}>
                    {count} paciente{count !== 1 ? 's' : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sección ARCO (Ley 1581/2012) ─────────────────────────────────────────────
const ARCO_LABELS = {
  ACCESO:        { label: 'Acceso',        color: '#38bdf8' },
  RECTIFICACION: { label: 'Rectificación', color: '#f59e0b' },
  CANCELACION:   { label: 'Cancelación',   color: '#f87171' },
  OPOSICION:     { label: 'Oposición',     color: '#a78bfa' },
}
const STATUS_LABELS = {
  PENDING:  { label: 'Pendiente', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  RESOLVED: { label: 'Resuelta',  color: '#22c55e', bg: 'rgba(34,197,94,0.1)'   },
  REJECTED: { label: 'Rechazada', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
}

function ArcoResolveModal({ request, onClose, onResolved }) {
  const [status,     setStatus]     = useState('RESOLVED')
  const [resolution, setResolution] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const submit = async () => {
    if (resolution.trim().length < 10) { setError('La resolución debe tener al menos 10 caracteres'); return }
    setSaving(true)
    try {
      await arcoAPI.resolve(request.id, status, resolution.trim())
      onResolved()
      onClose()
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al resolver')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Resolver solicitud ARCO</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
            padding: '0.75rem 1rem', fontSize: '0.85rem', lineHeight: 1.6 }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Solicitud de {request.username} · {ARCO_LABELS[request.type]?.label}
            </div>
            <div style={{ color: 'var(--text-primary)' }}>{request.message}</div>
          </div>

          <div>
            <label className="form-label">Decisión</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[['RESOLVED', '✅ Atender'], ['REJECTED', '❌ Rechazar']].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setStatus(val)}
                  style={{
                    flex: 1, padding: '0.5rem', borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${status === val
                      ? (val === 'RESOLVED' ? 'rgba(34,197,94,0.5)' : 'rgba(248,113,113,0.5)')
                      : 'var(--border-subtle)'}`,
                    background: status === val
                      ? (val === 'RESOLVED' ? 'rgba(34,197,94,0.1)' : 'rgba(248,113,113,0.1)')
                      : 'transparent',
                    color: status === val
                      ? (val === 'RESOLVED' ? '#22c55e' : '#f87171')
                      : 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                    transition: 'all 0.15s',
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="form-label">Respuesta al usuario</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Explique la decisión tomada (mín. 10 caracteres)…"
              value={resolution}
              onChange={e => { setResolution(e.target.value); setError('') }}
              style={{ resize: 'vertical' }}
            />
            <div style={{ fontSize: '0.73rem', color: resolution.length >= 10
              ? 'var(--success)' : 'var(--text-tertiary)', marginTop: '0.2rem' }}>
              {resolution.length}/10 mínimo
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '0.8rem',
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.75rem' }}>
              ⚠️ {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={saving || resolution.trim().length < 10}
              onClick={submit}
            >
              {saving ? 'Guardando…' : 'Confirmar resolución'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ArcoSection() {
  const [requests,   setRequests]   = useState([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [resolving,  setResolving]  = useState(null)   // request obj to resolve
  const [page,       setPage]       = useState(0)
  const LIMIT = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await arcoAPI.list({
        status: statusFilter || undefined,
        limit: LIMIT,
        offset: page * LIMIT,
      })
      setRequests(data.entry || [])
      setTotal(data.total || 0)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [statusFilter, page])

  useEffect(() => { load() }, [load])

  const pending  = requests.filter(r => r.status === 'PENDING').length
  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {resolving && (
        <ArcoResolveModal
          request={resolving}
          onClose={() => setResolving(null)}
          onResolved={load}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h3 style={{ margin: '0 0 0.25rem' }}>Solicitudes ARCO</h3>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Ley 1581/2012 — Acceso, Rectificación, Cancelación, Oposición
          </p>
        </div>
        {pending > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.875rem',
            fontSize: '0.8rem', color: '#fbbf24', fontWeight: 600 }}>
            ⏳ {pending} pendiente{pending > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Filtro de estado */}
      <div style={{ display: 'flex', gap: '0.375rem' }}>
        {[['', 'Todas'], ['PENDING', 'Pendientes'], ['RESOLVED', 'Resueltas'], ['REJECTED', 'Rechazadas']].map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => { setStatusFilter(val); setPage(0) }}
            style={{
              padding: '0.3rem 0.875rem', fontSize: '0.75rem', borderRadius: '999px',
              border: '1px solid',
              borderColor: statusFilter === val ? 'var(--cyan)' : 'var(--border-subtle)',
              background: statusFilter === val ? 'rgba(6,182,212,0.12)' : 'transparent',
              color: statusFilter === val ? 'var(--cyan)' : 'var(--text-tertiary)',
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em', transition: 'all 0.15s',
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Usuario / Paciente</th>
                <th>Descripción</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Cargando…</td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem',
                  color: 'var(--text-tertiary)' }}>
                  {statusFilter ? 'No hay solicitudes con ese filtro' : 'No hay solicitudes ARCO registradas'}
                </td></tr>
              ) : requests.map(r => {
                const tipo   = ARCO_LABELS[r.type]   || { label: r.type,   color: '#888' }
                const estado = STATUS_LABELS[r.status] || { label: r.status, color: '#888', bg: 'transparent' }
                return (
                  <tr key={r.id}>
                    <td>
                      <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem',
                        borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                        fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                        background: tipo.color + '18', color: tipo.color,
                        border: `1px solid ${tipo.color}44` }}>
                        {tipo.label}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{r.username}</div>
                      {r.patient_name && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          👤 {r.patient_name}
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        maxWidth: 260 }}
                        title={r.message}>
                        {r.message}
                      </div>
                      {r.resolution && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                          fontStyle: 'italic', marginTop: '0.2rem' }}
                          title={r.resolution}>
                          ↪ {r.resolution.slice(0, 60)}{r.resolution.length > 60 ? '…' : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem',
                        borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                        background: estado.bg, color: estado.color,
                        border: `1px solid ${estado.color}44` }}>
                        {estado.label}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)',
                      fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {new Date(r.created_at).toLocaleDateString('es-CO')}
                    </td>
                    <td>
                      {r.status === 'PENDING' ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--cyan)', fontSize: '0.78rem' }}
                          onClick={() => setResolving(r)}
                        >
                          ✍ Resolver
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          {r.resolved_at
                            ? new Date(r.resolved_at).toLocaleDateString('es-CO')
                            : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Ant.</button>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {page + 1} / {totalPages}
          </span>
          <button className="btn btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Sig. →</button>
        </div>
      )}
    </div>
  )
}

// ── Main AdminPanel ───────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [stats,           setStats]           = useState(null)
  const [activeTab,       setActiveTab]       = useState('Usuarios')
  const [thresholds,      setThresholds]      = useState(loadThresholds)
  const [alerts,          setAlerts]          = useState([])
  const [alertsDismissed, setAlertsDismissed] = useState(false)
  const [showThresholds,  setShowThresholds]  = useState(false)

  const TABS = ['Estadísticas', 'Usuarios', 'Asignaciones', 'Audit Log', 'ARCO']

  const loadStats = useCallback(async () => {
    try {
      const { data } = await adminAPI.stats()
      setStats(data)
      const newAlerts = evaluateAlerts(data, thresholds)
      setAlerts(newAlerts)
      if (newAlerts.length > 0) setAlertsDismissed(false)
    } catch (e) { console.error(e) }
  }, [thresholds])

  useEffect(() => { loadStats() }, [loadStats])

  const handleThresholdsSave = (newThresholds) => {
    setThresholds(newThresholds)
    const newAlerts = evaluateAlerts(stats, newThresholds)
    setAlerts(newAlerts)
    if (newAlerts.length > 0) setAlertsDismissed(false)
  }

  return (
    <div className="admin-panel">
      {showThresholds && (
        <ThresholdsModal
          thresholds={thresholds}
          onSave={handleThresholdsSave}
          onClose={() => setShowThresholds(false)}
        />
      )}

      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Panel Administrador</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Control total del sistema ClinAI
          </p>
        </div>
        <button
          className={`btn btn-ghost thresholds-btn ${alerts.length > 0 ? 'thresholds-btn-active' : ''}`}
          onClick={() => setShowThresholds(true)}
          title="Configurar umbrales de alerta"
        >
          ⚙ Umbrales
          {alerts.length > 0 && (
            <span className={`threshold-badge threshold-badge-${alerts.some(a => a.level === 'critical') ? 'critical' : 'warning'}`}>
              {alerts.length}
            </span>
          )}
        </button>
      </div>

      {!alertsDismissed && alerts.length > 0 && (
        <AlertsBanner alerts={alerts} onDismiss={() => setAlertsDismissed(true)} />
      )}

      <StatsBar stats={stats} alerts={alerts} />

      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{
              padding: '0.625rem 1rem', background: 'none', border: 'none',
              borderBottom: activeTab === t ? '2px solid var(--cyan)' : '2px solid transparent',
              color: activeTab === t ? 'var(--cyan)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
              letterSpacing: '0.05em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'all 0.15s', marginBottom: '-1px',
            }}>
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'Estadísticas' && (
        <div className="grid-2" style={{ display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          <div className="card">
            <div className="card-header"><span className="card-icon">🤖</span><h3>Modelos de IA</h3></div>
            <div className="data-list">
              {[
                ['Total inferencias',     stats?.total_inferences],
                ['Diagnósticos aceptados',stats?.accepted],
                ['Diagnósticos rechazados',stats?.rejected],
                ['Pendientes de firma',   stats?.pending_signature],
                ['Tasa de aceptación',    stats?.acceptance_rate != null
                  ? `${(stats.acceptance_rate * 100).toFixed(1)}%` : '—'],
              ].map(([l, v]) => (
                <div key={l}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                    letterSpacing: '0.06em' }}>{l}</dt>
                  <dd style={{ fontWeight: 600, fontSize: '1.125rem', color: 'var(--text-primary)' }}>{v ?? '—'}</dd>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-icon">👥</span><h3>Usuarios y Pacientes</h3></div>
            <div className="data-list">
              {[
                ['Total usuarios',   stats?.total_users],
                ['Total pacientes',  stats?.total_patients],
              ].map(([l, v]) => (
                <div key={l}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                    letterSpacing: '0.06em' }}>{l}</dt>
                  <dd style={{ fontWeight: 600, fontSize: '1.125rem' }}>{v ?? '—'}</dd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Usuarios'     && <UsersSection />}
      {activeTab === 'Asignaciones' && <AssignmentsSection />}
      {activeTab === 'Audit Log'    && <AuditSection />}
      {activeTab === 'ARCO'         && <ArcoSection />}
    </div>
  )
}