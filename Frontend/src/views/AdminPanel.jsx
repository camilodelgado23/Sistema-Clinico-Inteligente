import { useState, useEffect, useCallback } from 'react'
import { adminAPI, assignmentAPI, practitionerAssignmentAPI, arcoAPI, ragAPI, fhirAPI } from '../services/api'
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

// ── Sección Pacientes ─────────────────────────────────────────────────────────
function PatientsSection() {
  const [patients,     setPatients]     = useState([])
  const [total,        setTotal]        = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [page,         setPage]         = useState(0)
  const [showDeleted,  setShowDeleted]  = useState(false)
  const LIMIT = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await fhirAPI.listPatients({
        limit: LIMIT,
        offset: page * LIMIT,
        include_deleted: showDeleted,
      })
      setPatients(data.entry || [])
      setTotal(data.total)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [page, showDeleted])

  useEffect(() => { load() }, [load])

  const softDelete = async (p) => {
    if (!confirm(`¿Eliminar (soft-delete) al paciente "${p.name}"?\nEsto marcará su HC como inactiva y sus observaciones como entered-in-error.`)) return
    try {
      await fhirAPI.deletePatient(p.id)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error al eliminar') }
  }

  const restore = async (p) => {
    if (!confirm(`¿Restaurar al paciente "${p.name}"?`)) return
    try {
      await fhirAPI.restorePatient(p.id)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error al restaurar') }
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h3 style={{ margin: 0 }}>Pacientes ({total})</h3>
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
        </div>
      </div>

      {showDeleted && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.875rem',
          fontSize: '0.8rem', color: '#fca5a5',
        }}>
          🗑 Mostrando todos los pacientes, incluidos los eliminados con soft-delete.
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Fecha nacimiento</th>
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
              ) : patients.length === 0 ? (
                <tr><td colSpan={showDeleted ? 6 : 5} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Sin pacientes</td></tr>
              ) : patients.map(p => {
                const isDeleted = !!p.deleted_at
                return (
                  <tr key={p.id} style={isDeleted ? { opacity: 0.6, background: 'rgba(220,38,38,0.04)' } : {}}>
                    <td style={{ fontWeight: 500 }}>
                      {p.name}
                      {isDeleted && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem',
                          color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                          [eliminado]
                        </span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                      {p.birth_date || '—'}
                    </td>
                    <td>
                      <span className={`badge ${isDeleted ? '' : p.is_active ? 'badge-success' : 'badge-warning'}`}
                        style={isDeleted ? { background: 'rgba(220,38,38,0.15)',
                          color: 'var(--danger)', border: '1px solid rgba(220,38,38,0.3)' } : {}}>
                        {isDeleted ? 'Eliminado' : p.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('es-CO') : '—'}
                    </td>
                    {showDeleted && (
                      <td style={{ color: 'var(--danger)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                        {isDeleted ? new Date(p.deleted_at).toLocaleDateString('es-CO') : '—'}
                      </td>
                    )}
                    <td>
                      <div style={{ display: 'flex', gap: '0.375rem' }}>
                        {isDeleted ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--success)', borderColor: 'rgba(34,197,94,0.3)' }}
                            onClick={() => restore(p)}
                          >
                            ♻ Restaurar
                          </button>
                        ) : (
                          <button className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--danger)' }}
                            onClick={() => softDelete(p)}
                            title="Eliminar HC (soft-delete)">🗑</button>
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

  // mapa patient_id → médico actual asignado
  const assignedDoctorByPatient = Object.fromEntries(
    assignments.map(a => [a.patient_id, a.doctor_username])
  )

  const selectedCurrentDoctor = form.patient_id
    ? assignedDoctorByPatient[form.patient_id]
    : null
  const isReassign = selectedCurrentDoctor && form.doctor_id &&
    assignments.find(a => a.patient_id === form.patient_id)?.doctor_id !== form.doctor_id

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="card">
        <div className="card-header">
          <span className="card-icon">🔗</span>
          <h3>Asignar paciente a médico</h3>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Paciente</label>
            <select className="input" value={form.patient_id}
              onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))}>
              <option value="">— Seleccionar paciente —</option>
              {patients.map(p => {
                const currentDoc = assignedDoctorByPatient[p.id]
                return (
                  <option key={p.id} value={p.id}>
                    {p.name}{currentDoc ? ` (${currentDoc})` : ' (sin asignar)'}
                  </option>
                )
              })}
            </select>
            {selectedCurrentDoctor && (
              <p style={{ fontSize: '0.7rem', color: 'var(--text-4)', marginTop: '0.25rem' }}>
                Médico actual: <strong style={{ color: 'var(--cyan)' }}>{selectedCurrentDoctor}</strong>
              </p>
            )}
          </div>
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
          <button className="btn btn-primary"
            disabled={saving || !form.patient_id || !form.doctor_id}
            onClick={handleAssign}>
            {saving ? 'Guardando…' : isReassign ? '↺ Reasignar' : '+ Asignar'}
          </button>
        </div>
        {isReassign && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--warning)',
            display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Este paciente ya tiene médico asignado. Confirmar reasignará al nuevo médico.
          </div>
        )}
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

// ── Sección Asignaciones de Médicos Externos ──────────────────────────────────
function PractitionerAssignmentsSection() {
  const [assignments,    setAssignments]    = useState([])
  const [practitioners,  setPractitioners]  = useState([])
  const [patients,       setPatients]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [filterPract,    setFilterPract]    = useState('')
  const [form,           setForm]           = useState({ practitioner_id: '', patient_id: '' })
  const [error,          setError]          = useState('')
  const [success,        setSuccess]        = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (filterPract) params.practitioner_id = filterPract
      const [aRes, prRes, pRes] = await Promise.all([
        practitionerAssignmentAPI.list(params),
        assignmentAPI.listPractitioners(),
        assignmentAPI.listPatients(),
      ])
      setAssignments(aRes.data.entry || [])
      setPractitioners(prRes.data)
      setPatients(pRes.data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [filterPract])

  useEffect(() => { load() }, [load])

  const handleAssign = async () => {
    if (!form.practitioner_id || !form.patient_id) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await practitionerAssignmentAPI.create(form)
      setSuccess('Paciente asignado correctamente al médico externo.')
      setForm({ practitioner_id: '', patient_id: '' })
      load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al asignar')
    } finally { setSaving(false) }
  }

  const handleRemove = async (aid, patName, practName) => {
    if (!confirm(`¿Quitar la asignación de "${patName}" al médico externo "${practName}"?`)) return
    try {
      await practitionerAssignmentAPI.remove(aid)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error al quitar asignación') }
  }

  const assignedPatientsByPract = assignments.reduce((acc, a) => {
    if (!acc[a.practitioner_id]) acc[a.practitioner_id] = 0
    acc[a.practitioner_id]++
    return acc
  }, {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="card">
        <div className="card-header">
          <span className="card-icon">🔗</span>
          <h3>Asignar paciente a médico externo</h3>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
          El médico externo solo podrá ver y consultar el Agente sobre los pacientes aquí asignados.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Médico externo</label>
            <select className="input" value={form.practitioner_id}
              onChange={e => setForm(f => ({ ...f, practitioner_id: e.target.value }))}>
              <option value="">— Seleccionar médico externo —</option>
              {practitioners.map(p => (
                <option key={p.id} value={p.id}>
                  {p.full_name} · {p.license_number}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="form-label">Paciente</label>
            <select className="input" value={form.patient_id}
              onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))}>
              <option value="">— Seleccionar paciente —</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary"
            disabled={saving || !form.practitioner_id || !form.patient_id}
            onClick={handleAssign}>
            {saving ? 'Guardando…' : '+ Asignar'}
          </button>
        </div>
        {error   && <div style={{ marginTop: '0.5rem', color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}
        {success && <div style={{ marginTop: '0.5rem', color: 'var(--success)', fontSize: '0.85rem' }}>✅ {success}</div>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label className="form-label" style={{ margin: 0 }}>Filtrar por médico externo:</label>
          <select className="input" style={{ width: 260 }} value={filterPract}
            onChange={e => setFilterPract(e.target.value)}>
            <option value="">— Todos —</option>
            {practitioners.map(p => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {assignments.length} asignación{assignments.length !== 1 ? 'es' : ''}
        </span>
        {filterPract && (
          <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }}
            onClick={() => setFilterPract('')}>Limpiar filtro</button>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Paciente</th><th>Médico externo</th>
                <th>Licencia</th><th>Asignado por</th><th>Fecha</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Cargando…</td></tr>
              ) : assignments.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem',
                  color: 'var(--text-tertiary)' }}>
                  {filterPract
                    ? 'Este médico externo no tiene pacientes asignados aún.'
                    : 'No hay asignaciones. Crea una arriba.'}
                </td></tr>
              ) : assignments.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500 }}>{a.patient_name}</td>
                  <td>
                    <span className="badge badge-purple" style={{ fontSize: '0.75rem' }}>
                      {a.practitioner_name}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {a.license_number}
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
                      onClick={() => handleRemove(a.id, a.patient_name, a.practitioner_name)}
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

      {!filterPract && practitioners.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-icon">📋</span>
            <h3>Resumen por médico externo</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {practitioners.map(p => {
              const count = assignedPatientsByPract[p.id] || 0
              return (
                <div key={p.id} onClick={() => setFilterPract(p.id)}
                  style={{
                    background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)', padding: '0.625rem 1rem',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.625rem',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-active)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                >
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{p.full_name}</span>
                  <span style={{
                    background: count > 0 ? 'rgba(168,85,247,0.15)' : 'var(--surface-1)',
                    color: count > 0 ? '#c084fc' : 'var(--text-tertiary)',
                    border: `1px solid ${count > 0 ? 'rgba(168,85,247,0.3)' : 'var(--border-subtle)'}`,
                    borderRadius: '999px', padding: '0.1rem 0.5rem',
                    fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700,
                  }}>
                    {count} pac.
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

// ── Sección Médicos Externos (Practitioners) ──────────────────────────────────
function PractitionersSection() {
  const [practitioners, setPractitioners] = useState([])
  const [total,         setTotal]         = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [showCreate,    setShowCreate]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.listPractitioners({ limit: 50, offset: 0 })
      setPractitioners(data.entry || [])
      setTotal(data.total)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async (p) => {
    try {
      await adminAPI.togglePractitioner(p.id)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {showCreate && <CreatePractitionerModal onClose={() => setShowCreate(false)} onCreated={load} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: '0 0 0.25rem' }}>Médicos Externos ({total})</h3>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Practitioners con acceso SuperUser via JWT propio · FHIR R4 interoperabilidad
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Registrar médico externo
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th><th>Email</th><th>Licencia</th>
                <th>Especialidad</th><th>Estado</th><th>Registro</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>Cargando…</td></tr>
              ) : practitioners.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-tertiary)' }}>
                  No hay médicos externos registrados. Usa el botón para crear uno.
                </td></tr>
              ) : practitioners.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.full_name}</td>
                  <td style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{p.email}</td>
                  <td>
                    <code style={{ fontSize: '0.75rem', color: 'var(--cyan)', background: 'rgba(56,189,248,0.08)',
                      padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{p.license_number}</code>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{p.specialty || '—'}</td>
                  <td>
                    <span className={`badge ${p.is_active ? 'badge-success' : 'badge-warning'}`}>
                      {p.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {new Date(p.created_at).toLocaleDateString('es-CO')}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm"
                      style={{ color: p.is_active ? 'var(--danger)' : 'var(--success)' }}
                      onClick={() => toggle(p)}
                      title={p.is_active ? 'Desactivar acceso' : 'Activar acceso'}>
                      {p.is_active ? '⏸ Desactivar' : '▶ Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CreatePractitionerModal({ onClose, onCreated }) {
  const [form,    setForm]    = useState({ full_name: '', email: '', password: '', license_number: '', specialty: '' })
  const [saving,  setSaving]  = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState('')

  const submit = async () => {
    if (!form.full_name.trim() || !form.email.trim() || !form.password || !form.license_number.trim()) {
      setError('Todos los campos obligatorios deben completarse')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data } = await adminAPI.createPractitioner(form)
      setResult(data)
      onCreated?.()
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Error al registrar médico')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Registrar Médico Externo</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ color: 'var(--success)', fontWeight: 600 }}>✅ Médico externo registrado</div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
              padding: '1rem', fontSize: '0.85rem', lineHeight: 1.8 }}>
              <div><strong>Nombre:</strong> {result.full_name}</div>
              <div><strong>Email:</strong> {result.email}</div>
              <div><strong>Licencia:</strong> {result.license_number}</div>
              <div style={{ marginTop: '0.5rem', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                El médico puede acceder desde <code>localhost/superuser</code> con esas credenciales.
              </div>
            </div>
            <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label className="form-label">Nombre completo *</label>
              <input className="input" placeholder="Dr. Juan García" value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Email *</label>
              <input className="input" type="email" placeholder="medico@hospital.com" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Contraseña *</label>
              <input className="input" type="password" placeholder="Contraseña segura" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Número de licencia médica *</label>
              <input className="input" placeholder="REG-12345" value={form.license_number}
                onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Especialidad</label>
              <input className="input" placeholder="Diabetología (opcional)" value={form.specialty}
                onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))} />
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
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit}
                disabled={saving || !form.full_name || !form.email || !form.password || !form.license_number}>
                {saving ? 'Registrando…' : 'Registrar médico'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sección Modelos ML/DL ─────────────────────────────────────────────────────
function MetricBar({ label, value, max = 1, color = '#38bdf8' }) {
  const pct = Math.round((value / max) * 100)
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.8rem' }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{(value * 100).toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function EpochChart({ epochs }) {
  if (!epochs || epochs.length === 0) return null
  const W = 340, H = 120, pad = { t: 8, r: 8, b: 24, l: 32 }
  const iW = W - pad.l - pad.r
  const iH = H - pad.t - pad.b
  const hasAcc = epochs.some(e => e.val_acc != null)
  const allVals = [...epochs.map(e => e.val_f1), ...(hasAcc ? epochs.map(e => e.val_acc) : [])]
  const minV = Math.min(...allVals) - 0.02
  const maxV = Math.max(...allVals) + 0.01
  const x = i => pad.l + (i / (epochs.length - 1)) * iW
  const y = v => pad.t + iH - ((v - minV) / (maxV - minV)) * iH
  const pathF1 = epochs.map((e, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(e.val_f1).toFixed(1)}`).join(' ')
  const pathAcc = hasAcc ? epochs.map((e, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(e.val_acc).toFixed(1)}`).join(' ') : null
  const areaD = `${pathF1} L${x(epochs.length - 1).toFixed(1)},${(pad.t + iH).toFixed(1)} L${pad.l},${(pad.t + iH).toFixed(1)} Z`
  const f1vals = epochs.map(e => e.val_f1)
  const bestI = f1vals.indexOf(Math.max(...f1vals))
  return (
    <div>
      <svg width={W} height={H} style={{ overflow: 'visible', display: 'block', maxWidth: '100%' }}>
        {[0, 0.5, 1].map(r => {
          const yy = pad.t + iH - r * iH
          return <line key={r} x1={pad.l} x2={pad.l + iW} y1={yy} y2={yy} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        })}
        <defs>
          <linearGradient id="epGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#epGrad)" />
        {pathAcc && (
          <path d={pathAcc} fill="none" stroke="#34d399" strokeWidth={1.5} strokeDasharray="4 2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        <path d={pathF1} fill="none" stroke="#38bdf8" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(bestI)} cy={y(f1vals[bestI])} r={4} fill="#38bdf8" stroke="#0f1923" strokeWidth={2} />
        {epochs.filter((_, i) => epochs.length <= 10 || i % 2 === 0).map((e) => {
          const origI = epochs.indexOf(e)
          return (
            <text key={e.epoch} x={x(origI)} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={9}>
              {e.epoch}
            </text>
          )
        })}
        <text x={pad.l - 4} y={pad.t + iH / 2} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={9}
          transform={`rotate(-90,${pad.l - 18},${pad.t + iH / 2})`}>val</text>
      </svg>
      {hasAcc && (
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.68rem', color: '#38bdf8' }}>
            <span style={{ display: 'inline-block', width: 16, height: 2, background: '#38bdf8', borderRadius: 1 }} />
            F1
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.68rem', color: '#34d399' }}>
            <span style={{ display: 'inline-block', width: 16, height: 2, background: '#34d399', borderRadius: 1, opacity: 0.8 }} />
            Acc
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
            Best F1: <strong style={{ color: '#38bdf8' }}>{(Math.max(...f1vals) * 100).toFixed(1)}%</strong>
            {hasAcc && <> · Acc: <strong style={{ color: '#34d399' }}>{(epochs[bestI].val_acc * 100).toFixed(1)}%</strong></>}
          </span>
        </div>
      )}
    </div>
  )
}

function ModelsSection() {
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [ragas,     setRagas]     = useState(null)

  useEffect(() => {
    adminAPI.modelMetrics()
      .then(r => setData(r.data))
      .catch(() => setError('No se pudieron cargar las métricas'))
      .finally(() => setLoading(false))
    ragAPI.ragasReport()
      .then(d => setRagas(d))
      .catch(() => setRagas(null))
  }, [])

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Cargando métricas…</div>
  if (error)   return <div style={{ padding: '2rem', color: '#f87171', textAlign: 'center' }}>{error}</div>

  const ml = data?.ml || {}
  const dl = data?.dl || {}
  const mlM = ml.metrics || {}
  const cardStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '1.5rem',
    flex: '1 1 340px',
    minWidth: 0,
  }
  const sectionHead = { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }
  const pill = (txt, color) => (
    <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 99, background: `${color}18`, color, border: `1px solid ${color}30`, fontWeight: 700 }}>
      {txt}
    </span>
  )

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Métricas de Modelos</h2>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Evaluación sobre conjunto de prueba — sin reentrenamiento
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>

        {/* ── ML Card ── */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>Modelo ML</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: 2 }}>{ml.model || 'XGBoost'}</div>
            </div>
            {pill('Diabetes', '#f59e0b')}
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <div style={sectionHead}>Rendimiento (test set)</div>
            <MetricBar label="F1 Score"   value={mlM.f1        || 0} color="#38bdf8" />
            <MetricBar label="AUC-ROC"    value={mlM.auc_roc   || 0} color="#a78bfa" />
            <MetricBar label="Precisión"  value={mlM.precision || 0} color="#34d399" />
            <MetricBar label="Recall"     value={mlM.recall    || 0} color="#fb923c" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Train', value: mlM.n_train },
              { label: 'Val',   value: mlM.n_val   },
              { label: 'Test',  value: mlM.n_test  },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.5rem' }}>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{s.value ?? '—'}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={sectionHead}>Dataset</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{ml.dataset || '—'}</div>

          {ml.features?.length > 0 && (
            <>
              <div style={{ ...sectionHead, marginTop: '1rem' }}>Features ({ml.features.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {ml.features.map(f => (
                  <span key={f} style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>{f}</span>
                ))}
              </div>
            </>
          )}

          {ml.thresholds && Object.keys(ml.thresholds).length > 0 && (
            <>
              <div style={{ ...sectionHead, marginTop: '1rem' }}>Umbrales de riesgo</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                {Object.entries(ml.thresholds).map(([cat, range]) => {
                  const colors = { LOW: '#34d399', MEDIUM: '#f59e0b', HIGH: '#fb923c', CRITICAL: '#f87171' }
                  const c = colors[cat] || '#8badc8'
                  return (
                    <div key={cat} style={{ fontSize: '0.72rem', padding: '4px 8px', borderRadius: 6, background: `${c}12`, color: c, border: `1px solid ${c}25` }}>
                      <strong>{cat}</strong>: {Array.isArray(range) ? `${(range[0]*100).toFixed(0)}–${(range[1]*100).toFixed(0)}%` : String(range)}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* ── DL Card ── */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>Modelo DL</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: 2 }}>{dl.architecture || dl.model || 'EfficientNet-B0'}</div>
            </div>
            {pill('Retinopatía', '#f87171')}
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <div style={sectionHead}>Rendimiento (validación)</div>
            <MetricBar label="Best val F1"          value={dl.best_val_f1        || 0} color="#38bdf8" />
            <MetricBar label="AUC-ROC macro (OvR)"  value={dl.auc_roc_macro      || 0} color="#a78bfa" />
            <MetricBar label="AUC-ROC weighted"      value={dl.auc_roc_weighted   || 0} color="#34d399" />
            {dl.n_val != null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: 6 }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Muestras de validación</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{dl.n_val.toLocaleString()}</span>
              </div>
            )}
          </div>

          {dl.epochs?.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={sectionHead}>Curva de entrenamiento — F1 por época</div>
              <EpochChart epochs={dl.epochs} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                <span>Época 1</span>
                <span>Época {dl.epochs.length}</span>
              </div>
            </div>
          )}

          <div style={{ marginBottom: '1.25rem' }}>
            <div style={sectionHead}>Dataset</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{dl.dataset || '—'}</div>
          </div>

          {dl.class_names?.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={sectionHead}>Clases ({dl.num_classes})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {dl.class_names.map((cls, i) => {
                  const riskColors = { LOW: '#34d399', MEDIUM: '#f59e0b', HIGH: '#fb923c', CRITICAL: '#f87171' }
                  const risk = dl.risk_map?.[String(i)]
                  const c = riskColors[risk] || '#8badc8'
                  return (
                    <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                      <span style={{ width: 20, height: 20, borderRadius: 4, background: `${c}20`, border: `1px solid ${c}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, color: c, flexShrink: 0 }}>{i}</span>
                      <span>{cls}</span>
                      {risk && <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: c, fontWeight: 600 }}>{risk}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {dl.clinical_note && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.75rem', lineHeight: 1.5 }}>
              {dl.clinical_note}
            </div>
          )}
        </div>

      </div>

      {/* ── RAGAS Card ── */}
      {ragas && (() => {
        const RAGAS_META = {
          faithfulness:      { label: 'Faithfulness',      color: '#a78bfa', min: 0.75, ideal: 0.85, desc: 'Respuesta soportada por el contexto (anti-alucinación)' },
          answer_relevancy:  { label: 'Answer Relevancy',  color: '#38bdf8', min: 0.70, ideal: 0.80, desc: 'Pertinencia de la respuesta a la pregunta' },
          context_precision: { label: 'Context Precision', color: '#34d399', min: 0.65, ideal: 0.75, desc: 'Precisión del contexto recuperado (Precision@k)' },
          context_recall:    { label: 'Context Recall',    color: '#fb923c', min: 0.65, ideal: 0.75, desc: 'Cobertura del contexto necesario para responder' },
        }
        const summary = ragas.summary || {}
        return (
          <div style={{ ...cardStyle, flexBasis: '100%', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 700 }}>Agente RAG</span>
                  {pill('RAGAS Eval', '#a78bfa')}
                  {pill(`${ragas.total_questions}Q`, '#64748b')}
                </div>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {ragas.evaluator || 'groq/llama-3.1-8b-instant'} · ragas==0.1.14 · HuggingFace embeddings
                </p>
              </div>
              {ragas.penalization_risk
                ? <span style={{ fontSize: '0.7rem', padding: '3px 10px', borderRadius: 99, background: '#f8717118', color: '#f87171', border: '1px solid #f8717130', fontWeight: 700 }}>⚠ Faithfulness &lt; 0.75</span>
                : <span style={{ fontSize: '0.7rem', padding: '3px 10px', borderRadius: 99, background: '#34d39918', color: '#34d399', border: '1px solid #34d39930', fontWeight: 700 }}>✓ Sin penalización</span>
              }
            </div>

            <p style={sectionHead}>MÉTRICAS RAGAS (TEST SET — {ragas.total_questions} preguntas)</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
              {Object.entries(RAGAS_META).map(([key, meta]) => {
                const score = summary[key]?.score ?? 0
                const pass  = score >= meta.min
                const pct   = Math.min(100, Math.round(score * 100))
                return (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.8rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{meta.label}</span>
                      <span style={{ color: pass ? meta.color : '#f87171', fontWeight: 700 }}>
                        {(score * 100).toFixed(1)}% {pass ? '✓' : '✗'}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden', position: 'relative' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: pass ? meta.color : '#f87171', borderRadius: 3, transition: 'width 0.6s ease' }} />
                      {/* línea de umbral mínimo */}
                      <div style={{ position: 'absolute', top: 0, left: `${meta.min * 100}%`, width: 2, height: '100%', background: 'rgba(255,255,255,0.4)' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                      <span>{meta.desc}</span>
                      <span>mín {(meta.min * 100).toFixed(0)}% | ideal {(meta.ideal * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Metodología:</strong> Evaluación offline con RAGAS 0.1.14.
              Recolección de respuestas con el agente híbrido (FAISS + BM25), evaluación con LLM Groq llama-3.1-8b-instant
              y embeddings locales HuggingFace all-MiniLM-L6-v2. Ejecutar <code>ragas_eval.py</code> para actualizar.
            </div>
          </div>
        )
      })()}

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

  const TABS = ['Estadísticas', 'Usuarios', 'Pacientes', 'Asignaciones', 'Asig. Ext.', 'Médicos Ext.', 'Modelos', 'Audit Log', 'ARCO']

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

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
        padding: '0.75rem 0', marginBottom: '0.5rem',
      }}>
        {TABS.map(t => {
          const isActive = activeTab === t
          return (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding: '0.45rem 1.1rem',
              borderRadius: '999px',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--cyan)' : 'var(--text-3)',
              background: isActive
                ? 'linear-gradient(145deg, #151a26, #1e2436)'
                : 'linear-gradient(145deg, #1e2436, #151a26)',
              boxShadow: isActive
                ? 'inset 3px 3px 6px rgba(0,0,0,0.5), inset -2px -2px 5px rgba(255,255,255,0.04), 0 0 0 1px rgba(0,212,255,0.18)'
                : '4px 4px 8px rgba(0,0,0,0.4), -2px -2px 6px rgba(255,255,255,0.04)',
              transition: 'all 0.18s ease',
              outline: 'none',
            }}>
              {t}
            </button>
          )
        })}
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

      {activeTab === 'Usuarios'      && <UsersSection />}
      {activeTab === 'Pacientes'     && <PatientsSection />}
      {activeTab === 'Asignaciones'  && <AssignmentsSection />}
      {activeTab === 'Asig. Ext.'   && <PractitionerAssignmentsSection />}
      {activeTab === 'Médicos Ext.'  && <PractitionersSection />}
      {activeTab === 'Modelos'       && <ModelsSection />}
      {activeTab === 'Audit Log'     && <AuditSection />}
      {activeTab === 'ARCO'          && <ArcoSection />}
    </div>
  )
}