import { useState, useRef, useEffect, useCallback } from 'react'
import { ragAPI } from '../services/api'
import './AgentView.css'

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

function Message({ msg }) {
  const isUser = msg.role === 'user'
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
        {msg.rag_mode && (
          <div className="msg-meta" style={{display:'flex',gap:'0.4rem',alignItems:'center'}}>
            <span className="badge badge-purple" style={{fontSize:'0.6rem'}}>
              {RAG_MODES.find(m => m.value === msg.rag_mode)?.label || msg.rag_mode}
            </span>
            {msg.elapsed != null && (
              <span style={{fontSize:'0.6rem',color:'var(--text-4)'}}>
                {(msg.elapsed / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )}
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

function RagasPanel({ report, onRun, running }) {
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
        <p style={{ fontSize: '0.7rem', color: 'var(--text-4)', marginBottom: '0.5rem' }}>
          Sin reporte disponible. Ejecute la evaluación.
        </p>
      )}

      <button
        className="btn btn-ghost btn-sm"
        style={{ width: '100%', marginTop: '0.4rem', fontSize: '0.68rem' }}
        onClick={onRun}
        disabled={running}
      >
        {running ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
            <div className="spinner" style={{ width: 10, height: 10 }} /> Evaluando…
          </span>
        ) : (
          summary ? 'Re-evaluar RAGAS' : 'Ejecutar evaluación RAGAS'
        )}
      </button>
    </div>
  )
}

export default function AgentView() {
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [sessionId, setSessionId]   = useState(null)
  const [patientId, setPatientId]   = useState('')
  const [ragMode, setRagMode]       = useState('hybrid')
  const [indexStatus, setIndexStatus] = useState(null)
  const [ragasReport, setRagasReport] = useState(null)
  const [ragasRunning, setRagasRunning] = useState(false)
  const [elapsed, setElapsed]       = useState(0)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)
  const timerRef   = useRef(null)
  const ragasPoll  = useRef(null)

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

  const runRagas = async () => {
    try {
      await ragAPI.ragasRun()
      setRagasRunning(true)
      ragasPoll.current = setInterval(async () => {
        try {
          const st = await ragAPI.ragasStatus()
          if (!st.running) {
            clearInterval(ragasPoll.current)
            setRagasRunning(false)
            const rep = await ragAPI.ragasReport()
            setRagasReport(rep)
          }
        } catch {}
      }, 8000)
    } catch (e) {
      if (e.response?.status === 409) alert('Ya hay una evaluación en curso.')
    }
  }

  useEffect(() => () => clearInterval(ragasPoll.current), [])

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
      {/* Sidebar config */}
      <aside className="agent-sidebar">
        <div className="agent-sidebar-section">
          <h3 style={{color:'var(--text-1)',marginBottom:'0.75rem'}}>Configuración RAG</h3>

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

          <label className="label" style={{marginTop:'1rem'}}>Patient ID (opcional)</label>
          <input
            className="input"
            placeholder="UUID del paciente…"
            value={patientId}
            onChange={e => setPatientId(e.target.value)}
          />
          <p style={{fontSize:'0.7rem',color:'var(--text-4)',marginTop:'0.375rem'}}>
            Habilita acceso a datos FHIR y memoria de largo plazo
          </p>
        </div>

        <div className="agent-sidebar-section">
          <h4 style={{color:'var(--text-2)',marginBottom:'0.625rem'}}>Estado del índice</h4>
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

        {sessionId && (
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

        <RagasPanel report={ragasReport} onRun={runRagas} running={ragasRunning} />

        <div className="agent-sidebar-section">
          <div className="alert alert-warning" style={{fontSize:'0.72rem'}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Uso clínico de apoyo. No reemplaza criterio médico.
          </div>
        </div>
      </aside>

      {/* Chat area */}
      <div className="agent-chat">
        <div className="chat-header">
          <div>
            <h2 style={{color:'var(--text-1)'}}>Agente RAG Clínico</h2>
            <p style={{fontSize:'0.75rem',color:'var(--text-3)'}}>
              FAISS + BM25 híbrido · Anti-injection activo · PII masking
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <span className="badge badge-purple">{RAG_MODES.find(m => m.value === ragMode)?.label}</span>
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

          {messages.map((msg, i) => <Message key={i} msg={msg} />)}

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
    </div>
  )
}
