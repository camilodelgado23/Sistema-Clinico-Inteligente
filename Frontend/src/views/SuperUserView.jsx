import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import './SuperUserView.css'

const OWN_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Crea un cliente axios dirigido al sistema destino
function makeSuAPI(baseUrl, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const base = baseUrl.replace(/\/$/, '')
  return {
    login: (body) =>
      axios.post(`${base}/api/v1/auth/superuser/login`, body).then(r => r.data),
    searchPatient: (identifier) =>
      axios.get(`${base}/api/v1/superuser/patients`, { params: { identifier }, headers }).then(r => r.data),
    createPatient: (fhirBody) =>
      axios.post(`${base}/api/v1/superuser/patients`, fhirBody, { headers }).then(r => r.data),
    getObservations: (patientId, loincCode) =>
      axios.get(`${base}/api/v1/superuser/patients/${patientId}/observations`,
        { params: loincCode ? { loinc_code: loincCode } : {}, headers }).then(r => r.data),
    createObservation: (patientId, fhirObs) =>
      axios.post(`${base}/api/v1/superuser/patients/${patientId}/observations`, fhirObs, { headers }).then(r => r.data),
    inference: (modelType, body) =>
      axios.post(`${base}/api/v1/superuser/inference/${modelType}`, body, { headers }).then(r => r.data),
  }
}

const TABS = [
  { id: 'search', label: 'Buscar Paciente', icon: '🔍' },
  { id: 'create', label: 'Crear Paciente',  icon: '➕' },
]

export default function SuperUserView() {
  const location = useLocation()
  const navigate = useNavigate()

  const [targetUrl,    setTargetUrl]    = useState(OWN_URL)
  const [editingUrl,   setEditingUrl]   = useState(false)
  const [draftUrl,     setDraftUrl]     = useState(OWN_URL)

  const [suToken,      setSuToken]      = useState(location.state?.suToken || null)
  const [practitioner, setPractitioner] = useState(location.state?.practitioner || null)
  const [tab,          setTab]          = useState('search')
  const [selectedPat,  setSelectedPat]  = useState(null)

  const api = makeSuAPI(targetUrl, suToken)

  const handleToken = (token, data) => {
    setSuToken(token)
    setPractitioner(data)
  }

  const logout = () => {
    setSuToken(null)
    setPractitioner(null)
    setSelectedPat(null)
    setTab('search')
  }

  const applyUrl = () => {
    const u = draftUrl.trim()
    if (!u) return
    // Si cambia el sistema, cierra sesión
    if (u !== targetUrl) {
      setSuToken(null)
      setPractitioner(null)
      setSelectedPat(null)
    }
    setTargetUrl(u)
    setEditingUrl(false)
  }

  const isOwnSystem = targetUrl === OWN_URL || targetUrl === window.location.origin

  return (
    <div className="su-standalone fade-in">
      {/* Top bar */}
      <div className="su-topbar">
        <div className="su-topbar-brand">
          <svg width="20" height="20" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="8" fill="rgba(56,189,248,0.1)" stroke="rgba(56,189,248,0.4)" strokeWidth="1"/>
            <path d="M18 8v20M8 18h20" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="18" cy="18" r="4" fill="none" stroke="#38bdf8" strokeWidth="1.5"/>
          </svg>
          <div>
            <span className="su-topbar-title">Portal Médico Externo</span>
            <span className="su-topbar-sub">Interoperabilidad · FHIR R4 · SuperUser JWT</span>
          </div>
        </div>
        <div className="flex gap-2 items-center" style={{flexWrap:'wrap'}}>
          {suToken && (
            <>
              <span className="badge badge-purple" style={{fontSize:'0.7rem'}}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                {practitioner?.full_name || practitioner?.email || 'SuperUser'}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>Cerrar sesión</button>
            </>
          )}
          <span className="badge badge-info" style={{fontSize:'0.65rem'}}>FHIR R4</span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/login')} style={{fontSize:'0.72rem'}}>
            ← Volver
          </button>
        </div>
      </div>

      {/* Sistema destino */}
      <div style={{
        background: isOwnSystem ? 'rgba(56,189,248,0.06)' : 'rgba(251,146,60,0.08)',
        border: `1px solid ${isOwnSystem ? 'rgba(56,189,248,0.18)' : 'rgba(251,146,60,0.3)'}`,
        borderRadius: 10, margin: '0 0 0 0', padding: '0.6rem 1.25rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isOwnSystem ? '#38bdf8' : '#fb923c'} strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span style={{fontSize:'0.75rem', color:'var(--text-secondary)', whiteSpace:'nowrap'}}>Sistema destino:</span>
        {editingUrl ? (
          <div className="flex gap-2" style={{flex:1, minWidth:200}}>
            <input
              className="input"
              style={{fontSize:'0.78rem', padding:'0.3rem 0.6rem', flex:1}}
              value={draftUrl}
              onChange={e => setDraftUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyUrl(); if (e.key === 'Escape') setEditingUrl(false) }}
              placeholder="http://ip-equipo:8000"
              autoFocus
            />
            <button className="btn btn-primary btn-sm" onClick={applyUrl}>Aplicar</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditingUrl(false)}>✕</button>
          </div>
        ) : (
          <>
            <code style={{fontSize:'0.76rem', color: isOwnSystem ? '#38bdf8' : '#fb923c', flex:1}}>
              {targetUrl}
            </code>
            <span style={{
              fontSize:'0.65rem', padding:'2px 7px', borderRadius:99,
              background: isOwnSystem ? 'rgba(56,189,248,0.12)' : 'rgba(251,146,60,0.15)',
              color: isOwnSystem ? '#38bdf8' : '#fb923c', fontWeight:700,
            }}>
              {isOwnSystem ? 'Mi sistema' : 'Sistema externo'}
            </span>
            <button className="btn btn-ghost btn-sm"
              onClick={() => { setDraftUrl(targetUrl); setEditingUrl(true) }}
              style={{fontSize:'0.7rem', padding:'0.2rem 0.6rem'}}>
              Cambiar sistema
            </button>
          </>
        )}
      </div>

      <div className="su-body">
        {!suToken && (
          <div className="su-login-center">
            <LoginPanel targetUrl={targetUrl} onToken={handleToken} />
          </div>
        )}

        {suToken && (
          <>
            {selectedPat && (
              <div className="su-selected-patient">
                <div className="su-selected-left">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <div>
                    <span className="su-selected-name">{selectedPat.name?.[0]?.text || '—'}</span>
                    <span className="su-selected-meta">
                      {selectedPat.identifier?.[0]?.value ? `CC: ${selectedPat.identifier[0].value} · ` : ''}
                      ID: {selectedPat.id} · Nac: {selectedPat.birthDate || '—'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setTab('obs')}>Ver Observaciones</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setTab('infer')}>Ejecutar Inferencia</button>
                  <button className="btn btn-ghost btn-sm" style={{color:'var(--text-4)'}} onClick={() => setSelectedPat(null)}>✕</button>
                </div>
              </div>
            )}

            <div className="su-tabs">
              {TABS.map(t => (
                <button key={t.id} className={`su-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
              {selectedPat && (
                <>
                  <button className={`su-tab ${tab === 'obs' ? 'active' : ''}`} onClick={() => setTab('obs')}>
                    <span>📊</span><span>Observaciones</span>
                  </button>
                  <button className={`su-tab su-tab--highlight ${tab === 'infer' ? 'active' : ''}`} onClick={() => setTab('infer')}>
                    <span>🤖</span><span>Inferencia</span>
                  </button>
                </>
              )}
            </div>

            <div className="su-content card">
              {tab === 'search' && <SearchPatientTab api={api} onSelectPatient={setSelectedPat} selectedPat={selectedPat} />}
              {tab === 'create' && <CreatePatientTab api={api} />}
              {tab === 'obs'    && <ObservationsTab  api={api} selectedPat={selectedPat} />}
              {tab === 'infer'  && <InferenceTab     api={api} selectedPat={selectedPat} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Login panel ─────────────────────────────────────────────────────────── */
function LoginPanel({ targetUrl, onToken }) {
  const [form, setForm] = useState({ email: '', password: '', license_number: '' })
  const [loading, setLoading] = useState(false)

  const handle = async e => {
    e.preventDefault()
    setLoading(true)
    try {
      const api = makeSuAPI(targetUrl, null)
      const data = await api.login({ email: form.email, password: form.password, license_number: form.license_number })
      onToken(data.access_token, { email: form.email })
      toast.success('Acceso SuperUser concedido')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Credenciales inválidas')
    } finally { setLoading(false) }
  }

  return (
    <div className="su-login-panel card">
      <div className="su-login-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.5">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <h3 style={{color:'var(--text-1)',marginBottom:'0.25rem'}}>Acceso SuperUser</h3>
      <p style={{fontSize:'0.78rem',color:'var(--text-3)',marginBottom:'1.5rem',textAlign:'center'}}>
        Médico externo con identificador profesional
      </p>
      <form onSubmit={handle} style={{display:'flex',flexDirection:'column',gap:'0.875rem',width:'100%'}}>
        <div>
          <label className="label">Email médico</label>
          <input className="input" type="email" placeholder="medico@hospital.com"
            value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required />
        </div>
        <div>
          <label className="label">Contraseña</label>
          <input className="input" type="password" placeholder="••••••••"
            value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} required />
        </div>
        <div>
          <label className="label">Número de licencia médica</label>
          <input className="input" placeholder="REG-12345"
            value={form.license_number} onChange={e => setForm(f => ({...f, license_number: e.target.value}))} required />
        </div>
        <button type="submit" className="btn btn-primary" style={{width:'100%',justifyContent:'center',
          background:'linear-gradient(135deg,rgba(168,85,247,0.8),rgba(139,92,246,0.9))',borderColor:'rgba(168,85,247,0.4)'}}
          disabled={loading}>
          {loading ? <><div className="spinner"/> Verificando…</> : 'Ingresar al Portal'}
        </button>
      </form>
    </div>
  )
}

/* ── Buscar Paciente ─────────────────────────────────────────────────────── */
function SearchPatientTab({ api, onSelectPatient, selectedPat }) {
  const [query,   setQuery]   = useState('')
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const data = await api.searchPatient(query.trim())
      setResult(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error en búsqueda')
    } finally { setLoading(false) }
  }

  const patients = result?.entry || []

  return (
    <div>
      <h3 style={{marginBottom:'0.5rem',color:'var(--text-1)'}}>Buscar Paciente</h3>
      <p style={{fontSize:'0.8rem',color:'var(--text-3)',marginBottom:'1rem'}}>
        Busca por nombre <strong>o</strong> número de cédula (ej: <code>CC|12345678</code> o solo el número).
        Haz clic en un resultado para seleccionarlo.
      </p>
      <div className="flex gap-2" style={{marginBottom:'1.25rem'}}>
        <input className="input" placeholder="Nombre o CC|12345678…" value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()} />
        <button className="btn btn-primary" onClick={search} disabled={loading || !query.trim()}>
          {loading ? <div className="spinner" /> : 'Buscar'}
        </button>
      </div>

      {result && (
        patients.length > 0 ? (
          <div>
            <div style={{fontSize:'0.75rem',color:'var(--text-3)',marginBottom:'0.75rem'}}>{result.total} resultado(s)</div>
            {patients.map((p, i) => p && (
              <div key={i}
                className={`su-patient-card su-patient-card--clickable ${selectedPat?.id === p.id ? 'su-patient-card--selected' : ''}`}
                onClick={() => onSelectPatient(p)}
              >
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div className="su-patient-name">{p.name?.[0]?.text || '—'}</div>
                  {selectedPat?.id === p.id && <span className="badge badge-purple" style={{fontSize:'0.6rem'}}>Seleccionado</span>}
                </div>
                <div className="su-patient-meta">
                  {p.identifier?.[0]?.value && (
                    <span>CC: <code style={{fontSize:'0.68rem',color:'var(--cyan)'}}>{p.identifier[0].value}</code></span>
                  )}
                  <span>Nac: {p.birthDate || '—'}</span>
                  <span>ID: <code style={{fontSize:'0.65rem',color:'var(--text-secondary)'}}>{p.id}</code></span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{color:'var(--text-3)',fontSize:'0.85rem'}}>No se encontraron pacientes.</div>
        )
      )}
    </div>
  )
}

/* ── Crear Paciente ──────────────────────────────────────────────────────── */
function CreatePatientTab({ api }) {
  const [form,    setForm]    = useState({ family: '', given: '', birthDate: '', gender: 'unknown', identifier: '', docType: 'CC' })
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)

  const create = async () => {
    setLoading(true)
    const fhirPatient = {
      resourceType: 'Patient',
      identifier: form.identifier ? [{
        use: 'official',
        type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: form.docType }] },
        system: `https://www.datos.gov.co/d/${form.docType.toLowerCase()}`,
        value: form.identifier,
      }] : [],
      name: [{ family: form.family, given: [form.given], text: `${form.given} ${form.family}`.trim() }],
      gender: form.gender,
      birthDate: form.birthDate,
      address: [{ country: 'CO' }],
    }
    try {
      const data = await api.createPatient(fhirPatient)
      setResult(data)
      toast.success('Paciente creado en FHIR R4')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear paciente')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <h3 style={{marginBottom:'0.5rem',color:'var(--text-1)'}}>Crear Paciente (FHIR R4)</h3>
      <p style={{fontSize:'0.8rem',color:'var(--text-3)',marginBottom:'1.5rem'}}>
        Registra un nuevo paciente en el sistema destino via estándar FHIR R4.
      </p>
      <div className="su-form-grid">
        <div className="form-group">
          <label className="label">Apellidos</label>
          <input className="input" placeholder="García Martínez"
            value={form.family} onChange={e => setForm(f => ({...f, family: e.target.value}))} />
        </div>
        <div className="form-group">
          <label className="label">Nombres</label>
          <input className="input" placeholder="Carlos Eduardo"
            value={form.given} onChange={e => setForm(f => ({...f, given: e.target.value}))} />
        </div>
        <div className="form-group">
          <label className="label">Tipo documento</label>
          <select className="input" value={form.docType} onChange={e => setForm(f => ({...f, docType: e.target.value}))}>
            <option value="CC">CC — Cédula de Ciudadanía</option>
            <option value="TI">TI — Tarjeta de Identidad</option>
            <option value="CE">CE — Cédula Extranjería</option>
            <option value="PA">PA — Pasaporte</option>
            <option value="RC">RC — Registro Civil</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label">Número de documento</label>
          <input className="input" placeholder="1234567890"
            value={form.identifier} onChange={e => setForm(f => ({...f, identifier: e.target.value}))} />
        </div>
        <div className="form-group">
          <label className="label">Fecha de nacimiento</label>
          <input className="input" type="date"
            value={form.birthDate} onChange={e => setForm(f => ({...f, birthDate: e.target.value}))} />
        </div>
        <div className="form-group">
          <label className="label">Sexo biológico</label>
          <select className="input" value={form.gender} onChange={e => setForm(f => ({...f, gender: e.target.value}))}>
            <option value="male">Masculino</option>
            <option value="female">Femenino</option>
            <option value="unknown">No especificado</option>
          </select>
        </div>
      </div>
      <button className="btn btn-primary" style={{marginTop:'1rem'}} onClick={create} disabled={loading}>
        {loading ? <><div className="spinner"/> Creando…</> : 'Crear paciente'}
      </button>
      {result && (
        <div className="su-result" style={{marginTop:'1rem'}}>
          <div className="result-label">
            Paciente creado · ID: <code>{result.id}</code>
            {result.identifier?.[0]?.value && <> · CC: <code>{result.identifier[0].value}</code></>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Observaciones ───────────────────────────────────────────────────────── */
function ObservationsTab({ api, selectedPat }) {
  const [loincCode,  setLoincCode]  = useState('')
  const [newObs,     setNewObs]     = useState({ loinc: '', value: '', unit: '' })
  const [result,     setResult]     = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const fetch_ = async () => {
    if (!selectedPat) return
    setLoading(true)
    try {
      const data = await api.getObservations(selectedPat.id, loincCode)
      setResult(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al obtener observaciones')
    } finally { setLoading(false) }
  }

  const createObs = async () => {
    if (!selectedPat || !newObs.loinc) return
    setSaving(true)
    const fhirObs = {
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: newObs.loinc }] },
      subject: { reference: `Patient/${selectedPat.id}` },
      valueQuantity: { value: parseFloat(newObs.value), unit: newObs.unit },
    }
    try {
      await api.createObservation(selectedPat.id, fhirObs)
      toast.success('Observación registrada')
      setShowCreate(false)
      setNewObs({ loinc: '', value: '', unit: '' })
      fetch_()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al registrar')
    } finally { setSaving(false) }
  }

  const obs = result?.entry?.map(e => e.resource) || result?.entry || []

  return (
    <div>
      <h3 style={{marginBottom:'0.5rem',color:'var(--text-1)'}}>Observaciones Clínicas</h3>
      {selectedPat ? (
        <div className="su-context-banner">
          Paciente: <strong>{selectedPat.name?.[0]?.text}</strong>
          {selectedPat.identifier?.[0]?.value && <> · CC: <code style={{fontSize:'0.68rem'}}>{selectedPat.identifier[0].value}</code></>}
        </div>
      ) : (
        <div className="alert alert-warning" style={{fontSize:'0.78rem',marginBottom:'1rem'}}>
          Selecciona un paciente en "Buscar Paciente" primero.
        </div>
      )}
      <div className="flex gap-2" style={{marginBottom:'1rem',flexWrap:'wrap'}}>
        <input className="input" placeholder="Código LOINC opcional (ej: 2339-0)" style={{flex:1}}
          value={loincCode} onChange={e => setLoincCode(e.target.value)} />
        <button className="btn btn-primary" onClick={fetch_} disabled={loading || !selectedPat}>
          {loading ? <div className="spinner"/> : 'Consultar'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(s => !s)} disabled={!selectedPat}>
          {showCreate ? 'Cancelar' : '+ Registrar'}
        </button>
      </div>

      {showCreate && (
        <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid var(--border)',borderRadius:8,padding:'1rem',marginBottom:'1rem'}}>
          <div style={{fontSize:'0.78rem',fontWeight:600,marginBottom:'0.75rem'}}>Nueva Observación FHIR R4</div>
          <div className="su-form-grid">
            <div className="form-group">
              <label className="label">Código LOINC</label>
              <input className="input" placeholder="2339-0 (Glucosa)" value={newObs.loinc}
                onChange={e => setNewObs(o => ({...o, loinc: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Valor</label>
              <input className="input" type="number" placeholder="126" value={newObs.value}
                onChange={e => setNewObs(o => ({...o, value: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Unidad</label>
              <input className="input" placeholder="mg/dL" value={newObs.unit}
                onChange={e => setNewObs(o => ({...o, unit: e.target.value}))} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={createObs} disabled={saving || !newObs.loinc}>
            {saving ? <><div className="spinner"/> Guardando…</> : 'Registrar observación'}
          </button>
        </div>
      )}

      {result && (
        obs.length > 0 ? (
          <div>
            <div style={{fontSize:'0.75rem',color:'var(--text-3)',marginBottom:'0.75rem'}}>{result.total ?? obs.length} observación(es)</div>
            <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
              {obs.map((o, i) => {
                const code = o?.code?.coding?.[0]
                const val  = o?.valueQuantity
                return (
                  <div key={i} className="su-obs-row">
                    <span className="su-obs-code">{code?.code || '—'}</span>
                    <span className="su-obs-name">{code?.display || o?.code?.text || '—'}</span>
                    <span className="su-obs-val">{val ? `${val.value} ${val.unit}` : '—'}</span>
                    <span className="su-obs-date">{o?.effectiveDateTime?.slice(0,10) || '—'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div style={{color:'var(--text-3)',fontSize:'0.85rem'}}>No hay observaciones registradas.</div>
        )
      )}
    </div>
  )
}

/* ── Inferencia ──────────────────────────────────────────────────────────── */
function InferenceTab({ api, selectedPat }) {
  const [modelType, setModelType] = useState('diabetes')
  const [features,  setFeatures]  = useState(`{
  "Pregnancies": 2,
  "Glucose": 148,
  "BloodPressure": 72,
  "SkinThickness": 35,
  "Insulin": 0,
  "BMI": 33.6,
  "DiabetesPedigreeFunction": 0.627,
  "Age": 50
}`)
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)

  const infer = async () => {
    if (!selectedPat) return
    setLoading(true)
    try {
      let featureObj
      try { featureObj = JSON.parse(features) } catch { toast.error('JSON inválido'); setLoading(false); return }
      const payload = { features: featureObj, patient_id: selectedPat.id }
      const data = await api.inference(modelType, payload)
      setResult(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error en inferencia')
    } finally { setLoading(false) }
  }

  const prob     = result?.probability ?? result?.risk_score ?? null
  const cat      = result?.risk_category || ''
  const catColor = cat === 'HIGH' || cat === 'CRITICAL' ? 'var(--danger)' :
                   cat === 'MEDIUM' ? 'var(--warning)' : 'var(--success)'

  return (
    <div>
      <h3 style={{marginBottom:'0.5rem',color:'var(--text-1)'}}>Inferencia ML / DL</h3>

      {selectedPat ? (
        <div className="su-context-banner" style={{marginBottom:'1rem'}}>
          Ejecutando sobre: <strong>{selectedPat.name?.[0]?.text}</strong>
          {selectedPat.identifier?.[0]?.value && <> · CC: <code style={{fontSize:'0.68rem'}}>{selectedPat.identifier[0].value}</code></>}
        </div>
      ) : (
        <div className="alert alert-warning" style={{fontSize:'0.78rem',marginBottom:'1rem'}}>
          Selecciona un paciente en "Buscar Paciente" antes de ejecutar inferencia.
        </div>
      )}

      <div className="flex gap-2" style={{marginBottom:'1rem',alignItems:'center'}}>
        <label className="label" style={{margin:0,whiteSpace:'nowrap'}}>Modelo:</label>
        {['diabetes', 'retinopathy', 'multimodal'].map(m => (
          <button key={m} className={`pill ${modelType === m ? 'pill--active' : ''}`} onClick={() => setModelType(m)}>
            {m}
          </button>
        ))}
      </div>

      <label className="label">Features (JSON)</label>
      <textarea className="input textarea" style={{fontFamily:'var(--font-mono)',fontSize:'0.78rem',minHeight:160}}
        value={features} onChange={e => setFeatures(e.target.value)} />

      <button className="btn btn-primary" style={{marginTop:'0.75rem'}} onClick={infer} disabled={loading || !selectedPat}>
        {loading ? <><div className="spinner"/> Procesando…</> : 'Ejecutar inferencia'}
      </button>

      {result && prob !== null && (
        <div className="su-infer-result">
          <div className="su-infer-prob" style={{color: catColor}}>
            {(prob * 100).toFixed(1)}%
          </div>
          <div style={{color:'var(--text-3)',fontSize:'0.8rem'}}>probabilidad</div>
          <span className="badge" style={{backgroundColor: catColor, color:'#fff', marginTop:'0.5rem'}}>
            {cat || 'Sin categoría'}
          </span>
          {result.fhir_risk_assessment && (
            <span className="badge badge-info" style={{marginTop:'0.25rem'}}>RiskAssessment FHIR generado</span>
          )}
          {result.shap_values && Object.keys(result.shap_values).length > 0 && (
            <div style={{marginTop:'0.75rem',width:'100%',textAlign:'left'}}>
              <div style={{fontSize:'0.72rem',color:'var(--text-secondary)',marginBottom:'0.4rem',fontWeight:600}}>SHAP values</div>
              {Object.entries(result.shap_values).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0,5).map(([k,v]) => (
                <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:'0.72rem',padding:'2px 0',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                  <span style={{color:'var(--text-secondary)'}}>{k}</span>
                  <span style={{color: v > 0 ? '#f87171' : '#34d399',fontWeight:600}}>{v > 0 ? '+' : ''}{v.toFixed(3)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
