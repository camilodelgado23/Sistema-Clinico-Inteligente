import { useState, useRef, useEffect } from 'react'
import { ragAPI, authAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import './AgentView.css'

function stripMarkdown(text) {
  return text
    // Entidades HTML frecuentes en respuestas del agente
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    // Markdown
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^[-*]\s+/gm, '- ')   // usar guion en vez de bullet (mejor soporte en jsPDF)
    .replace(/^\d+\.\s+/gm, (m) => m)
    // Normalizar espacios múltiples
    .replace(/ {2,}/g, ' ')
    .trim()
}

async function exportToPDF({ question, answer, sources, patientId, username }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const marginL  = 20
  const marginR  = 20
  const pageW    = 210
  const pageH    = 297
  const footerH  = 14
  const footerY  = pageH - footerH
  // Ancho efectivo reducido para dar holgura a caracteres especiales (Í, é, ó, ú, •)
  const usableW  = pageW - marginL - marginR - 6
  const lineH    = 5.8

  const now     = new Date()
  const dateStr = now.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })

  // Helper: renderiza bloque de texto con salto de página automático
  const writeLines = (lines, indent = 0) => {
    lines.forEach(line => {
      if (y + lineH > footerY) {
        addFooter()
        doc.addPage()
        y = 22
        doc.setFontSize(8.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(51, 65, 85)
      }
      doc.text(line, marginL + indent, y)
      y += lineH
    })
  }

  // Helper: pie de página en la página actual
  const addFooter = () => {
    const p = doc.getNumberOfPages()
    doc.setPage(p)
    doc.setFillColor(241, 245, 249)
    doc.rect(0, pageH - footerH, pageW, footerH, 'F')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.setFont('helvetica', 'italic')
    doc.text(
      'Documento de apoyo clinico - No reemplaza el criterio medico. Res. 1995/1999 | Ley 1581/2012',
      pageW / 2, pageH - 5.5, { align: 'center' }
    )
    doc.setFont('helvetica', 'normal')
    doc.text(`Pag. ${p}`, pageW - marginR, pageH - 5.5, { align: 'right' })
  }

  // ── Cabecera ──────────────────────────────────────────────────────────────
  doc.setFillColor(30, 41, 59)
  doc.rect(0, 0, pageW, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('SISTEMA CLINICO INTELIGENTE', marginL, 12)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Informe de Consulta - Agente Clinico', marginL, 19)
  doc.text(`${dateStr}  ${timeStr}`, pageW - marginR, 19, { align: 'right' })

  let y = 38

  // ── Metadatos ─────────────────────────────────────────────────────────────
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text('Medico:', marginL, y)
  doc.setFont('helvetica', 'normal')
  doc.text(username || 'Sin identificar', marginL + 20, y)

  if (patientId) {
    y += 6
    doc.setFont('helvetica', 'bold')
    doc.text('Paciente ID:', marginL, y)
    doc.setFont('helvetica', 'normal')
    doc.text(patientId, marginL + 28, y)
  }

  // Línea separadora
  y += 8
  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(0.3)
  doc.line(marginL, y, pageW - marginR, y)
  y += 8

  // ── Pregunta ──────────────────────────────────────────────────────────────
  doc.setFillColor(241, 245, 249)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  const questionLines = doc.splitTextToSize(`Consulta: ${question}`, usableW - 2)
  const questionH = questionLines.length * lineH + 5
  doc.roundedRect(marginL, y, usableW + 6, questionH, 2, 2, 'F')
  questionLines.forEach((line, i) => {
    doc.text(line, marginL + 3, y + lineH + i * lineH)
  })
  y += questionH + 7

  // ── Respuesta ─────────────────────────────────────────────────────────────
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text('Respuesta del Agente Clinico', marginL, y)
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(51, 65, 85)
  const plain    = stripMarkdown(answer)
  const ansLines = doc.splitTextToSize(plain, usableW)
  writeLines(ansLines)

  // ── Fuentes RAG ───────────────────────────────────────────────────────────
  if (sources?.length > 0) {
    y += 4
    if (y + 10 > footerY) { addFooter(); doc.addPage(); y = 22 }
    doc.setDrawColor(148, 163, 184)
    doc.line(marginL, y, pageW - marginR, y)
    y += 6
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('Fuentes de conocimiento clinico (RAG):', marginL, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    sources.forEach(s => {
      const sLines = doc.splitTextToSize(`- ${s}`, usableW)
      writeLines(sLines, 2)
    })
  }

  // ── Pie de página en todas las páginas ────────────────────────────────────
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFillColor(241, 245, 249)
    doc.rect(0, pageH - footerH, pageW, footerH, 'F')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.setFont('helvetica', 'italic')
    doc.text(
      'Documento de apoyo clinico - No reemplaza el criterio medico. Res. 1995/1999 | Ley 1581/2012',
      pageW / 2, pageH - 5.5, { align: 'center' }
    )
    doc.setFont('helvetica', 'normal')
    doc.text(`Pag. ${p} / ${totalPages}`, pageW - marginR, pageH - 5.5, { align: 'right' })
  }

  const filename = `consulta_clinica_${now.toISOString().slice(0, 10)}_${now.getHours()}h${now.getMinutes()}m.pdf`
  doc.save(filename)
}

function renderMarkdown(text) {
  if (!text) return ''
  const lines = text.split('\n')
  let html = ''
  let inList = false

  for (let line of lines) {
    const listMatch = line.match(/^(\s*[-*]|\s*\d+\.)\s+(.*)/)
    if (listMatch) {
      if (!inList) { html += '<ul style="margin:0.4rem 0 0.4rem 1.2rem;padding:0">'; inList = true }
      html += `<li>${formatInline(listMatch[2])}</li>`
    } else {
      if (inList) { html += '</ul>'; inList = false }
      if (line.trim() === '') {
        html += '<br>'
      } else {
        html += `<p style="margin:0.2rem 0">${formatInline(line)}</p>`
      }
    }
  }
  if (inList) html += '</ul>'
  return html
}

function formatInline(text) {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.08);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em">$1</code>')
}

const RAG_MODES = [
  { value: 'hybrid',  label: 'Hybrid RAG',   desc: 'BM25 + Dense (recomendado)' },
  { value: 'naive',   label: 'Naive RAG',    desc: 'Solo dense retrieval' },
  { value: 'rerank',  label: 'Advanced RAG', desc: 'Hybrid + reranking' },
  { value: 'agentic', label: 'Agentic RAG',  desc: 'ReAct + tool calling' },
]

function Message({ msg, onExport }) {
  const isUser = msg.role === 'user'
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try { await onExport(msg) } finally { setExporting(false) }
  }

  return (
    <div className={`msg ${isUser ? 'msg--user' : 'msg--agent'}`}>
      <div className="msg-avatar">
        {isUser ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>
        )}
      </div>
      <div className="msg-content">
        <div className="msg-text" dangerouslySetInnerHTML={{ __html: isUser ? msg.content : renderMarkdown(msg.content) }} />
        {msg.sources?.length > 0 && (
          <div className="msg-sources">
            <span className="sources-label">Fuentes RAG:</span>
            {msg.sources.map(s => (
              <span key={s} className="source-chip">{s}</span>
            ))}
          </div>
        )}
        <div className="msg-meta" style={{display:'flex',gap:'0.4rem',alignItems:'center',flexWrap:'wrap'}}>
          {msg.rag_mode && (
            <>
              <span className="badge badge-purple" style={{fontSize:'0.6rem'}}>
                {RAG_MODES.find(m => m.value === msg.rag_mode)?.label || msg.rag_mode}
              </span>
              {msg.elapsed != null && (
                <span style={{fontSize:'0.6rem',color:'var(--text-4)'}}>
                  {(msg.elapsed / 1000).toFixed(1)}s
                </span>
              )}
            </>
          )}
          {!isUser && onExport && (
            <button
              onClick={handleExport}
              disabled={exporting}
              title="Exportar como PDF"
              style={{
                marginLeft:'auto',display:'flex',alignItems:'center',gap:'0.3rem',
                background:'none',border:'1px solid rgba(255,255,255,0.12)',
                borderRadius:'4px',cursor:'pointer',padding:'0.2rem 0.5rem',
                color:'var(--text-3)',fontSize:'0.62rem',
                transition:'border-color 0.15s,color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='var(--cyan)'; e.currentTarget.style.color='var(--cyan)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.12)'; e.currentTarget.style.color='var(--text-3)' }}
            >
              {exporting ? (
                <div className="spinner" style={{width:9,height:9}} />
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              )}
              {exporting ? 'Generando…' : 'Exportar PDF'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const SUGGESTED = [
  '¿Cuáles son los criterios diagnósticos de diabetes mellitus tipo 2?',
  '¿Cómo interpretar un resultado de glucosa de 180 mg/dL?',
  '¿Qué indica retinopatía diabética severa según el modelo APTOS?',
  '¿Cuáles son los objetivos de HbA1c en adultos mayores?',
  '¿Qué tratamiento se recomienda para RDNP moderada con EMD?',
]

const RAGAS_LABELS = {
  faithfulness:      { label: 'Faithfulness',      color: '#a78bfa', min: 0.75 },
  answer_relevancy:  { label: 'Answer Relevancy',  color: '#38bdf8', min: 0.70 },
  context_precision: { label: 'Context Precision', color: '#34d399', min: 0.65 },
  context_recall:    { label: 'Context Recall',    color: '#fb923c', min: 0.65 },
}

function RagasPanel({ report }) {
  const { summary, total_questions } = report || {}
  return (
    <div className="agent-sidebar-section">
      <h4 style={{ color: 'var(--text-2)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        Evaluación RAGAS
        {total_questions && (
          <span style={{ fontSize: '0.6rem', color: 'var(--text-4)', marginLeft: 'auto' }}>{total_questions}Q</span>
        )}
      </h4>

      {summary ? (
        <>
          {Object.entries(RAGAS_LABELS).map(([key, meta]) => {
            const m = summary?.[key]
            if (!m) return null
            const pct = Math.round(m.score * 100)
            const pass = m.pass
            return (
              <div key={key} style={{ marginBottom: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', marginBottom: '0.2rem' }}>
                  <span style={{ color: 'var(--text-3)' }}>{meta.label}</span>
                  <span style={{ color: pass ? meta.color : '#f87171', fontWeight: 600 }}>
                    {m.score.toFixed(3)} {pass ? '✓' : '✗'}
                  </span>
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${pct}%`,
                    background: pass ? meta.color : '#f87171',
                    transition: 'width 0.6s ease',
                  }} />
                </div>
                <div style={{ fontSize: '0.58rem', color: 'var(--text-4)', marginTop: '0.1rem' }}>
                  mín. {meta.min}
                </div>
              </div>
            )
          })}
          {summary?.faithfulness && !summary.faithfulness.pass && (
            <div className="alert alert-warning" style={{ fontSize: '0.68rem', marginTop: '0.4rem' }}>
              Faithfulness {'<'} 0.75 — penalización −10% activa
            </div>
          )}
        </>
      ) : (
        <p style={{ fontSize: '0.7rem', color: 'var(--text-4)' }}>
          Sin reporte disponible aún.
        </p>
      )}
    </div>
  )
}

export default function AgentView() {
  const { role, username, setAuth, token, userId } = useAuthStore()
  const isAdmin = role?.toUpperCase() === 'ADMIN'

  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [sessionId, setSessionId]   = useState(null)
  const [patientId, setPatientId]   = useState('')
  const [ragMode, setRagMode]       = useState('agentic')
  const [indexStatus, setIndexStatus] = useState(null)
  const [ragasReport, setRagasReport] = useState(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [elapsed, setElapsed]       = useState(0)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)
  const timerRef   = useRef(null)

  useEffect(() => {
    if (loading) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 100), 100)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [loading])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    ragAPI.indexStatus().then(d => setIndexStatus(d)).catch(() => null)
    ragAPI.ragasReport().then(d => setRagasReport(d)).catch(() => null)
  }, [])

  // Obtiene el username desde el backend si la sesión fue iniciada antes del cambio
  useEffect(() => {
    if (!username) {
      authAPI.me().then(data => {
        setAuth({ access_token: token, role: data.role, user_id: data.user_id, username: data.username, needs_habeas_data: false })
      }).catch(() => null)
    }
  }, [])

  const sendMessage = async (text) => {
    const content = (text || input).trim()
    if (!content || loading) return

    const userMsg = { role: 'user', content }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const data = await ragAPI.chat({ message: content, session_id: sessionId, patient_id: patientId || undefined, rag_mode: ragMode })
      if (!sessionId) setSessionId(data.session_id)
      setMessages(prev => [...prev, {
        role: 'agent',
        content: data.answer,
        sources: data.sources,
        rag_mode: data.rag_mode,
        elapsed,
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'agent',
        content: `Error al contactar el agente: ${e.response?.data?.detail || e.message}. Verifique que el servicio RAG esté activo.`,
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const clearSession = async () => {
    if (sessionId) {
      try { await ragAPI.clearSession(sessionId) } catch {}
    }
    setMessages([])
    setSessionId(null)
  }

  return (
    <div className="agent-layout fade-in">
      {/* Sidebar */}
      <aside className="agent-sidebar">

        {/* MÉDICO: título + descripción + ID paciente */}
        {!isAdmin && (
          <div className="agent-sidebar-section">
            <h3 style={{color:'var(--text-1)',marginBottom:'0.4rem'}}>Agente Clínico</h3>
            <p style={{fontSize:'0.72rem',color:'var(--text-3)',marginBottom:'0.875rem',lineHeight:'1.5'}}>
              Asistente inteligente especializado en diabetes y retinopatía diabética. Consulta guías clínicas, interpreta resultados de modelos ML/DL y analiza datos de sus pacientes asignados.
            </p>
            <label className="label">ID del paciente (opcional)</label>
            <input
              className="input"
              placeholder="UUID del paciente asignado…"
              value={patientId}
              onChange={e => setPatientId(e.target.value)}
            />
          </div>
        )}

        {/* ADMIN: configuración colapsable */}
        {isAdmin && (
          <div className="agent-sidebar-section">
            <button
              onClick={() => setConfigOpen(v => !v)}
              style={{
                display:'flex',alignItems:'center',justifyContent:'space-between',
                width:'100%',background:'none',border:'none',cursor:'pointer',
                padding:0,color:'var(--text-2)',
              }}
            >
              <span style={{fontSize:'0.8rem',fontWeight:600}}>Configuración del agente</span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                style={{transform: configOpen ? 'rotate(180deg)' : 'none', transition:'transform 0.2s'}}
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {configOpen && (
              <>
                <div style={{marginTop:'0.75rem'}}>
                  <label className="label">Modo RAG</label>
                  <div className="rag-modes">
                    {RAG_MODES.map(m => (
                      <button
                        key={m.value}
                        className={`rag-mode-btn ${ragMode === m.value ? 'active' : ''}`}
                        onClick={() => setRagMode(m.value)}
                      >
                        <span className="rag-mode-name">{m.label}</span>
                        <span className="rag-mode-desc">{m.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{marginTop:'0.875rem'}}>
                  <h4 style={{color:'var(--text-2)',marginBottom:'0.5rem',fontSize:'0.78rem',fontWeight:600}}>
                    Estado del índice
                  </h4>
                  {indexStatus ? (
                    <div className="index-status">
                      <div className="index-stat">
                        <span className="dot dot-low" />
                        <span>{indexStatus.chunks} chunks indexados</span>
                      </div>
                      <div className="index-stat">
                        <span className={`dot ${indexStatus.has_faiss ? 'dot-low' : 'dot-high'}`} />
                        <span>FAISS {indexStatus.has_faiss ? 'activo' : 'no disponible'}</span>
                      </div>
                      <div className="index-stat">
                        <span className={`dot ${indexStatus.has_bm25 ? 'dot-low' : 'dot-high'}`} />
                        <span>BM25 {indexStatus.has_bm25 ? 'activo' : 'no disponible'}</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{color:'var(--text-4)',fontSize:'0.75rem'}}>Verificando…</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ADMIN: dashboard RAGAS (solo lectura) */}
        {isAdmin && (
          <RagasPanel report={ragasReport} />
        )}

        {/* MÉDICO: sesión activa */}
        {!isAdmin && sessionId && (
          <div className="agent-sidebar-section">
            <div style={{display:'flex',gap:'0.5rem',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:'0.72rem',color:'var(--text-3)'}}>Sesión activa</span>
              <code style={{fontSize:'0.65rem',color:'var(--cyan)'}}>{sessionId.slice(0,8)}…</code>
            </div>
            <button className="btn btn-ghost btn-sm" style={{marginTop:'0.5rem',width:'100%'}} onClick={clearSession}>
              Nueva sesión
            </button>
          </div>
        )}

        {/* MÉDICO: aviso de uso clínico */}
        {!isAdmin && (
          <div className="agent-sidebar-section">
            <div className="alert alert-warning" style={{fontSize:'0.72rem'}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Uso clínico de apoyo. No reemplaza criterio médico.
            </div>
          </div>
        )}
      </aside>

      {/* Chat area — médicos only; admins see a notice */}
      {isAdmin ? (
        <div className="agent-chat">
          <div className="chat-header">
            <div>
              <h2 style={{color:'var(--text-1)'}}>Agente Clínico</h2>
              <p style={{fontSize:'0.75rem',color:'var(--text-3)'}}>
                Panel de administración — solo lectura
              </p>
            </div>
          </div>
          <div className="chat-messages">
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.4">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <p style={{color:'var(--text-3)',maxWidth:380,textAlign:'center',fontSize:'0.875rem'}}>
                El chat del agente es exclusivo para médicos. Como administrador puede consultar los resultados de la Evaluación RAGAS en el panel lateral.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="agent-chat">
          <div className="chat-header">
            <div>
              <h2 style={{color:'var(--text-1)'}}>Agente Clínico</h2>
              <p style={{fontSize:'0.75rem',color:'var(--text-3)'}}>
                Agentic RAG · Anti-injection activo · PII masking
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <span className="badge badge-purple">Agentic RAG</span>
              <span className="badge badge-info">Cloudflare WAF</span>
            </div>
          </div>

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                <div className="chat-empty-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.4">
                    <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
                  </svg>
                </div>
                <p style={{color:'var(--text-3)',maxWidth:360,textAlign:'center',fontSize:'0.875rem'}}>
                  Pregunta sobre diabetes, retinopatía diabética, resultados de modelos ML/DL o datos de pacientes.
                </p>
                <div className="suggested-questions">
                  {SUGGESTED.map(q => (
                    <button key={q} className="suggested-btn" onClick={() => sendMessage(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <Message
                key={i}
                msg={msg}
                onExport={msg.role === 'agent' ? (agentMsg) => exportToPDF({
                  question: messages[i - 1]?.content || '',
                  answer:   agentMsg.content,
                  sources:  agentMsg.sources,
                  patientId,
                  username,
                }) : null}
              />
            ))}

            {loading && (
              <div className="msg msg--agent">
                <div className="msg-avatar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>
                </div>
                <div className="msg-content">
                  <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
                    <div className="typing-dots"><span/><span/><span/></div>
                    <span style={{fontSize:'0.7rem',color:'var(--text-4)',fontVariantNumeric:'tabular-nums'}}>
                      {(elapsed / 1000).toFixed(1)}s
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="chat-input-area">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Consulta clínica… (Enter para enviar, Shift+Enter para nueva línea)"
              value={input}
              rows={2}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
              }}
            />
            <button
              className="btn btn-primary chat-send"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
            >
              {loading ? <div className="spinner" /> : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
