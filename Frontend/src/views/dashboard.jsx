import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fhirAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import CreatePatientModal from '../components/CreatePatientModal'
import './dashboard.css'

const calcAge = bd =>
  bd ? Math.floor((Date.now() - new Date(bd)) / (365.25 * 24 * 3600 * 1000)) : '—'

const RISK_CONFIG = {
  LOW:      { label: 'Bajo',    dotClass: 'dot-low',      badgeClass: 'badge-low' },
  MEDIUM:   { label: 'Medio',   dotClass: 'dot-medium',   badgeClass: 'badge-medium' },
  HIGH:     { label: 'Alto',    dotClass: 'dot-high',     badgeClass: 'badge-high' },
  CRITICAL: { label: 'Crítico', dotClass: 'dot-critical', badgeClass: 'badge-critical' },
}

const FILTERS = ['Todos', 'Pendiente', 'Crítico', 'Sin análisis']

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div className="stat-card" style={{ '--accent': color }}>
      <div className="stat-card-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon" style={{ color }}>{icon}</span>
      </div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { role } = useAuthStore()

  const [patients,   setPatients]   = useState([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState('Todos')
  const [page,       setPage]       = useState(0)
  const [showCreate, setShowCreate] = useState(false)

  const LIMIT = 10

  const stats = {
    total,
    critical: patients.filter(p => p.last_risk_category === 'CRITICAL').length,
    pending:  patients.filter(p => Number(p.pending_reports) > 0).length,
    noAnalysis: patients.filter(p => !p.last_risk_category).length,
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await fhirAPI.listPatients({ limit: 100, offset: page * LIMIT })
      setTotal(data.total || 0)
      let entries = data.entry || []

      if (search.trim()) {
        const q = search.toLowerCase()
        entries = entries.filter(p =>
          p.name?.toLowerCase().includes(q) || p.id?.toLowerCase().includes(q)
        )
      }
      if (filter === 'Pendiente')    entries = entries.filter(p => Number(p.pending_reports) > 0)
      else if (filter === 'Crítico') entries = entries.filter(p => p.last_risk_category === 'CRITICAL')
      else if (filter === 'Sin análisis') entries = entries.filter(p => !p.last_risk_category)

      setPatients(entries.slice(0, LIMIT))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [page, search, filter])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="dashboard fade-in">
      {showCreate && (
        <CreatePatientModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestión de Pacientes</h1>
          <p className="page-sub">{total} pacientes registrados · FHIR R4 · HL7</p>
        </div>
        <div className="flex gap-2 items-center">
          {stats.critical > 0 && (
            <div className="alert alert-danger">
              <span className="dot dot-critical" />
              {stats.critical} alerta{stats.critical > 1 ? 's' : ''} crítica{stats.critical > 1 ? 's' : ''}
            </div>
          )}
          {role === 'MEDICO' && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Nuevo paciente
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats */}
      <div className="stats-grid">
        <StatCard
          label="Total pacientes"
          value={total}
          sub="FHIR Patient resources"
          color="var(--cyan)"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
        />
        <StatCard
          label="Alertas críticas"
          value={stats.critical}
          sub="Requieren atención inmediata"
          color={stats.critical > 0 ? 'var(--critical)' : 'var(--text-3)'}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
        />
        <StatCard
          label="Pendientes firma"
          value={stats.pending}
          sub="RiskReport sin firmar"
          color={stats.pending > 0 ? 'var(--warning)' : 'var(--text-3)'}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
        />
        <StatCard
          label="Sin análisis"
          value={stats.noAnalysis}
          sub="Sin inferencia ML/DL"
          color="var(--text-3)"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
        />
      </div>

      {/* Toolbar */}
      <div className="dashboard-toolbar">
        <div className="search-wrap">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="input search-input"
            placeholder="Buscar por nombre o ID…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
          />
        </div>
        <div className="filter-pills">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`pill ${filter === f ? 'pill--active' : ''}`}
              onClick={() => { setFilter(f); setPage(0) }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Nombre</th>
                <th>Edad</th>
                <th>ID</th>
                <th>Riesgo ML/DL</th>
                <th>Firma HC</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>
                    <div className="state-loading"><div className="spinner" /> Cargando pacientes…</div>
                  </td>
                </tr>
              ) : patients.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="state-empty">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                      No se encontraron pacientes
                    </div>
                  </td>
                </tr>
              ) : patients.map(p => {
                const risk = RISK_CONFIG[p.last_risk_category]
                const pending = Number(p.pending_reports) > 0
                return (
                  <tr key={p.id} className="table-row--clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                    <td>
                      <span className={`dot ${risk ? risk.dotClass : 'dot-none'}`} title={risk?.label || 'Sin análisis'} />
                    </td>
                    <td>
                      <span className="patient-name">{p.name || '—'}</span>
                    </td>
                    <td>
                      <span className="age-value">{calcAge(p.birth_date)}</span>
                      <span className="age-unit"> a</span>
                    </td>
                    <td>
                      <code className="patient-id">{p.id?.slice(0, 8)}…</code>
                    </td>
                    <td>
                      {risk ? (
                        <span className={`badge ${risk.badgeClass}`}>{risk.label}</span>
                      ) : (
                        <span className="no-analysis">Sin análisis</span>
                      )}
                    </td>
                    <td>
                      {pending ? (
                        <span className="pending-badge">
                          <span className="dot dot-high" style={{width:6,height:6}} />
                          Pendiente
                        </span>
                      ) : (
                        <span className="ok-badge">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          Al día
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); navigate(`/patients/${p.id}`) }}>
                        Ver →
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            ← Anterior
          </button>
          <span className="pagination-info">Página {page + 1} de {totalPages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}
