import { useState } from 'react'
import { superuserAPI } from '../services/api'
import toast from 'react-hot-toast'
import './SuperUserView.css'

const TABS = ['Login SuperUser', 'Buscar Paciente', 'Crear Paciente', 'Observaciones', 'Inferencia']

export default function SuperUserView() {
  const [tab, setTab] = useState(0)
  const [suToken, setSuToken] = useState(null)

  return (
    <div className="su-layout fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Portal SuperUser — Médico</h1>
          <p className="page-sub">Interoperabilidad entre sistemas del curso · API FHIR R4 · JWT</p>
        </div>
        <div className="flex gap-2 items-center">
          {suToken ? (
            <span className="badge badge-low">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Autenticado
            </span>
          ) : (
            <span className="badge badge-neutral">Sin autenticar</span>
          )}
          <span className="badge badge-info">FHIR R4</span>
        </div>
      </div>

      {/* Alert */}
      <div className="alert alert-info" style={{marginBottom:'1rem',fontSize:'0.8rem'}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        El médico SuperUser puede interoperar con los sistemas de otros equipos del curso usando JWT + endpoints FHIR estandarizados.
        Rate limit: 60 req/min · WAF Cloudflare activo · AuditEvent registrado
      </div>

      {/* Tabs */}
      <div className="su-tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={`su-tab ${tab === i ? 'active' : ''}`}
            onClick={() => setTab(i)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="su-content card">
        {tab === 0 && <LoginTab onToken={setSuToken} />}
        {tab === 1 && <SearchPatientTab token={suToken} />}
        {tab === 2 && <CreatePatientTab token={suToken} />}
        {tab === 3 && <ObservationsTab token={suToken} />}
        {tab === 4 && <InferenceTab token={suToken} />}
      </div>
    </div>
  )
}

/* ── Tab: Login ─────────────────────────────────────────────────────────── */
function LoginTab({ onToken }) {
  const [form, setForm] = useState({ email: '', password: '', license_number: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handle = async e => {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await superuserAPI.login(form)
      onToken(data.access_token)
      setResult(data)
      toast.success('SuperUser autenticado')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error de autenticación')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <h3 style={{marginBottom:'1.25rem',color:'var(--text-1)'}}>Autenticación SuperUser</h3>
      <form onSubmit={handle} className="su-form">
        <div className="form-group">
          <label className="label">Email médico</label>
          <input className="input" type="email" placeholder="medico@hospital.com"
            value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required />
        </div>
        <div className="form-group">
          <label className="label">Contraseña</label>
          <input className="input" type="password" placeholder="••••••••"
            value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} required />
        </div>
        <div className="form-group">
          <label className="label">Número de licencia médica</label>
          <input className="input" placeholder="REG-12345"
            value={form.license_number} onChange={e => setForm(f => ({...f, license_number: e.target.value}))} required />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? <><div className="spinner" /> Autenticando…</> : 'Obtener token SuperUser'}
        </button>
      </form>
      {result && (
        <div className="su-result">
          <div className="result-label">access_token (Bearer JWT)</div>
          <code className="result-code">{result.access_token.slice(0, 60)}…</code>
          <div style={{fontSize:'0.72rem',color:'var(--text-3)',marginTop:'0.375rem'}}>
            Expira en: {result.expires_in / 3600}h · Tipo: {result.token_type}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Tab: Search Patient ────────────────────────────────────────────────── */
function SearchPatientTab({ token }) {
  const [identifier, setIdentifier] = useState('CC|')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const search = async () => {
    if (!token) { toast.error('Primero autentíquese como SuperUser'); return }
    setLoading(true)
    try {
      const data = await superuserAPI.searchPatient(token, identifier)
      setResult(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error en búsqueda')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <h3 style={{marginBottom:'1.25rem',color:'var(--text-1)'}}>Buscar Paciente</h3>
      <p style={{fontSize:'0.8rem',marginBottom:'1rem'}}>
        Formato identifier: <code style={{color:'var(--cyan)'}}>{'CC|1234567890'}</code> o <code style={{color:'var(--cyan)'}}>{'TI|12345678'}</code>
      </p>
      <div className="flex gap-2" style={{marginBottom:'1rem'}}>
        <input className="input" placeholder="CC|1234567890"
          value={identifier} onChange={e => setIdentifier(e.target.value)} />
        <button className="btn btn-primary" onClick={search} disabled={loading}>
          {loading ? <div className="spinner" /> : 'Buscar'}
        </button>
      </div>
      {result && (
        <div className="su-result">
          <div className="result-label">Bundle FHIR Response · {result.total} resultado(s)</div>
          <pre className="result-json">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

/* ── Tab: Create Patient ────────────────────────────────────────────────── */
function CreatePatientTab({ token }) {
  const [form, setForm] = useState({ family: '', given: '', birthDate: '', gender: 'unknown', identifier: '' })
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const create = async () => {
    if (!token) { toast.error('Primero autentíquese como SuperUser'); return }
    setLoading(true)
    const fhirPatient = {
      resourceType: 'Patient',
      identifier: [{ use: 'official', system: 'https://www.registraduria.gov.co/cedula', value: form.identifier }],
      name: [{ family: form.family, given: [form.given] }],
      gender: form.gender,
      birthDate: form.birthDate,
      address: [{ country: 'CO' }],
    }
    try {
      const data = await superuserAPI.createPatient(token, fhirPatient)
      setResult(data)
      toast.success('Paciente creado (FHIR R4)')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear paciente')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <h3 style={{marginBottom:'1.25rem',color:'var(--text-1)'}}>Crear Paciente (FHIR R4)</h3>
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
          <label className="label">Número cédula (CC)</label>
          <input className="input" placeholder="1234567890"
            value={form.identifier} onChange={e => setForm(f => ({...f, identifier: e.target.value}))} />
        </div>
        <div className="form-group">
          <label className="label">Fecha nacimiento</label>
          <input className="input" type="date"
            value={form.birthDate} onChange={e => setForm(f => ({...f, birthDate: e.target.value}))} />
        </div>
        <div className="form-group">
          <label className="label">Sexo</label>
          <select className="input select" value={form.gender} onChange={e => setForm(f => ({...f, gender: e.target.value}))}>
            <option value="male">Masculino</option>
            <option value="female">Femenino</option>
            <option value="unknown">No especificado</option>
          </select>
        </div>
      </div>
      <button className="btn btn-primary" style={{marginTop:'1rem'}} onClick={create} disabled={loading}>
        {loading ? <><div className="spinner"/> Creando…</> : 'POST /superuser/patients'}
      </button>
      {result && (
        <div className="su-result">
          <div className="result-label">Patient FHIR creado · ID: {result.id}</div>
          <pre className="result-json">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

/* ── Tab: Observations ──────────────────────────────────────────────────── */
function ObservationsTab({ token }) {
  const [patientId, setPatientId] = useState('')
  const [loincCode, setLoincCode] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetch = async () => {
    if (!token) { toast.error('Primero autentíquese como SuperUser'); return }
    setLoading(true)
    try {
      const data = await superuserAPI.getObservations(token, patientId, loincCode)
      setResult(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al obtener observaciones')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <h3 style={{marginBottom:'1.25rem',color:'var(--text-1)'}}>Observaciones Clínicas (LOINC)</h3>
      <div className="flex gap-2" style={{marginBottom:'1rem',flexWrap:'wrap'}}>
        <input className="input" placeholder="Patient UUID" style={{flex:2}}
          value={patientId} onChange={e => setPatientId(e.target.value)} />
        <input className="input" placeholder="LOINC code (ej: 2339-0)" style={{flex:1}}
          value={loincCode} onChange={e => setLoincCode(e.target.value)} />
        <button className="btn btn-primary" onClick={fetch} disabled={loading}>
          {loading ? <div className="spinner"/> : 'GET Obs.'}
        </button>
      </div>
      {result && (
        <div className="su-result">
          <div className="result-label">Bundle FHIR · {result.total} observaciones</div>
          <pre className="result-json">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

/* ── Tab: Inference ─────────────────────────────────────────────────────── */
function InferenceTab({ token }) {
  const [modelType, setModelType] = useState('diabetes')
  const [features, setFeatures] = useState(`{
  "Pregnancies": 2,
  "Glucose": 148,
  "BloodPressure": 72,
  "SkinThickness": 35,
  "Insulin": 0,
  "BMI": 33.6,
  "DiabetesPedigreeFunction": 0.627,
  "Age": 50
}`)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const infer = async () => {
    if (!token) { toast.error('Primero autentíquese como SuperUser'); return }
    setLoading(true)
    try {
      let featureObj
      try { featureObj = JSON.parse(features) } catch { toast.error('JSON inválido'); setLoading(false); return }
      const data = await superuserAPI.inference(token, modelType, { features: featureObj, model: modelType })
      setResult(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error en inferencia')
    } finally { setLoading(false) }
  }

  const probColor = result ? (
    result.probability >= 0.8 ? 'var(--critical)' :
    result.probability >= 0.6 ? 'var(--danger)' :
    result.probability >= 0.3 ? 'var(--warning)' : 'var(--success)'
  ) : 'var(--text-2)'

  return (
    <div>
      <h3 style={{marginBottom:'1.25rem',color:'var(--text-1)'}}>Inferencia ML/DL SuperUser</h3>
      <div className="flex gap-2" style={{marginBottom:'1rem',alignItems:'center'}}>
        <label className="label" style={{margin:0}}>Modelo:</label>
        {['diabetes', 'retinopathy', 'multimodal'].map(m => (
          <button key={m} className={`pill ${modelType === m ? 'pill--active' : ''}`} onClick={() => setModelType(m)}>
            {m}
          </button>
        ))}
      </div>
      <label className="label">Features JSON (LOINC-coded)</label>
      <textarea className="input textarea" style={{fontFamily:'var(--font-mono)',fontSize:'0.78rem',minHeight:160}}
        value={features} onChange={e => setFeatures(e.target.value)} />
      <button className="btn btn-primary" style={{marginTop:'0.75rem'}} onClick={infer} disabled={loading}>
        {loading ? <><div className="spinner"/> Procesando…</> : `POST /superuser/inference/${modelType}`}
      </button>

      {result && (
        <div className="su-result">
          <div className="result-label">Resultado (calibrado ONNX INT8)</div>
          <div className="inference-result">
            <div className="infer-prob" style={{color: probColor}}>
              {(result.probability * 100).toFixed(1)}%
            </div>
            <div className="infer-label">probabilidad</div>
            {result.fhir_risk_assessment && (
              <span className="badge badge-info" style={{marginTop:'0.25rem'}}>RiskAssessment FHIR generado</span>
            )}
          </div>
          <pre className="result-json">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
