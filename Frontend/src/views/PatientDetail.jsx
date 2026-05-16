import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { fhirAPI, inferAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import ImageViewer from '../components/ImageViewer'
import './PatientDetail.css'

const calcAge = (bd) => {
  if (!bd) return '—'
  return Math.floor((Date.now() - new Date(bd)) / (365.25 * 24 * 3600 * 1000))
}

const LOINC_NAMES = {
  // Códigos LOINC
  '2339-0':  'Glucosa',   '55284-4': 'Presión Arterial',
  '39156-5': 'BMI',       '14749-6': 'Insulina',
  '21612-7': 'Edad',      '11996-6': 'Embarazos',
  '39106-0': 'Grosor Piel','33914-3': 'Pedigree Diabetes',
  // Nombres en inglés — ML service devuelve estas claves directamente
  'Glucose':                  'Glucosa',
  'BloodPressure':            'Presión Arterial',
  'BMI':                      'BMI',
  'Insulin':                  'Insulina',
  'Age':                      'Edad',
  'Pregnancies':              'Embarazos',
  'SkinThickness':            'Grosor Piel',
  'DiabetesPedigreeFunction': 'Pedigree Diabetes',
}

const FEATURE_INDEX_NAMES = {
  0: 'Embarazos', 1: 'Glucosa', 2: 'Presión Arterial',
  3: 'Grosor Piel', 4: 'Insulina', 5: 'BMI',
  6: 'Pedigree Diabetes', 7: 'Edad',
}

const OUTLIER_RULES = {
  '2339-0':  { max: 600, msg: 'Glucosa >600 mg/dL — valor crítico' },
  '55284-4': { max: 200, msg: 'Presión sistólica >200 mmHg' },
  '39156-5': { max: 60,  msg: 'BMI >60 — obesidad mórbida severa' },
}

const RISK_COLORS = {
  LOW:'#22c55e', MEDIUM:'#f59e0b', HIGH:'#f97316', CRITICAL:'#dc2626',
}

const TABS = ['Datos', 'Observaciones', 'Imágenes', 'Análisis IA', 'Reportes']

// ── Modal alerta crítica ──────────────────────────────────────────────────────
function CriticalModal({ report, onClose }) {
  const [action, setAction]       = useState(null)
  const [notes, setNotes]         = useState('')
  const [rejection, setRejection] = useState('')
  const [saving, setSaving]       = useState(false)
  const [done, setDone]           = useState(false)
  const valid = action && notes.length >= 30 && (action !== 'REJECTED' || rejection.length >= 20)

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    try {
      await fhirAPI.signReport(report.id, {
        action, doctor_notes: notes,
        rejection_reason: action === 'REJECTED' ? rejection : undefined,
      })
      setDone(true)
      setTimeout(onClose, 1200)
    } catch (e) {
      alert('Error al firmar: ' + (e.response?.data?.detail || e.message))
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal critical-modal">
        <div className="critical-modal-header">
          <span className="critical-icon">🚨</span>
          <h2>ALERTA CRÍTICA — Acción Requerida</h2>
        </div>
        <p style={{ marginBottom:'1rem', color:'var(--text-secondary)' }}>
          Diagnóstico <strong style={{ color:'var(--danger)' }}>CRÍTICO</strong>.
          Debe gestionarlo antes de continuar.
        </p>
        <div className="risk-score-display" style={{ marginBottom:'1.5rem' }}>
          <span className="score-number" style={{ color:'var(--danger)' }}>
            {report.risk_score != null ? `${(report.risk_score*100).toFixed(1)}%` : '—'}
          </span>
          <span className="score-label">Score de riesgo</span>
        </div>
        <div style={{ display:'flex', gap:'0.75rem', marginBottom:'1rem' }}>
          <button className={`btn ${action==='ACCEPTED'?'btn-success':'btn-ghost'}`} style={{flex:1}} onClick={()=>setAction('ACCEPTED')}>✅ Aceptar</button>
          <button className={`btn ${action==='REJECTED'?'btn-danger':'btn-ghost'}`} style={{flex:1}} onClick={()=>setAction('REJECTED')}>❌ Rechazar</button>
        </div>
        <textarea className="input" rows={3} placeholder="Observaciones clínicas (mín. 30 chars)…" value={notes} onChange={e=>setNotes(e.target.value)} style={{width:'100%',resize:'vertical',marginBottom:'0.5rem'}}/>
        <div style={{fontSize:'0.75rem',color:notes.length>=30?'var(--success)':'var(--text-tertiary)',marginBottom:'0.75rem'}}>{notes.length}/30</div>
        {action==='REJECTED' && (
          <>
            <textarea className="input" rows={2} placeholder="Justificación (mín. 20 chars)…" value={rejection} onChange={e=>setRejection(e.target.value)} style={{width:'100%',resize:'vertical',marginBottom:'0.5rem'}}/>
            <div style={{fontSize:'0.75rem',color:rejection.length>=20?'var(--success)':'var(--text-tertiary)',marginBottom:'0.75rem'}}>{rejection.length}/20</div>
          </>
        )}
        {done ? (
          <div style={{textAlign:'center',color:'var(--success)',fontWeight:700}}>✅ Firmado</div>
        ) : (
          <button className="btn btn-primary" style={{width:'100%'}} disabled={!valid||saving} onClick={submit}>
            {saving?'Guardando…':'✍ Confirmar firma'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Tab Datos ─────────────────────────────────────────────────────────────────
function TabDatos({ patient, role }) {
  const isAdmin = role === 'ADMIN'
  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-header"><span className="card-icon">👤</span><h3>Datos FHIR Patient</h3></div>
        {isAdmin && (
          <div style={{marginBottom:'0.75rem',padding:'0.625rem 0.875rem',
            background:'rgba(234,179,8,0.08)',border:'1px solid rgba(234,179,8,0.25)',
            borderRadius:'var(--radius-sm)',fontSize:'0.8rem',color:'#fde68a',display:'flex',gap:'0.5rem',alignItems:'center'}}>
            🔒 Vista de Administrador — información clínica protegida
          </div>
        )}
        <div className="data-list">
          {[
            ['Nombre completo', patient.name],
            ['Fecha de nac.',   isAdmin ? '••••••••' : patient.birthDate],
            ['Edad',            isAdmin ? '••' : calcAge(patient.birthDate) + ' años'],
            ['ID Paciente',     patient.id],
            ['Doc. Identidad',  isAdmin ? '••••••••' : (patient.identification_doc || '—')],
            ['Estado',          patient.active!==false?'Activo':'Inactivo'],
            ['Creado',          isAdmin ? '••••••••' : (patient.meta?.createdAt ? new Date(patient.meta.createdAt).toLocaleDateString('es-CO') : '—')],
          ].map(([l,v])=>(
            <div key={l}>
              <dt style={{fontSize:'0.75rem',color:'var(--text-tertiary)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{l}</dt>
              <dd style={isAdmin && l!=='Nombre completo' && l!=='ID Paciente' && l!=='Estado' ? {color:'var(--text-tertiary)',letterSpacing:'0.15em'} : {}}>{v}</dd>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><span className="card-icon">🏥</span><h3>Información clínica</h3></div>
        <p style={{color:'var(--text-secondary)',fontSize:'0.875rem',lineHeight:1.6}}>
          Sistema ClinAI · Apoyo diagnóstico para diabetes y retinopatía diabética.<br/><br/>
          <strong>Disclaimer IA:</strong> Los resultados son generados por IA de apoyo diagnóstico. No reemplazan el criterio médico profesional.
        </p>
        <div style={{marginTop:'1rem',padding:'0.75rem',background:'var(--surface-2)',borderRadius:'var(--radius-sm)',fontSize:'0.8rem',color:'var(--text-tertiary)'}}>
          🔒 Datos protegidos · Ley 1581/2012 · Cifrado AES-256 en reposo
        </div>
      </div>
    </div>
  )
}

// ── Tab Observaciones ─────────────────────────────────────────────────────────
function TabObservaciones({ patientId, role }) {
  const [obs, setObs]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (role === 'ADMIN') { setLoading(false); return }
    fhirAPI.listObservations(patientId)
      .then(r => setObs(r.data.entry || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [patientId, role])

  if (role === 'ADMIN') return (
    <div className="tab-content">
      <div style={{textAlign:'center',padding:'3rem 2rem',display:'flex',flexDirection:'column',
        alignItems:'center',gap:'1rem'}}>
        <span style={{fontSize:'2.5rem'}}>🔒</span>
        <h3 style={{color:'var(--text-primary)',margin:0}}>Acceso restringido</h3>
        <p style={{color:'var(--text-secondary)',fontSize:'0.9rem',maxWidth:400,lineHeight:1.6,margin:0}}>
          Las observaciones clínicas solo pueden ser consultadas por el <strong>médico tratante</strong> o el <strong>propio paciente</strong>.
        </p>
        <div style={{padding:'0.625rem 1rem',background:'rgba(234,179,8,0.08)',
          border:'1px solid rgba(234,179,8,0.25)',borderRadius:'var(--radius-sm)',
          fontSize:'0.8rem',color:'#fde68a'}}>
          🔒 Protegido · Ley 1581/2012
        </div>
      </div>
    </div>
  )

  if (loading) return <div className="loading-state">Cargando observaciones…</div>
  if (!obs.length) return <div className="empty-state">Sin observaciones LOINC registradas</div>

  const chartData = obs.map(o=>({
    name: LOINC_NAMES[o.code?.coding?.[0]?.code] || o.code?.coding?.[0]?.code,
    value: o.valueQuantity?.value,
    unit: o.valueQuantity?.unit,
    loinc: o.code?.coding?.[0]?.code,
  })).filter(d=>d.value!=null)

  return (
    <div className="tab-content" style={{display:'flex',flexDirection:'column',gap:'1.5rem'}}>
      <div className="card">
        <div className="card-header"><span className="card-icon">📊</span><h3>Valores clínicos — Gráfica</h3></div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{top:8,right:16,left:0,bottom:48}}>
            <XAxis dataKey="name" tick={{fill:'var(--text-tertiary)',fontSize:11}} angle={-25} textAnchor="end"/>
            <YAxis tick={{fill:'var(--text-tertiary)',fontSize:11}}/>
            <Tooltip contentStyle={{background:'var(--surface-2)',border:'1px solid var(--border-subtle)',borderRadius:8,color:'var(--text-primary)'}}
              formatter={(v,n,props)=>[`${v} ${props.payload.unit||''}`,props.payload.name]}/>
            <Bar dataKey="value" radius={[4,4,0,0]}>
              {chartData.map((e,i)=>{
                const rule=OUTLIER_RULES[e.loinc]
                return <Cell key={i} fill={rule&&e.value>rule.max?'var(--danger)':'var(--cyan)'}/>
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div className="card-header" style={{padding:'1rem 1.25rem 0'}}><span className="card-icon">🔬</span><h3>Detalle LOINC</h3></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>LOINC</th><th>Parámetro</th><th>Valor</th><th>Unidad</th><th>Estado</th><th>Fecha</th></tr></thead>
            <tbody>
              {obs.map(o=>{
                const loinc=o.code?.coding?.[0]?.code
                const rule=OUTLIER_RULES[loinc]
                const val=o.valueQuantity?.value
                const isOutlier=rule&&val>rule.max
                return (
                  <tr key={o.id}>
                    <td><code style={{fontSize:'0.75rem',color:'var(--text-tertiary)'}}>{loinc}</code></td>
                    <td>{LOINC_NAMES[loinc]||loinc}</td>
                    <td><span style={{color:isOutlier?'var(--danger)':'var(--text-primary)',fontWeight:isOutlier?700:400}}>
                      {val}{isOutlier&&<span title={rule.msg} style={{marginLeft:6,cursor:'help'}}>⚠️</span>}
                    </span></td>
                    <td style={{color:'var(--text-secondary)',fontSize:'0.85rem'}}>{o.valueQuantity?.unit}</td>
                    <td><span className="badge badge-success" style={{fontSize:'0.7rem'}}>{o.status}</span></td>
                    <td style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>
                      {o.effectiveDateTime?new Date(o.effectiveDateTime).toLocaleDateString('es-CO'):'—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab Imágenes ──────────────────────────────────────────────────────────────
function TabImagenes({ patientId, role }) {
  const [media, setMedia]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected]   = useState(null)
  const [imgUrl, setImgUrl]       = useState(null)   // ← URL presignada
  const [imgLoading, setImgLoading] = useState(false)
  const [modality, setModality]   = useState('FUNDUS')
  const fileRef = useRef()

  const loadMedia = useCallback(async () => {
    if (role === 'ADMIN') { setLoading(false); return }
    try {
      const r = await fhirAPI.listMedia(patientId)
      const entries = r.data.entry || []
      setMedia(entries)
      if (entries.length > 0) {
        setSelected(entries[0])
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [patientId, role])

  useEffect(() => { loadMedia() }, [loadMedia])

  // Cuando cambia la imagen seleccionada, obtener URL presignada
  useEffect(() => {
    if (!selected?.id) { setImgUrl(null); return }
    setImgLoading(true)
    fhirAPI.getMediaUrl(selected.id)
      .then(r => setImgUrl(r.data.url))
      .catch(e => {
        console.error('Error obteniendo URL de imagen:', e)
        setImgUrl(null)
      })
      .finally(() => setImgLoading(false))
  }, [selected])

  if (role === 'ADMIN') return (
    <div className="tab-content">
      <div style={{textAlign:'center',padding:'3rem 2rem',display:'flex',flexDirection:'column',
        alignItems:'center',gap:'1rem'}}>
        <span style={{fontSize:'2.5rem'}}>🖼️</span>
        <h3 style={{color:'var(--text-primary)',margin:0}}>Acceso restringido</h3>
        <p style={{color:'var(--text-secondary)',fontSize:'0.9rem',maxWidth:400,lineHeight:1.6,margin:0}}>
          Las imágenes médicas solo pueden ser visualizadas por el <strong>médico tratante</strong> o el <strong>propio paciente</strong>.
        </p>
        <div style={{padding:'0.625rem 1rem',background:'rgba(234,179,8,0.08)',
          border:'1px solid rgba(234,179,8,0.25)',borderRadius:'var(--radius-sm)',
          fontSize:'0.8rem',color:'#fde68a'}}>
          🔒 Protegido · Ley 1581/2012
        </div>
      </div>
    </div>
  )

  useEffect(() => { loadMedia() }, [loadMedia])

  // Cuando cambia la imagen seleccionada, obtener URL presignada
  useEffect(() => {
    if (!selected?.id) { setImgUrl(null); return }
    setImgLoading(true)
    fhirAPI.getMediaUrl(selected.id)
      .then(r => setImgUrl(r.data.url))
      .catch(e => {
        console.error('Error obteniendo URL de imagen:', e)
        setImgUrl(null)
      })
      .finally(() => setImgLoading(false))
  }, [selected])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await fhirAPI.uploadImage(patientId, file, modality)
      await loadMedia()
    } catch (err) {
      alert('Error al subir imagen: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (loading) return <div className="loading-state">Cargando imágenes…</div>

  return (
    <div className="tab-content" style={{display:'flex',flexDirection:'column',gap:'1.25rem'}}>
      {role !== 'PACIENTE' && (
        <div className="card">
          <div className="card-header"><span className="card-icon">📤</span><h3>Subir imagen</h3></div>
          <div style={{display:'flex',gap:'0.75rem',alignItems:'center',flexWrap:'wrap'}}>
            <select className="input" style={{width:180}} value={modality} onChange={e=>setModality(e.target.value)}>
              <option value="FUNDUS">Fondo de ojo (FUNDUS)</option>
              <option value="XRAY">Radiografía</option>
              <option value="DERM">Dermatología</option>
              <option value="OTHER">Otra</option>
            </select>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" style={{display:'none'}} onChange={handleUpload}/>
            <button className="btn btn-primary" disabled={uploading} onClick={()=>fileRef.current?.click()}>
              {uploading?'⏳ Subiendo…':'📁 Seleccionar imagen (JPG/PNG)'}
            </button>
          </div>
        </div>
      )}

      {media.length === 0 ? (
        <div className="empty-state">Sin imágenes registradas para este paciente</div>
      ) : (
        <div className="grid-2">
          <div className="card" style={{minHeight:340}}>
            <div className="card-header">
              <span className="card-icon">🖼</span>
              <h3>Visor — {selected?.modality || 'Imagen'}</h3>
            </div>
            {imgLoading ? (
              <div className="loading-state">Cargando imagen…</div>
            ) : imgUrl ? (
              <ImageViewer src={imgUrl} alt={`Imagen ${selected?.modality}`}/>
            ) : (
              <div className="empty-state">No se pudo cargar la imagen</div>
            )}
          </div>
          <div className="card">
            <div className="card-header"><span className="card-icon">📂</span><h3>Imágenes ({media.length})</h3></div>
            <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
              {media.map(m=>(
                <div key={m.id} onClick={()=>setSelected(m)} style={{
                  padding:'0.625rem 0.875rem',borderRadius:'var(--radius-sm)',
                  border:`1px solid ${selected?.id===m.id?'var(--cyan)':'var(--border-subtle)'}`,
                  background:selected?.id===m.id?'var(--cyan-dim)':'transparent',
                  cursor:'pointer',display:'flex',justifyContent:'space-between',
                  alignItems:'center',transition:'all 0.15s',
                }}>
                  <span style={{fontSize:'0.875rem'}}>{m.modality} — {new Date(m.createdDateTime).toLocaleDateString('es-CO')}</span>
                  {selected?.id===m.id&&<span style={{color:'var(--cyan)',fontSize:'0.75rem'}}>● activa</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab Análisis IA ───────────────────────────────────────────────────────────
function TabAnalisis({ patientId, onCritical }) {
  const [modelType, setModelType] = useState('ML')
  const [taskId, setTaskId]       = useState(null)
  const [status, setStatus]       = useState(null)
  const [result, setResult]       = useState(null)
  const [running, setRunning]     = useState(false)
  const [errMsg, setErrMsg]       = useState(null)
  const pollRef = useRef(null)

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current=null } }

  const startInference = async () => {
    setRunning(true)
    setResult(null)
    setErrMsg(null)
    setStatus('PENDING')
    setTaskId(null)
    stopPolling()
    try {
      const { data } = await inferAPI.request(patientId, modelType)
      const tid = data.task_id
      setTaskId(tid)
      setStatus(data.status)

      pollRef.current = setInterval(async () => {
        try {
          // Usar /result que retorna el risk_report completo
          const s = await inferAPI.result(tid)
          const d = s.data
          setStatus(d.status)

          if (d.status === 'DONE') {
            if (d.result) {
              // ✅ Solo parar cuando el resultado completo está disponible
              stopPolling()
              setRunning(false)
              setResult(d.result)
              if (d.result.is_critical) onCritical(d.result)
            }
            // Si DONE pero result aún null → condición de carrera, seguir polling
          } else if (d.status === 'ERROR') {
            stopPolling()
            setRunning(false)
            setErrMsg(d.error_msg || 'Error desconocido en la inferencia')
          }
        } catch (e) {
          console.error('Polling error:', e)
          // No detener polling en errores de red transitorios
        }
      }, 3000)
    } catch (e) {
      const detail = e.response?.data?.detail
      setErrMsg(typeof detail === 'string' ? detail : JSON.stringify(detail) || e.message)
      setRunning(false)
      setStatus('ERROR')
    }
  }

  useEffect(() => () => stopPolling(), [])

  const statusColor = { PENDING:'var(--text-tertiary)', RUNNING:'var(--cyan)', DONE:'var(--success)', ERROR:'var(--danger)' }

  const shapData = result?.shap_values
    ? Object.entries(result.shap_values)
        .map(([k, v]) => {
          const name = LOINC_NAMES[k] || FEATURE_INDEX_NAMES[Number(k)] || k
          return { name, value: Math.abs(Number(v)), raw: Number(v) }
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
    : []
    
  return (
    <div className="tab-content" style={{display:'flex',flexDirection:'column',gap:'1.25rem'}}>
      <div className="card">
        <div className="card-header"><span className="card-icon">🤖</span><h3>Configurar análisis</h3></div>
        <div style={{display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:'0.5rem'}}>
            {['ML','DL','MULTIMODAL'].map(t=>(
              <button key={t} className={`filter-pill${modelType===t?' active':''}`}
                onClick={()=>setModelType(t)} disabled={running}>
                {t==='ML'?'📊 Tabular ML':t==='DL'?'🧠 Imagen DL':'🔮 Multimodal'}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={startInference} disabled={running} style={{marginLeft:'auto'}}>
            {running?'⏳ Analizando…':'▶ Ejecutar análisis'}
          </button>
        </div>

        {status && (
          <div style={{marginTop:'1rem',display:'flex',alignItems:'center',gap:'0.75rem'}}>
            {running && (
              <div style={{width:16,height:16,border:'2px solid var(--border-subtle)',borderTopColor:'var(--cyan)',
                borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
            )}
            <span style={{color:statusColor[status]||'inherit',fontSize:'0.875rem',fontWeight:600}}>
              {status==='PENDING'?'⏳ En cola de procesamiento…'
               :status==='RUNNING'?'🔄 Ejecutando modelo de IA…'
               :status==='DONE'?'✅ Análisis completado'
               :'❌ Error en la inferencia'}
            </span>
            {taskId && <code style={{fontSize:'0.7rem',color:'var(--text-tertiary)'}}>{taskId.slice(0,12)}…</code>}
          </div>
        )}

        {errMsg && (
          <div style={{marginTop:'0.75rem',padding:'0.75rem',background:'var(--critical-dim)',
            border:'1px solid rgba(220,38,38,0.4)',borderRadius:'var(--radius-sm)',
            color:'var(--danger)',fontSize:'0.85rem'}}>
            <strong>Error:</strong> {errMsg}
          </div>
        )}
      </div>

      {result && (
        <>
          <div className="card" style={{
            border: result.is_critical?'1px solid var(--danger)':'1px solid var(--border-subtle)',
            background: result.is_critical?'var(--critical-dim)':undefined,
          }}>
            <div className="card-header"><span className="card-icon">📈</span><h3>Resultado del análisis</h3></div>
            <div style={{display:'flex',gap:'2rem',flexWrap:'wrap',marginBottom:'1rem'}}>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:'2.5rem',fontWeight:800,fontFamily:'var(--font-display)',
                  color:RISK_COLORS[result.risk_category]||'var(--text-primary)'}}>
                  {result.risk_score!=null?`${(result.risk_score*100).toFixed(1)}%`:'—'}
                </div>
                <div style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>Score de riesgo</div>
              </div>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:'1.5rem',fontWeight:700,color:RISK_COLORS[result.risk_category]}}>
                  {result.risk_category||'—'}
                </div>
                <div style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>Categoría</div>
              </div>
              {result.model_type && (
                <div style={{textAlign:'center'}}>
                  <div style={{fontSize:'1.25rem',fontWeight:600,color:'var(--cyan)'}}>{result.model_type}</div>
                  <div style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>Modelo</div>
                </div>
              )}
            </div>
            <div style={{padding:'0.625rem 0.875rem',background:'var(--surface-2)',borderRadius:'var(--radius-sm)',
              fontSize:'0.8rem',color:'var(--text-secondary)',lineHeight:1.5}}>
              ⚠️ <strong>Disclaimer IA:</strong> Resultado generado por IA de apoyo diagnóstico. No reemplaza criterio médico.
            </div>
          </div>

          {shapData.length > 0 && (
            <div className="card">
              <div className="card-header"><span className="card-icon">🔍</span><h3>Explicabilidad SHAP</h3></div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={shapData} layout="vertical" margin={{top:4,right:24,left:80,bottom:4}}>
                  <XAxis type="number" tick={{fill:'var(--text-tertiary)',fontSize:11}}/>
                  <YAxis dataKey="name" type="category" tick={{fill:'var(--text-secondary)',fontSize:12}}/>
                  <Tooltip contentStyle={{background:'var(--surface-2)',border:'1px solid var(--border-subtle)',
                    color:'var(--text-primary)',borderRadius:8}} formatter={v=>[v.toFixed(4),'SHAP']}/>
                  <Bar dataKey="value" radius={[0,4,4,0]}>
                    {shapData.map((e,i)=><Cell key={i} fill={e.raw>=0?'var(--cyan)':'var(--danger)'}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {result.gradcam_url && (
            <div className="card">
              <div className="card-header"><span className="card-icon">🧠</span><h3>Grad-CAM — Zonas de atención</h3></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
                <div>
                  <p style={{fontSize:'0.8rem',color:'var(--text-tertiary)',marginBottom:'0.5rem'}}>Imagen original</p>
                  <ImageViewer src={result.original_url||''} alt="Original"/>
                </div>
                <div>
                  <p style={{fontSize:'0.8rem',color:'var(--text-tertiary)',marginBottom:'0.5rem'}}>Grad-CAM superpuesto</p>
                  <ImageViewer src={result.gradcam_url} alt="Grad-CAM"/>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Formulario de firma aislado por reporte (fix: estado compartido) ──────────
function SignForm({ rep, onSigned, onCancel }) {
  const [action,    setAction]    = useState(null)
  const [notes,     setNotes]     = useState('')
  const [rejection, setRejection] = useState('')
  const [saving,    setSaving]    = useState(false)

  const canSubmit = action && notes.length >= 30 && (action !== 'REJECTED' || rejection.length >= 20)

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      await fhirAPI.signReport(rep.id, {
        action,
        doctor_notes: notes,
        rejection_reason: action === 'REJECTED' ? rejection : undefined,
      })
      onSigned?.()
    } catch (e) {
      alert('Error al firmar: ' + (e.response?.data?.detail || e.message))
    } finally { setSaving(false) }
  }

  return (
    <div style={{borderTop:'1px solid var(--border-subtle)',paddingTop:'1rem',
      display:'flex',flexDirection:'column',gap:'0.75rem'}}>
      <div style={{fontSize:'0.85rem',fontWeight:600,color:'var(--text-primary)'}}>
        ✍ Firmar diagnóstico
      </div>
      <div style={{display:'flex',gap:'0.5rem'}}>
        <button
          className={`btn ${action==='ACCEPTED'?'btn-success':'btn-ghost'} btn-sm`}
          style={{flex:1,boxShadow:action==='ACCEPTED'?'0 0 12px rgba(34,197,94,0.25)':'none'}}
          onClick={()=>setAction('ACCEPTED')}>
          ✅ Aceptar diagnóstico
        </button>
        <button
          className={`btn ${action==='REJECTED'?'btn-danger':'btn-ghost'} btn-sm`}
          style={{flex:1,boxShadow:action==='REJECTED'?'0 0 12px rgba(220,38,38,0.25)':'none'}}
          onClick={()=>setAction('REJECTED')}>
          ❌ Rechazar diagnóstico
        </button>
      </div>
      <div>
        <textarea
          className="input" rows={2}
          placeholder="Observaciones clínicas (mín. 30 chars)…"
          value={notes} onChange={e=>setNotes(e.target.value)}
          style={{resize:'vertical',width:'100%'}}/>
        <div style={{fontSize:'0.72rem',color:notes.length>=30?'var(--success)':'var(--text-tertiary)',marginTop:'0.2rem'}}>
          {notes.length}/30 caracteres
        </div>
      </div>
      {action==='REJECTED' && (
        <div>
          <textarea
            className="input" rows={2}
            placeholder="Justificación del rechazo (mín. 20 chars)…"
            value={rejection} onChange={e=>setRejection(e.target.value)}
            style={{resize:'vertical',width:'100%'}}/>
          <div style={{fontSize:'0.72rem',color:rejection.length>=20?'var(--success)':'var(--text-tertiary)',marginTop:'0.2rem'}}>
            {rejection.length}/20 caracteres
          </div>
        </div>
      )}
      <div style={{display:'flex',gap:'0.5rem'}}>
        <button
          className="btn btn-primary btn-sm"
          disabled={saving||!canSubmit}
          onClick={submit}>
          {saving?'Guardando…':'✍ Confirmar firma'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}

// ── Tab Reportes ──────────────────────────────────────────────────────────────
function TabReportes({ patientId, role, onRefreshPending }) {
  const [reports,       setReports]       = useState([])
  const [loading,       setLoading]       = useState(true)
  const [expanded,      setExpanded]      = useState(null)
  const [detailCache,   setDetailCache]   = useState({})
  const [detailLoading, setDetailLoading] = useState(false)
  const isAdmin = role === 'ADMIN'

  const load = useCallback(async () => {
    try { const r = await fhirAPI.listRiskReports(patientId); setReports(r.data.entry||[]) }
    catch(e){console.error(e)} finally{setLoading(false)}
  }, [patientId])

  useEffect(()=>{load()},[load])

  // ── Vista Admin — solo resumen ────────────────────────────────────────────
  if (isAdmin) {
    if (loading) return <div className="loading-state">Cargando reportes…</div>
    const total   = reports.length
    const signed  = reports.filter(r => !!r.signed_at).length
    const pending = total - signed

    return (
      <div className="tab-content" style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
        <div style={{padding:'0.625rem 0.875rem',background:'rgba(234,179,8,0.08)',
          border:'1px solid rgba(234,179,8,0.25)',borderRadius:'var(--radius-sm)',
          fontSize:'0.8rem',color:'#fde68a',display:'flex',gap:'0.5rem',alignItems:'center'}}>
          🔒 Vista de Administrador — solo resumen de reportes
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1rem'}}>
          {[
            ['📋 Total',   total,   'var(--text-primary)'],
            ['✅ Firmados', signed,  'var(--success)'],
            ['⏳ Pendientes',pending,'var(--danger)'],
          ].map(([label,val,color])=>(
            <div key={label} className="card" style={{textAlign:'center',padding:'1.25rem'}}>
              <div style={{fontSize:'2rem',fontWeight:800,color,fontFamily:'var(--font-display)'}}>{val}</div>
              <div style={{fontSize:'0.8rem',color:'var(--text-tertiary)',marginTop:'0.25rem'}}>{label}</div>
            </div>
          ))}
        </div>

        {total > 0 && (
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div className="card-header" style={{padding:'0.75rem 1rem 0'}}>
              <span className="card-icon">📄</span><h3>Estado de reportes</h3>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>Modelo</th><th>Fecha</th><th>Estado firma</th></tr>
                </thead>
                <tbody>
                  {reports.map((rep,i)=>{
                    const signed = !!rep.signed_at
                    return (
                      <tr key={rep.id}>
                        <td style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>{i+1}</td>
                        <td style={{fontFamily:'var(--font-mono)',fontSize:'0.8rem'}}>{rep.method||rep.model_type||'ML'}</td>
                        <td style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>
                          {rep.occurrenceDateTime ? new Date(rep.occurrenceDateTime).toLocaleDateString('es-CO') : '—'}
                        </td>
                        <td>
                          {signed ? (
                            <span className="badge badge-success" style={{fontSize:'0.7rem'}}>✅ Firmado</span>
                          ) : (
                            <span className="badge" style={{fontSize:'0.7rem',background:'rgba(220,38,38,0.15)',
                              color:'var(--danger)',border:'1px solid rgba(220,38,38,0.3)'}}>⏳ Pendiente</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{padding:'0.625rem 0.875rem',background:'var(--surface-2)',
          borderRadius:'var(--radius-sm)',fontSize:'0.8rem',color:'var(--text-tertiary)',lineHeight:1.5}}>
          El contenido clínico de los reportes solo está disponible para el médico tratante.
        </div>
      </div>
    )
  }

  const fetchDetail = async (repId) => {
    if (detailCache[repId]) return
    setDetailLoading(true)
    try {
      const { data } = await fhirAPI.getRiskReport(repId)
      setDetailCache(prev => ({ ...prev, [repId]: data }))
    } catch(e) { console.error('Error fetching report detail:', e) }
    finally { setDetailLoading(false) }
  }

  const toggleExpand = (repId) => {
    const isClosing = expanded === repId
    setExpanded(isClosing ? null : repId)
    if (!isClosing) fetchDetail(repId)
  }

  const openSign = (repId, e) => {
    e.stopPropagation()
    setExpanded(repId)
    fetchDetail(repId)
  }

  const handleSigned = async () => {
    setExpanded(null)
    await load()
    onRefreshPending?.()
  }

  if (loading) return <div className="loading-state">Cargando reportes…</div>
  if (!reports.length) return <div className="empty-state">Sin RiskReports generados aún</div>

  return (
    <div className="tab-content" style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
      {reports.map(rep=>{
        const cat    = rep.prediction?.[0]?.qualitativeRisk?.coding?.[0]?.display||rep.risk_category||'UNKNOWN'
        const prob   = rep.prediction?.[0]?.probabilityDecimal
        const signed = !!rep.signed_at
        const isOpen = expanded === rep.id

        // Merge con detalle completo (tiene gradcam_url, original_url)
        const detail = detailCache[rep.id] || rep

        // SHAP data — el backend puede enviar shap_values como string JSON o como objeto
        const rawShap = detail.shap_values
          ? (typeof detail.shap_values === 'string' ? (() => { try { return JSON.parse(detail.shap_values) } catch { return null } })() : detail.shap_values)
          : null
        const shapData = rawShap
          ? Object.entries(rawShap)
              .map(([k, v]) => ({
                name:  LOINC_NAMES[k] || FEATURE_INDEX_NAMES[Number(k)] || k,
                value: Math.abs(Number(v)),
                raw:   Number(v),
              }))
              .sort((a,b) => b.value - a.value)
              .slice(0, 8)
          : []

        return (
          <div key={rep.id} className="card" style={{
            border: rep.is_critical&&!signed ? '1px solid var(--danger)' : '1px solid var(--border-subtle)',
            background: rep.is_critical&&!signed ? 'var(--critical-dim)' : undefined,
            cursor: 'pointer',
            transition: 'border-color 0.15s',
          }}>
            {/* ── Cabecera clickeable ── */}
            <div onClick={()=>toggleExpand(rep.id)}
              style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'0.75rem'}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.5rem'}}>
                  <span className="badge" style={{
                    background:(RISK_COLORS[cat]||'#888')+'22',
                    color:RISK_COLORS[cat]||'var(--text-secondary)',
                    border:`1px solid ${(RISK_COLORS[cat]||'#888')}55`,
                  }}>
                    {cat}
                  </span>
                  <span style={{color:'var(--text-tertiary)',fontSize:'0.8rem',fontFamily:'var(--font-mono)'}}>{rep.method||rep.model_type||'ML'}</span>
                  {rep.is_critical&&<span style={{color:'var(--danger)',fontSize:'0.8rem'}}>🚨 CRÍTICO</span>}
                </div>
                <div style={{fontSize:'0.875rem',color:'var(--text-secondary)'}}>
                  Score: <strong style={{color:'var(--text-primary)'}}>{prob!=null?`${(prob*100).toFixed(1)}%`:'—'}</strong>
                  {' · '}{rep.occurrenceDateTime?new Date(rep.occurrenceDateTime).toLocaleString('es-CO'):'—'}
                </div>
                {signed&&(
                  <div style={{fontSize:'0.8rem',marginTop:'0.25rem',
                    color: rep.doctor_action==='ACCEPTED'?'var(--success)':'var(--danger)'}}>
                    ✅ Firmado · {rep.doctor_action} · {new Date(rep.signed_at).toLocaleString('es-CO')}
                  </div>
                )}
              </div>
              <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
                {!signed&&role!=='PACIENTE'&&(
                  <button className="btn btn-primary btn-sm" onClick={(e)=>openSign(rep.id,e)}>✍ Firmar</button>
                )}
                <span style={{color:'var(--text-tertiary)',fontSize:'1rem',transition:'transform 0.2s',
                  display:'inline-block',transform:isOpen?'rotate(180deg)':'rotate(0deg)'}}>▾</span>
              </div>
            </div>

            {/* ── Detalle expandido ── */}
            {isOpen && (
              <div style={{marginTop:'1.25rem',borderTop:'1px solid var(--border-subtle)',paddingTop:'1.25rem',
                display:'flex',flexDirection:'column',gap:'1.25rem'}}>

                {/* Score grande */}
                <div style={{display:'flex',gap:'2rem',flexWrap:'wrap'}}>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:'2.5rem',fontWeight:800,fontFamily:'var(--font-display)',
                      color:RISK_COLORS[cat]||'var(--text-primary)'}}>
                      {prob!=null?`${(prob*100).toFixed(1)}%`:'—'}
                    </div>
                    <div style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>Score de riesgo</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:'1.5rem',fontWeight:700,color:RISK_COLORS[cat]||'var(--text-primary)'}}>
                      {cat}
                    </div>
                    <div style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>Categoría</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:'1.25rem',fontWeight:600,color:'var(--cyan)'}}>
                      {rep.method||rep.model_type||'ML'}
                    </div>
                    <div style={{color:'var(--text-tertiary)',fontSize:'0.8rem'}}>Modelo</div>
                  </div>
                </div>

                {/* SHAP — datos del reporte expandido, no del último ejecutado */}
                {shapData.length > 0 && (
                  <div>
                    <div style={{fontSize:'0.8rem',color:'var(--text-tertiary)',fontWeight:600,
                      marginBottom:'0.75rem',textTransform:'uppercase',letterSpacing:'0.05em'}}>
                      🔍 Explicabilidad SHAP
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={shapData} layout="vertical" margin={{top:4,right:24,left:80,bottom:4}}>
                        <XAxis type="number" tick={{fill:'var(--text-tertiary)',fontSize:11}}/>
                        <YAxis dataKey="name" type="category" tick={{fill:'var(--text-secondary)',fontSize:12}}/>
                        <Tooltip contentStyle={{background:'var(--surface-2)',border:'1px solid var(--border-subtle)',
                          color:'var(--text-primary)',borderRadius:8}} formatter={v=>[v.toFixed(4),'SHAP']}/>
                        <Bar dataKey="value" radius={[0,4,4,0]}>
                          {shapData.map((e,i)=><Cell key={i} fill={e.raw>=0?'var(--cyan)':'var(--danger)'}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Grad-CAM — usa el detalle completo del reporte */}
                {detailLoading && expanded === rep.id && !detail.gradcam_url && (
                  <div style={{fontSize:'0.8rem',color:'var(--text-tertiary)'}}>⏳ Cargando imágenes...</div>
                )}
                {detail.gradcam_url && (
                  <div>
                    <div style={{fontSize:'0.8rem',color:'var(--text-tertiary)',fontWeight:600,
                      marginBottom:'0.75rem',textTransform:'uppercase',letterSpacing:'0.05em'}}>
                      🧠 Grad-CAM — Zonas de atención
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
                      <div>
                        <p style={{fontSize:'0.75rem',color:'var(--text-tertiary)',marginBottom:'0.4rem'}}>Imagen original</p>
                        <ImageViewer src={detail.original_url||''} alt="Original"/>
                      </div>
                      <div>
                        <p style={{fontSize:'0.75rem',color:'var(--text-tertiary)',marginBottom:'0.4rem'}}>Grad-CAM superpuesto</p>
                        <ImageViewer src={detail.gradcam_url} alt="Grad-CAM"/>
                      </div>
                    </div>
                  </div>
                )}

                {/* Disclaimer */}
                <div style={{padding:'0.625rem 0.875rem',background:'var(--surface-2)',
                  borderRadius:'var(--radius-sm)',fontSize:'0.8rem',color:'var(--text-secondary)',lineHeight:1.5}}>
                  ⚠️ <strong>Disclaimer IA:</strong> Resultado generado por IA de apoyo diagnóstico. No reemplaza criterio médico.
                </div>

                {/* Formulario firma — componente aislado con su propio estado */}
                {!signed && role !== 'PACIENTE' && (
                  <SignForm
                    rep={rep}
                    onSigned={handleSigned}
                    onCancel={()=>setExpanded(null)}
                  />
                )}

                {/* Estado si ya firmado */}
                {signed && (
                  <div style={{
                    padding:'0.75rem 1rem',borderRadius:'var(--radius-sm)',
                    background: rep.doctor_action==='ACCEPTED'?'rgba(34,197,94,0.1)':'rgba(220,38,38,0.1)',
                    border: `1px solid ${rep.doctor_action==='ACCEPTED'?'rgba(34,197,94,0.3)':'rgba(220,38,38,0.3)'}`,
                    color: rep.doctor_action==='ACCEPTED'?'var(--success)':'var(--danger)',
                    fontSize:'0.875rem',fontWeight:600,
                  }}>
                    {rep.doctor_action==='ACCEPTED'?'✅ Diagnóstico aceptado por médico':'❌ Diagnóstico rechazado por médico'}
                    <span style={{fontWeight:400,color:'var(--text-tertiary)',marginLeft:'0.75rem',fontSize:'0.8rem'}}>
                      {new Date(rep.signed_at).toLocaleString('es-CO')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Modal Crear Paciente ──────────────────────────────────────────────────────
const LOINC_MAP = {
  Glucose:                  { loinc:'2339-0',  unit:'mg/dL',    label:'Glucosa',            placeholder:'ej. 120' },
  BloodPressure:            { loinc:'55284-4', unit:'mmHg',     label:'Presión Arterial',   placeholder:'ej. 80'  },
  BMI:                      { loinc:'39156-5', unit:'kg/m2',    label:'BMI',                placeholder:'ej. 28.5'},
  Insulin:                  { loinc:'14749-6', unit:'uU/mL',    label:'Insulina',           placeholder:'ej. 85'  },
  Age:                      { loinc:'21612-7', unit:'a',        label:'Edad (años)',         placeholder:'ej. 45'  },
  Pregnancies:              { loinc:'11996-6', unit:'{count}',  label:'Embarazos',          placeholder:'ej. 2'   },
  SkinThickness:            { loinc:'39106-0', unit:'mm',       label:'Grosor de Piel (mm)','placeholder':'ej. 23'},
  DiabetesPedigreeFunction: { loinc:'33914-3', unit:'{score}',  label:'Pedigree Diabetes',  placeholder:'ej. 0.5' },
}

function CreatePatientModal({ onClose, onCreated }) {
  const [step, setStep]   = useState(1)  // 1=datos, 2=observations
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [createdId, setCreatedId] = useState(null)

  const [form, setForm] = useState({
    name: '', birth_date: '', identification_doc: '',
  })
  const [obs, setObs] = useState(
    Object.fromEntries(Object.keys(LOINC_MAP).map(k=>[k,'']))
  )

  const setF = (k,v) => setForm(f=>({...f,[k]:v}))
  const setO = (k,v) => setObs(o=>({...o,[k]:v}))

  const createPatient = async () => {
    if (!form.name || !form.birth_date || !form.identification_doc) {
      setError('Nombre, fecha de nacimiento y documento son obligatorios')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data } = await fhirAPI.createPatient(form)
      setCreatedId(data.id)
      setStep(2)
    } catch(e) {
      setError(e.response?.data?.detail || 'Error al crear paciente')
    } finally { setSaving(false) }
  }

  const saveObservations = async () => {
    setSaving(true)
    setError('')
    let saved = 0
    try {
      for (const [key, cfg] of Object.entries(LOINC_MAP)) {
        const val = obs[key]
        if (val !== '' && !isNaN(Number(val))) {
          await fhirAPI.createObservation({
            patient_id: createdId,
            loinc_code: cfg.loinc,
            value: Number(val),
            unit: cfg.unit,
            status: 'final',
          })
          saved++
        }
      }
      onCreated?.()
      onClose()
    } catch(e) {
      setError(e.response?.data?.detail || 'Error guardando observaciones')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" style={{zIndex:900}}>
      <div className="modal" style={{maxWidth:600,maxHeight:'90vh',overflowY:'auto'}}>
        <div className="modal-header">
          <h3>{step===1?'Crear paciente — Datos personales':'Crear paciente — Observaciones LOINC'}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* Indicador de paso */}
        <div style={{display:'flex',gap:'0.5rem',marginBottom:'1.25rem'}}>
          {[1,2].map(s=>(
            <div key={s} style={{flex:1,height:3,borderRadius:2,
              background:step>=s?'var(--cyan)':'var(--border-subtle)',
              transition:'background 0.2s'}}/>
          ))}
        </div>
        <div style={{fontSize:'0.75rem',color:'var(--text-tertiary)',marginBottom:'1rem',
          fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.06em'}}>
          Paso {step} de 2 — {step===1?'Datos demográficos':'Valores clínicos (opcionales)'}
        </div>

        {step === 1 && (
          <div style={{display:'flex',flexDirection:'column',gap:'0.875rem'}}>
            <div>
              <label className="form-label">Nombre completo *</label>
              <input className="input" value={form.name} onChange={e=>setF('name',e.target.value)} placeholder="María García López"/>
            </div>
            <div>
              <label className="form-label">Fecha de nacimiento *</label>
              <input className="input" type="date" value={form.birth_date} onChange={e=>setF('birth_date',e.target.value)}/>
            </div>
            <div>
              <label className="form-label">Documento de identidad *</label>
              <input className="input" value={form.identification_doc} onChange={e=>setF('identification_doc',e.target.value)} placeholder="1234567890"/>
            </div>
            {error && <div style={{color:'var(--danger)',fontSize:'0.85rem'}}>{error}</div>}
            <div style={{display:'flex',gap:'0.75rem',marginTop:'0.5rem'}}>
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" style={{flex:1}} disabled={saving} onClick={createPatient}>
                {saving?'Creando…':'Siguiente →'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{display:'flex',flexDirection:'column',gap:'0.875rem'}}>
            <p style={{color:'var(--text-secondary)',fontSize:'0.85rem',lineHeight:1.5}}>
              Ingresa los valores clínicos del paciente. Son opcionales — puedes dejar en blanco los que no tengas.
              Estos se crearán como Observations FHIR con código LOINC estándar.
            </p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
              {Object.entries(LOINC_MAP).map(([key,cfg])=>(
                <div key={key}>
                  <label className="form-label">{cfg.label} <span style={{color:'var(--text-tertiary)',fontWeight:400}}>({cfg.unit})</span></label>
                  <input className="input" type="number" step="0.01" min="0"
                    value={obs[key]} onChange={e=>setO(key,e.target.value)}
                    placeholder={cfg.placeholder}/>
                </div>
              ))}
            </div>
            {error && <div style={{color:'var(--danger)',fontSize:'0.85rem'}}>{error}</div>}
            <div style={{display:'flex',gap:'0.75rem',marginTop:'0.5rem'}}>
              <button className="btn btn-ghost" onClick={()=>setStep(1)}>← Atrás</button>
              <button className="btn btn-primary" style={{flex:1}} disabled={saving} onClick={saveObservations}>
                {saving?'Guardando…':'✅ Crear paciente completo'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PatientDetail() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const { role: userRole } = useAuthStore()
  const user = { role: userRole }  // compatibilidad con referencias a user?.role

  const [patient, setPatient]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState('Datos')
  const [pending, setPending]     = useState(0)
  const [closing, setClosing]     = useState(false)
  const [criticalReport, setCriticalReport] = useState(null)

  const loadPatient = useCallback(async () => {
    try {
      const { data } = await fhirAPI.getPatient(id)
      setPatient(data)
      setPending(data.pending_reports ?? 0)
    } catch(e) {
      if (e.response?.status === 404) navigate('/dashboard')
    } finally { setLoading(false) }
  }, [id, navigate])

  useEffect(()=>{loadPatient()},[loadPatient])

  const handleClose = async () => {
    setClosing(true)
    try {
      await fhirAPI.canClose(id)
      navigate('/dashboard')
    } catch(e) {
      if (e.response?.status === 409) {
        alert(`⛔ No puede cerrar el paciente.\n${e.response.data?.detail?.message||'Hay reportes pendientes de firma.'}`)
        setActiveTab('Reportes')
      }
    } finally { setClosing(false) }
  }

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',color:'var(--text-tertiary)'}}>
      Cargando ficha clínica…
    </div>
  )
  if (!patient) return null

  const initials = patient.name?.split(' ').map(w=>w[0]).slice(0,2).join('')||'?'
  const isAdmin = user?.role === 'ADMIN'

  const visibleTabs = TABS.filter(t=>{
    if (user?.role==='PACIENTE') return ['Datos','Observaciones','Reportes'].includes(t)
    if (isAdmin) return ['Datos','Observaciones','Imágenes','Reportes'].includes(t)
    return true
  })

  return (
    <div className="patient-detail">
      {criticalReport&&(
        <CriticalModal report={criticalReport} onClose={()=>{setCriticalReport(null);loadPatient()}}/>
      )}

      {pending>0&&!isAdmin&&(
        <div className="pending-banner">
          <span>⚠️</span>
          <span>Hay {pending} RiskReport{pending>1?'s':''} pendiente{pending>1?'s':''} de firma. Debe firmar antes de cerrar.</span>
          <button className="btn btn-sm" style={{marginLeft:'auto',background:'var(--danger)',color:'#fff',border:'none'}}
            onClick={()=>setActiveTab('Reportes')}>Ir a Reportes →</button>
        </div>
      )}

      <div className="patient-header">
        <div className="patient-avatar">{initials}</div>
        <div className="patient-info">
          <h2>{patient.name}</h2>
          <div className="patient-meta">
            <span>{calcAge(patient.birthDate)} años</span>
            <span style={{color:'var(--border-soft)'}}>·</span>
            <code style={{fontSize:'0.75rem'}}>{patient.id?.slice(0,16)}…</code>
            <span style={{color:'var(--border-soft)'}}>·</span>
            <span className={`badge ${patient.active!==false?'badge-success':'badge-warning'}`}>
              {patient.active!==false?'Activo':'Inactivo'}
            </span>
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:'0.75rem',alignItems:'center'}}>
          <button className="btn btn-ghost" onClick={()=>navigate('/dashboard')}>← Volver</button>
          {user?.role==='MEDICO'&&(
            <button className="btn btn-primary" disabled={closing||pending>0}
              title={pending>0?'Debe firmar todos los reportes primero':''}
              onClick={handleClose} style={{opacity:pending>0?0.5:1}}>
              {closing?'Verificando…':'✓ Cerrar paciente'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'0.25rem',borderBottom:'1px solid var(--border-subtle)'}}>
        {visibleTabs.map(t=>(
          <button key={t} onClick={()=>setActiveTab(t)} style={{
            padding:'0.625rem 1rem',background:'none',border:'none',
            borderBottom:activeTab===t?'2px solid var(--cyan)':'2px solid transparent',
            color:activeTab===t?'var(--cyan)':'var(--text-secondary)',
            fontFamily:'var(--font-mono)',fontSize:'0.8rem',letterSpacing:'0.05em',
            textTransform:'uppercase',cursor:'pointer',transition:'all 0.15s',marginBottom:'-1px',
          }}>
            {t}
            {t==='Reportes'&&pending>0&&(
              <span style={{marginLeft:6,background:'var(--danger)',color:'#fff',
                borderRadius:10,padding:'1px 6px',fontSize:'0.65rem',fontWeight:700}}>
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab==='Datos'        &&<TabDatos patient={patient} role={user?.role}/>}
      {activeTab==='Observaciones'&&<TabObservaciones patientId={id} role={user?.role}/>}
      {activeTab==='Imágenes'     &&<TabImagenes patientId={id} role={user?.role}/>}
      {activeTab==='Análisis IA'  &&<TabAnalisis patientId={id} onCritical={rep=>setCriticalReport(rep)}/>}
      {activeTab==='Reportes'     &&<TabReportes patientId={id} role={user?.role} onRefreshPending={loadPatient}/>}
    </div>
  )
}

// ── Export modal también para uso en dashboard ────────────────────────────────
export { CreatePatientModal }