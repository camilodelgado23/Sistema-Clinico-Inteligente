import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import './SuperUserView.css'

const OWN_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Cliente axios para el sistema destino — todos los endpoints van por el backend propio
function makeSuAPI(baseUrl, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const base = baseUrl.replace(/\/$/, '')
  return {
    login: (body) =>
      axios.post(`${base}/api/v1/auth/superuser/login`, body).then(r => r.data),
    myPatients: () =>
      axios.get(`${base}/api/v1/superuser/my-patients`, { headers }).then(r => r.data),
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
    getRiskReports: (patientId) =>
      axios.get(`${base}/api/v1/superuser/patients/${patientId}/risk-reports`, { headers }).then(r => r.data),
    signReport: (rid, body) =>
      axios.patch(`${base}/api/v1/superuser/risk-reports/${rid}/sign`, body, { headers }).then(r => r.data),
    agentChat: (body) =>
      axios.post(`${base}/api/v1/superuser/agent/chat`, body, { headers }).then(r => r.data),
    uploadImage: (patientId, file, modality) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('modality', modality)
      return axios.post(`${base}/api/v1/superuser/patients/${patientId}/images`, fd,
        { headers: { ...headers, 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
    },
    listImages: (patientId) =>
      axios.get(`${base}/api/v1/superuser/patients/${patientId}/images`, { headers }).then(r => r.data),
    updateObservation: (patientId, obsId, body) =>
      axios.patch(`${base}/api/v1/superuser/patients/${patientId}/observations/${obsId}`, body, { headers }).then(r => r.data),
  }
}

const MAIN_TABS = [
  { id: 'patients', label: 'Mis Pacientes', icon: '👥' },
  { id: 'create',   label: 'Crear Paciente', icon: '➕' },
]

export default function SuperUserView() {
  const location = useLocation()
  const navigate = useNavigate()

  const [targetUrl,    setTargetUrl]    = useState(OWN_URL)
  const [editingUrl,   setEditingUrl]   = useState(false)
  const [draftUrl,     setDraftUrl]     = useState(OWN_URL)

  const [suToken,      setSuToken]      = useState(location.state?.suToken || null)
  const [practitioner, setPractitioner] = useState(location.state?.practitioner || null)
  const [tab,          setTab]          = useState('patients')
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
    setTab('patients')
  }

  const applyUrl = () => {
    const u = draftUrl.trim()
    if (!u) return
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
                  <button className="btn btn-ghost btn-sm" onClick={() => setTab('reports')}>Reportes</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setTab('images')}>Imágenes</button>
                  <button className="btn btn-ghost btn-sm" style={{color:'var(--text-4)'}} onClick={() => setSelectedPat(null)}>✕</button>
                </div>
              </div>
            )}

            <div className="su-tabs">
              {MAIN_TABS.map(t => (
                <button key={t.id} className={`su-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
              <button className={`su-tab su-tab--highlight ${tab === 'agent' ? 'active' : ''}`} onClick={() => setTab('agent')}>
                <span>🤖</span><span>Agente</span>
              </button>
              {selectedPat && (
                <>
                  <button className={`su-tab ${tab === 'obs' ? 'active' : ''}`} onClick={() => setTab('obs')}>
                    <span>📊</span><span>Observaciones</span>
                  </button>
                  <button className={`su-tab ${tab === 'infer' ? 'active' : ''}`} onClick={() => setTab('infer')}>
                    <span>🧠</span><span>Inferencia</span>
                  </button>
                  <button className={`su-tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
                    <span>📋</span><span>Reportes</span>
                  </button>
                  <button className={`su-tab ${tab === 'images' ? 'active' : ''}`} onClick={() => setTab('images')}>
                    <span>🖼️</span><span>Imágenes</span>
                  </button>
                </>
              )}
            </div>

            <div className="su-content card">
              {tab === 'patients' && <MyPatientsTab  api={api} onSelectPatient={p => { setSelectedPat(p); setTab('obs') }} selectedPat={selectedPat} />}
              {tab === 'create'   && <CreatePatientTab api={api} />}
              {tab === 'agent'    && <AgentTab        api={api} selectedPat={selectedPat} />}
              {tab === 'obs'      && <ObservationsTab  api={api} selectedPat={selectedPat} />}
              {tab === 'infer'    && <InferenceTab     api={api} selectedPat={selectedPat} onGoReports={() => setTab('reports')} />}
              {tab === 'reports'  && <ReportsTab       api={api} selectedPat={selectedPat} />}
              {tab === 'images'   && <ImagesTab        api={api} selectedPat={selectedPat} />}
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

/* ── Mis Pacientes ───────────────────────────────────────────────────────── */
function MyPatientsTab({ api, onSelectPatient, selectedPat }) {
  const [patients,    setPatients]    = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [query,       setQuery]       = useState('')
  const [searching,   setSearching]   = useState(false)
  const [searchRes,   setSearchRes]   = useState(null)

  useEffect(() => {
    setLoading(true)
    api.myPatients()
      .then(d => setPatients(d.entry || []))
      .catch(err => toast.error(err.response?.data?.detail || 'Error al cargar pacientes'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const search = async () => {
    if (!query.trim()) { setSearchRes(null); return }
    setSearching(true)
    try {
      const d = await api.searchPatient(query.trim())
      setSearchRes(d.entry || [])
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error en búsqueda')
    } finally { setSearching(false) }
  }

  const displayList = searchRes !== null ? searchRes : (patients || [])

  const PatientCard = ({ p }) => (
    <div
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
      </div>
    </div>
  )

  return (
    <div>
      <h3 style={{marginBottom:'0.25rem',color:'var(--text-1)'}}>Mis Pacientes Asignados</h3>
      <p style={{fontSize:'0.8rem',color:'var(--text-3)',marginBottom:'1rem'}}>
        Solo puedes acceder a los pacientes asignados por el administrador.
        Haz clic en un paciente para seleccionarlo y consultar sus datos.
      </p>

      <div className="flex gap-2" style={{marginBottom:'1.25rem'}}>
        <input className="input" placeholder="Buscar por nombre o CC|12345678…" value={query}
          onChange={e => { setQuery(e.target.value); if (!e.target.value.trim()) setSearchRes(null) }}
          onKeyDown={e => e.key === 'Enter' && search()} />
        <button className="btn btn-primary" onClick={search} disabled={searching || !query.trim()}>
          {searching ? <div className="spinner" /> : 'Buscar'}
        </button>
        {searchRes !== null && (
          <button className="btn btn-ghost" onClick={() => { setQuery(''); setSearchRes(null) }}>
            Limpiar
          </button>
        )}
      </div>

      {loading ? (
        <div style={{color:'var(--text-3)',fontSize:'0.85rem'}}>Cargando…</div>
      ) : displayList.length > 0 ? (
        <div>
          {searchRes !== null && (
            <div style={{fontSize:'0.75rem',color:'var(--text-3)',marginBottom:'0.75rem'}}>
              {searchRes.length} resultado(s) en tus pacientes asignados
            </div>
          )}
          {displayList.map((p, i) => p && <PatientCard key={i} p={p} />)}
        </div>
      ) : (
        <div style={{
          padding:'2.5rem',textAlign:'center',color:'var(--text-3)',
          background:'rgba(255,255,255,0.02)',borderRadius:10,border:'1px dashed var(--border)'
        }}>
          {searchRes !== null
            ? 'No se encontraron pacientes con ese criterio en tu lista.'
            : 'No tienes pacientes asignados. Contacta al administrador.'}
        </div>
      )}
    </div>
  )
}

/* ── Agente ──────────────────────────────────────────────────────────────── */
const RAG_MODES = [
  { value: 'hybrid',  label: 'Hybrid RAG' },
  { value: 'naive',   label: 'Naive RAG' },
  { value: 'rerank',  label: 'Advanced RAG' },
  { value: 'agentic', label: 'Agentic RAG' },
]

function AgentTab({ api, selectedPat }) {
  const [messages,  setMessages]  = useState([])
  const [input,     setInput]     = useState('')
  const [mode,      setMode]      = useState('hybrid')
  const [loading,   setLoading]   = useState(false)
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    const userMsg = { role: 'user', content: text }
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)
    try {
      const body = { message: text, session_id: sessionId, mode }
      if (selectedPat) body.patient_id = selectedPat.id
      const data = await api.agentChat(body)
      setMessages(m => [...m, {
        role: 'assistant',
        content: data.response || data.answer || data.message || JSON.stringify(data),
        sources: data.sources || [],
        rag_mode: data.rag_mode || mode,
        elapsed: data.elapsed_ms,
      }])
    } catch (err) {
      const detail = err.response?.data?.detail || 'Error al consultar el agente'
      setMessages(m => [...m, { role: 'assistant', content: `Error: ${detail}`, error: true }])
    } finally { setLoading(false) }
  }

  const clearSession = () => {
    setMessages([])
    setSessionId(crypto.randomUUID())
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:480}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.75rem',flexWrap:'wrap',gap:'0.5rem'}}>
        <div>
          <h3 style={{margin:0,color:'var(--text-1)'}}>Agente Clínico</h3>
          {selectedPat && (
            <div style={{fontSize:'0.75rem',color:'var(--text-3)',marginTop:'2px'}}>
              Contexto: <strong style={{color:'var(--cyan)'}}>{selectedPat.name?.[0]?.text}</strong>
            </div>
          )}
        </div>
        <div className="flex gap-2" style={{alignItems:'center'}}>
          {RAG_MODES.map(m => (
            <button key={m.value}
              className={`pill ${mode === m.value ? 'pill--active' : ''}`}
              style={{fontSize:'0.7rem'}}
              onClick={() => setMode(m.value)}>
              {m.label}
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={clearSession} style={{fontSize:'0.72rem'}}>
            Nueva sesión
          </button>
        </div>
      </div>

      <div style={{
        flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:'0.75rem',
        padding:'0.75rem', background:'rgba(0,0,0,0.15)', borderRadius:10,
        border:'1px solid var(--border)', minHeight:320, marginBottom:'0.75rem',
      }}>
        {messages.length === 0 && (
          <div style={{margin:'auto',textAlign:'center',color:'var(--text-3)',fontSize:'0.82rem'}}>
            <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>🤖</div>
            <div>Haz una pregunta sobre los pacientes asignados.</div>
            {!selectedPat && <div style={{marginTop:'0.25rem',fontSize:'0.75rem'}}>Selecciona un paciente para dar contexto específico.</div>}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            display:'flex', flexDirection:'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth:'85%', padding:'0.6rem 0.9rem', borderRadius:10,
              background: msg.role === 'user'
                ? 'rgba(56,189,248,0.15)'
                : msg.error ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${msg.role === 'user' ? 'rgba(56,189,248,0.3)' : msg.error ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
              fontSize:'0.82rem', color:'var(--text-1)', whiteSpace:'pre-wrap', lineHeight:1.6,
            }}>
              {msg.content}
            </div>
            {msg.sources?.length > 0 && (
              <div style={{display:'flex',gap:'0.3rem',flexWrap:'wrap',marginTop:'0.3rem'}}>
                {msg.sources.map(s => (
                  <span key={s} style={{fontSize:'0.65rem',padding:'1px 6px',borderRadius:99,
                    background:'rgba(168,85,247,0.1)',color:'#c084fc',border:'1px solid rgba(168,85,247,0.2)'}}>
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{display:'flex',alignItems:'center',gap:'0.4rem',color:'var(--text-3)',fontSize:'0.78rem'}}>
            <div className="spinner" /> Consultando agente…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input className="input" style={{flex:1}}
          placeholder="Escribe tu consulta clínica…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          disabled={loading}
        />
        <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()}>
          {loading ? <div className="spinner" /> : 'Enviar'}
        </button>
      </div>
    </div>
  )
}

const LOINC_MAP = [
  { code: '2339-0',  label: 'Glucosa',           unit: 'mg/dL',  placeholder: '126' },
  { code: '55284-4', label: 'Presión arterial',   unit: 'mmHg',   placeholder: '120' },
  { code: '39156-5', label: 'BMI',                unit: 'kg/m²',  placeholder: '28.5' },
  { code: '14749-6', label: 'Insulina',           unit: 'µU/mL',  placeholder: '80' },
  { code: '21612-7', label: 'Edad',               unit: 'años',   placeholder: '45' },
  { code: '11996-6', label: 'Embarazos',          unit: '#',      placeholder: '2' },
  { code: '39106-0', label: 'Grosor de piel',     unit: 'mm',     placeholder: '20' },
  { code: '33914-3', label: 'Pedigree diabetes',  unit: 'score',  placeholder: '0.5' },
]

/* ── Crear Paciente ──────────────────────────────────────────────────────── */
function CreatePatientTab({ api }) {
  const [step,       setStep]       = useState(1)   // 1=demografía, 2=observaciones
  const [form,       setForm]       = useState({ family: '', given: '', birthDate: '', gender: 'unknown', identifier: '', docType: 'CC' })
  const [createdPat, setCreatedPat] = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [obsValues,  setObsValues]  = useState({})  // code → value string
  const [savingObs,  setSavingObs]  = useState(false)

  const create = async () => {
    if (!form.family.trim() || !form.given.trim() || !form.birthDate) {
      toast.error('Apellidos, nombres y fecha de nacimiento son obligatorios')
      return
    }
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
      setCreatedPat(data)
      toast.success('Paciente creado en FHIR R4')
      setStep(2)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear paciente')
    } finally { setLoading(false) }
  }

  const saveObs = async () => {
    const entries = LOINC_MAP.filter(l => obsValues[l.code]?.trim())
    if (entries.length === 0) { setStep(1); setCreatedPat(null); setForm({ family:'', given:'', birthDate:'', gender:'unknown', identifier:'', docType:'CC' }); return }
    setSavingObs(true)
    let saved = 0
    for (const l of entries) {
      const val = parseFloat(obsValues[l.code])
      if (isNaN(val)) continue
      const fhirObs = {
        resourceType: 'Observation',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: l.code }] },
        subject: { reference: `Patient/${createdPat.id}` },
        valueQuantity: { value: val, unit: l.unit },
      }
      try {
        await api.createObservation(createdPat.id, fhirObs)
        saved++
      } catch { /* continúa con las demás */ }
    }
    setSavingObs(false)
    toast.success(`${saved} observación(es) registrada(s)`)
    setStep(1)
    setCreatedPat(null)
    setObsValues({})
    setForm({ family:'', given:'', birthDate:'', gender:'unknown', identifier:'', docType:'CC' })
  }

  if (step === 2 && createdPat) {
    return (
      <div>
        <h3 style={{marginBottom:'0.25rem',color:'var(--text-1)'}}>Crear Paciente · Paso 2 de 2</h3>
        <p style={{fontSize:'0.8rem',color:'var(--text-3)',marginBottom:'1rem'}}>
          Paciente creado: <strong style={{color:'var(--cyan)'}}>{createdPat.name?.[0]?.text || createdPat.id}</strong>
          {' '}— Agrega observaciones clínicas iniciales (opcional).
        </p>
        <div className="su-form-grid">
          {LOINC_MAP.map(l => (
            <div className="form-group" key={l.code}>
              <label className="label">{l.label} <span style={{color:'var(--text-4)',fontWeight:400}}>({l.unit})</span></label>
              <input className="input" type="number" placeholder={l.placeholder}
                value={obsValues[l.code] || ''}
                onChange={e => setObsValues(v => ({...v, [l.code]: e.target.value}))} />
            </div>
          ))}
        </div>
        <div className="flex gap-2" style={{marginTop:'1rem'}}>
          <button className="btn btn-primary" onClick={saveObs} disabled={savingObs}>
            {savingObs ? <><div className="spinner"/> Guardando…</> : 'Guardar observaciones'}
          </button>
          <button className="btn btn-ghost" onClick={() => { setStep(1); setCreatedPat(null); setObsValues({}); setForm({ family:'', given:'', birthDate:'', gender:'unknown', identifier:'', docType:'CC' }) }}>
            Omitir y terminar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h3 style={{marginBottom:'0.25rem',color:'var(--text-1)'}}>Crear Paciente · Paso 1 de 2</h3>
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
      <button className="btn btn-primary" style={{marginTop:'1rem'}} onClick={create}
        disabled={loading || !form.family.trim() || !form.given.trim() || !form.birthDate}>
        {loading ? <><div className="spinner"/> Creando…</> : 'Siguiente →'}
      </button>
    </div>
  )
}

/* ── Observaciones ───────────────────────────────────────────────────────── */
function ObservationsTab({ api, selectedPat }) {
  const [result,     setResult]     = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [editMode,   setEditMode]   = useState(false)  // editar existentes
  const [editValues, setEditValues] = useState({})     // loinc → { id, value, unit }
  const [saving,     setSaving]     = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPat) fetch_() }, [selectedPat?.id])

  const fetch_ = async () => {
    if (!selectedPat) return
    setLoading(true)
    setEditMode(false)
    try {
      const data = await api.getObservations(selectedPat.id)
      setResult(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al obtener observaciones')
    } finally { setLoading(false) }
  }

  // Abre el formulario de edición/registro precargando valores existentes
  const openEditForm = () => {
    const obs = result?.entry?.map(e => e.resource ?? e) || []
    const vals = {}
    LOINC_MAP.forEach(l => { vals[l.code] = { id: null, value: '', unit: l.unit } })
    obs.forEach(o => {
      const code = o?.code?.coding?.[0]?.code
      // Solo tomar la primera aparición (obs viene DESC → la más reciente)
      if (code && vals[code] !== undefined && !vals[code].id) {
        vals[code] = {
          id: o.id || null,
          value: String(o.valueQuantity?.value ?? ''),
          unit: o.valueQuantity?.unit ?? (LOINC_MAP.find(l => l.code === code)?.unit || ''),
        }
      }
    })
    setEditValues(vals)
    setEditMode(true)
  }

  const saveEdit = async () => {
    setSaving(true)
    let ok = 0, fail = 0
    for (const [code, entry] of Object.entries(editValues)) {
      const valStr = String(entry.value ?? '').trim()
      if (!valStr) continue
      const val = parseFloat(valStr)
      if (isNaN(val)) continue
      const unit = entry.unit || (LOINC_MAP.find(l => l.code === code)?.unit || '')
      try {
        if (entry.id) {
          await api.updateObservation(selectedPat.id, entry.id, { valueQuantity: { value: val, unit } })
        } else {
          await api.createObservation(selectedPat.id, {
            resourceType: 'Observation', status: 'final',
            code: { coding: [{ system: 'http://loinc.org', code }] },
            subject: { reference: `Patient/${selectedPat.id}` },
            valueQuantity: { value: val, unit },
          })
        }
        ok++
      } catch { fail++ }
    }
    setSaving(false)
    if (ok > 0) toast.success(`${ok} observación(es) guardada(s)`)
    if (fail > 0) toast.error(`${fail} observación(es) no se pudieron guardar`)
    setEditMode(false)
    fetch_()
  }

  const obs = result?.entry?.map(e => e.resource ?? e) || []
  const hasObs = obs.length > 0

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
          Selecciona un paciente primero.
        </div>
      )}

      {/* Barra de acciones */}
      <div className="flex gap-2" style={{marginBottom:'1rem',flexWrap:'wrap',alignItems:'center'}}>
        <button className="btn btn-primary" onClick={fetch_} disabled={loading || !selectedPat}>
          {loading ? <div className="spinner"/> : '↻ Actualizar'}
        </button>
        {selectedPat && result && !editMode && (
          <button className="btn btn-ghost btn-sm" onClick={openEditForm}>
            {hasObs ? '✏️ Editar observaciones' : '+ Registrar observaciones'}
          </button>
        )}
        {editMode && (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(false)}>
            Cancelar
          </button>
        )}
      </div>

      {/* Formulario unificado editar / registrar */}
      {editMode && (
        <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid var(--border)',borderRadius:8,padding:'1rem',marginBottom:'1rem'}}>
          <div style={{fontSize:'0.78rem',fontWeight:600,marginBottom:'0.25rem',color:'var(--text-1)'}}>
            {hasObs ? 'Editar observaciones clínicas' : 'Registrar observaciones clínicas'}
          </div>
          <div style={{fontSize:'0.73rem',color:'var(--text-3)',marginBottom:'0.85rem'}}>
            {hasObs
              ? 'Modifica los valores y guarda. Los campos vacíos no se actualizan.'
              : 'Completa los valores y guarda. Los campos vacíos se omiten.'}
          </div>
          <div className="su-form-grid">
            {LOINC_MAP.map(l => {
              const entry = editValues[l.code] || { id: null, value: '', unit: l.unit }
              const isExisting = !!entry.id
              return (
                <div className="form-group" key={l.code}>
                  <label className="label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span>{l.label} <span style={{color:'var(--text-4)',fontWeight:400}}>({l.unit})</span></span>
                    {isExisting && <span style={{fontSize:'0.62rem',color:'var(--cyan)',background:'rgba(6,182,212,0.1)',padding:'1px 6px',borderRadius:99}}>existente</span>}
                  </label>
                  <input
                    className="input"
                    type="number"
                    placeholder={isExisting ? String(entry.value) : l.placeholder}
                    value={entry.value}
                    onChange={e => setEditValues(v => ({...v, [l.code]: {...(v[l.code]||{}), value: e.target.value}}))}
                  />
                </div>
              )
            })}
          </div>
          <button className="btn btn-primary btn-sm" style={{marginTop:'0.75rem'}} onClick={saveEdit} disabled={saving}>
            {saving ? <><div className="spinner"/> Guardando…</> : (hasObs ? '💾 Guardar cambios' : '✅ Registrar')}
          </button>
        </div>
      )}

      {/* Lista de observaciones */}
      {result && !editMode && (
        hasObs ? (
          <div>
            <div style={{fontSize:'0.75rem',color:'var(--text-3)',marginBottom:'0.75rem'}}>
              {result.total ?? obs.length} observación(es)
            </div>
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
          <div style={{color:'var(--text-3)',fontSize:'0.85rem',padding:'1.5rem',textAlign:'center',
            background:'rgba(255,255,255,0.02)',borderRadius:8,border:'1px dashed var(--border)'}}>
            No hay observaciones registradas para este paciente.
          </div>
        )
      )}
    </div>
  )
}

/* ── Inferencia ──────────────────────────────────────────────────────────── */
function InferenceTab({ api, selectedPat, onGoReports }) {
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
          {result.report_id && (
            <div style={{marginTop:'0.75rem',width:'100%',textAlign:'left',background:'rgba(6,182,212,0.08)',borderRadius:8,padding:'8px 12px'}}>
              <div style={{fontSize:'0.7rem',color:'var(--text-3)',marginBottom:2}}>Reporte guardado</div>
              <code style={{fontSize:'0.7rem',color:'#06b6d4',wordBreak:'break-all'}}>{result.report_id}</code>
              <div style={{marginTop:6}}>
                <button className="btn btn-ghost btn-sm" style={{fontSize:'0.72rem'}} onClick={onGoReports}>
                  Ver y firmar en Reportes →
                </button>
              </div>
            </div>
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

/* ── Imágenes ────────────────────────────────────────────────────────────── */
const MODALITIES = ['FUNDUS', 'XRAY', 'OCT', 'DERMOSCOPY', 'ULTRASOUND', 'OTHER']

function ImagesTab({ api, selectedPat }) {
  const [images,    setImages]    = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [modality,  setModality]  = useState('FUNDUS')
  const [preview,   setPreview]   = useState(null)
  const [failedIds, setFailedIds] = useState(new Set())
  const fileRef = useRef(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPat) load() }, [selectedPat?.id])

  const load = async () => {
    if (!selectedPat) return
    setLoading(true)
    try {
      const data = await api.listImages(selectedPat.id)
      setImages(data.entry || [])
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al cargar imágenes')
    } finally { setLoading(false) }
  }

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !selectedPat) return
    setUploading(true)
    try {
      await api.uploadImage(selectedPat.id, file, modality)
      toast.success('Imagen subida correctamente')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al subir imagen')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <h3 style={{marginBottom:'0.5rem',color:'var(--text-1)'}}>Imágenes Diagnósticas</h3>

      {!selectedPat ? (
        <div className="alert alert-warning" style={{fontSize:'0.78rem'}}>
          Selecciona un paciente para ver o subir imágenes.
        </div>
      ) : (
        <>
          <div className="su-context-banner" style={{marginBottom:'1rem'}}>
            Paciente: <strong>{selectedPat.name?.[0]?.text}</strong>
          </div>

          {/* Upload area */}
          <div style={{
            background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)',
            borderRadius:8, padding:'1rem', marginBottom:'1.25rem',
          }}>
            <div style={{fontSize:'0.78rem',fontWeight:600,marginBottom:'0.75rem',color:'var(--text-2)'}}>
              Subir nueva imagen
            </div>
            <div className="flex gap-2" style={{alignItems:'center',flexWrap:'wrap'}}>
              <select className="input" style={{width:'auto',fontSize:'0.8rem'}}
                value={modality} onChange={e => setModality(e.target.value)}>
                {MODALITIES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input ref={fileRef} type="file" accept="image/*,.dcm"
                style={{display:'none'}} onChange={upload} />
              <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}
                disabled={uploading || !selectedPat}>
                {uploading ? <><div className="spinner"/> Subiendo…</> : '+ Seleccionar archivo'}
              </button>
            </div>
          </div>

          {/* Image gallery */}
          <button className="btn btn-ghost btn-sm" style={{marginBottom:'1rem'}} onClick={load} disabled={loading}>
            {loading ? <><div className="spinner"/>Cargando…</> : '↻ Actualizar'}
          </button>

          {images && (
            images.length === 0 ? (
              <div style={{color:'var(--text-3)',fontSize:'0.85rem'}}>No hay imágenes registradas.</div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'0.75rem'}}>
                {images.map(img => (
                  <div key={img.id} style={{
                    borderRadius:8, overflow:'hidden',
                    border:'1px solid var(--border)',
                    background:'rgba(0,0,0,0.2)', cursor:'pointer',
                  }} onClick={() => setPreview(img)}>
                    {img.url && !failedIds.has(img.id) ? (
                      <img src={img.url} alt={img.modality}
                        style={{width:'100%',height:120,objectFit:'cover',display:'block'}}
                        onError={() => setFailedIds(s => new Set([...s, img.id]))} />
                    ) : (
                      <div style={{height:120,display:'flex',alignItems:'center',justifyContent:'center',
                        fontSize:'2rem',color:'var(--text-4)'}}>🖼️</div>
                    )}
                    <div style={{padding:'6px 8px'}}>
                      <div style={{fontSize:'0.68rem',fontWeight:600,color:'var(--cyan)'}}>{img.modality}</div>
                      <div style={{fontSize:'0.63rem',color:'var(--text-3)'}}>{img.created_at?.slice(0,10)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Lightbox */}
          {preview && (
            <div style={{
              position:'fixed', inset:0, zIndex:9999,
              background:'rgba(0,0,0,0.85)', display:'flex',
              alignItems:'center', justifyContent:'center',
            }} onClick={() => setPreview(null)}>
              <div style={{maxWidth:'90vw',maxHeight:'90vh',position:'relative'}} onClick={e => e.stopPropagation()}>
                <button style={{
                  position:'absolute',top:-12,right:-12,zIndex:1,
                  background:'#334155',border:'none',borderRadius:'50%',
                  width:28,height:28,cursor:'pointer',color:'#fff',fontSize:16,
                }} onClick={() => setPreview(null)}>✕</button>
                <img src={preview.url} alt={preview.modality}
                  style={{maxWidth:'85vw',maxHeight:'82vh',objectFit:'contain',borderRadius:8,display:'block'}} />
                <div style={{textAlign:'center',marginTop:8,fontSize:'0.75rem',color:'var(--text-3)'}}>
                  {preview.modality} · {preview.created_at?.slice(0,10)}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Reportes ────────────────────────────────────────────────────────────── */
function ReportsTab({ api, selectedPat }) {
  const [reports,    setReports]    = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [signing,    setSigning]    = useState(null)   // rid being signed
  const [signForm,   setSignForm]   = useState({})     // rid → {action, notes, rejection_reason}

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPat) load() }, [selectedPat?.id])

  const load = async () => {
    if (!selectedPat) return
    setLoading(true)
    try {
      const data = await api.getRiskReports(selectedPat.id)
      setReports(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al cargar reportes')
    } finally { setLoading(false) }
  }

  const sign = async (rid) => {
    const form = signForm[rid] || {}
    if (!form.action) { toast.error('Selecciona una acción (ACCEPTED/REJECTED)'); return }
    setSigning(rid)
    try {
      await api.signReport(rid, { action: form.action, notes: form.notes || null, rejection_reason: form.rejection_reason || null })
      toast.success(`Reporte ${form.action === 'ACCEPTED' ? 'aceptado' : 'rechazado'}`)
      setSignForm(f => ({ ...f, [rid]: {} }))
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al firmar')
    } finally {
      setSigning(null)
      load()
    }
  }

  const setField = (rid, key, val) =>
    setSignForm(f => ({ ...f, [rid]: { ...(f[rid] || {}), [key]: val } }))

  const catColor = (cat) =>
    cat === 'HIGH' || cat === 'CRITICAL' ? 'var(--danger)' :
    cat === 'MEDIUM' ? 'var(--warning)' : 'var(--success)'

  return (
    <div>
      <h3 style={{marginBottom:'0.5rem',color:'var(--text-1)'}}>Reportes de Riesgo</h3>

      {!selectedPat ? (
        <div className="alert alert-warning" style={{fontSize:'0.78rem'}}>
          Selecciona un paciente antes de ver sus reportes.
        </div>
      ) : (
        <>
          <div className="su-context-banner" style={{marginBottom:'1rem'}}>
            Paciente: <strong>{selectedPat.name?.[0]?.text}</strong>
          </div>
          <button className="btn btn-ghost btn-sm" style={{marginBottom:'1rem'}} onClick={load} disabled={loading}>
            {loading ? <><div className="spinner"/>Cargando…</> : '↻ Cargar reportes'}
          </button>

          {reports && (
            reports.entry.length === 0
              ? <div style={{color:'var(--text-3)',fontSize:'0.85rem'}}>No hay reportes registrados.</div>
              : <div style={{display:'flex',flexDirection:'column',gap:'0.75rem'}}>
                  {reports.entry.map(r => (
                    <div key={r.id} style={{
                      background: 'var(--surface-2,#1e293b)',
                      borderRadius: 10, padding: '12px 14px',
                      border: r.pending ? '1px solid #334155' : '1px solid #1e3a5f',
                    }}>
                      {/* Header del reporte */}
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                          <span className="badge" style={{background:'#0e3a4a',color:'#06b6d4',fontSize:'0.65rem'}}>{r.model_type}</span>
                          {r.risk_category && (
                            <span className="badge" style={{background: catColor(r.risk_category), color:'#fff', fontSize:'0.65rem'}}>
                              {r.risk_category}
                            </span>
                          )}
                          {r.is_critical && <span className="badge" style={{background:'#7f1d1d',color:'#fca5a5',fontSize:'0.65rem'}}>⚠ CRÍTICO</span>}
                        </div>
                        <span style={{fontSize:'0.68rem',color:'var(--text-3)'}}>{r.created_at?.slice(0,10)}</span>
                      </div>

                      <div style={{fontSize:'0.72rem',color:'var(--text-3)',marginBottom:4}}>
                        Score: <strong style={{color:'var(--text-1)'}}>{r.risk_score !== null ? (r.risk_score * 100).toFixed(1) + '%' : '—'}</strong>
                        <span style={{marginLeft:12}}>ID: <code style={{fontSize:'0.65rem'}}>{r.id.slice(0,8)}…</code></span>
                      </div>

                      {/* Estado de firma */}
                      {!r.pending ? (
                        <div style={{marginTop:6,fontSize:'0.72rem',color: r.doctor_action === 'ACCEPTED' ? 'var(--success)' : 'var(--danger)'}}>
                          {r.doctor_action === 'ACCEPTED' ? '✓ Aceptado' : '✗ Rechazado'}
                          {r.signed_at && <span style={{color:'var(--text-3)',marginLeft:8}}>{r.signed_at.slice(0,10)}</span>}
                          {r.signed_by_name && <span style={{color:'var(--text-3)',marginLeft:8}}>por {r.signed_by_name}</span>}
                          {r.doctor_notes && <div style={{color:'var(--text-2)',marginTop:2}}>{r.doctor_notes}</div>}
                        </div>
                      ) : (
                        /* Formulario de firma */
                        <div style={{marginTop:8,borderTop:'1px solid #334155',paddingTop:8}}>
                          <div style={{fontSize:'0.72rem',color:'#fbbf24',marginBottom:6}}>⏳ Pendiente de firma</div>
                          <div style={{display:'flex',gap:8,marginBottom:6}}>
                            {['ACCEPTED','REJECTED'].map(a => (
                              <button key={a}
                                className={`btn btn-sm ${signForm[r.id]?.action === a ? (a==='ACCEPTED'?'btn-success':'btn-danger') : 'btn-ghost'}`}
                                style={{fontSize:'0.72rem'}}
                                onClick={() => setField(r.id,'action',a)}
                              >
                                {a === 'ACCEPTED' ? '✓ Aceptar' : '✗ Rechazar'}
                              </button>
                            ))}
                          </div>
                          <input className="input" style={{fontSize:'0.75rem',padding:'5px 8px',marginBottom:4}}
                            placeholder="Notas del médico (opcional)"
                            value={signForm[r.id]?.notes || ''}
                            onChange={e => setField(r.id,'notes',e.target.value)} />
                          {signForm[r.id]?.action === 'REJECTED' && (
                            <input className="input" style={{fontSize:'0.75rem',padding:'5px 8px',marginBottom:4}}
                              placeholder="Razón de rechazo"
                              value={signForm[r.id]?.rejection_reason || ''}
                              onChange={e => setField(r.id,'rejection_reason',e.target.value)} />
                          )}
                          <button className="btn btn-primary btn-sm" style={{marginTop:4,fontSize:'0.72rem'}}
                            onClick={() => sign(r.id)}
                            disabled={signing === r.id || !signForm[r.id]?.action}>
                            {signing === r.id ? <><div className="spinner"/>Firmando…</> : 'Confirmar firma'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
          )}
        </>
      )}
    </div>
  )
}
