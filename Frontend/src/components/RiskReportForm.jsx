import { useState } from 'react'
import { fhirAPI } from '../services/api'
import toast from 'react-hot-toast'

export default function RiskReportForm({ report, onSigned }) {
  const [action,   setAction]   = useState('')
  const [notes,    setNotes]    = useState('')
  const [reason,   setReason]   = useState('')
  const [loading,  setLoading]  = useState(false)

  if (!report || report.signed_at) return null

  const canSubmit =
    action &&
    notes.length >= 30 &&
    (action === 'ACCEPTED' || reason.length >= 20)

  const handleSign = async () => {
    setLoading(true)
    try {
      await fhirAPI.signReport(report.id, {
        action,
        doctor_notes: notes,
        rejection_reason: action === 'REJECTED' ? reason : undefined,
      })
      toast.success('RiskReport firmado correctamente')
      onSigned?.()
    } catch (e) {
      const detail = e.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : 'Error al firmar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-active)',
      borderRadius: 'var(--radius-lg)',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.125rem',
    }}>
      <div>
        <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '0.25rem' }}>
          Firma del RiskReport
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
          Campo obligatorio — el paciente no puede cerrarse sin firma
        </p>
      </div>

      {/* Risk summary */}
      <div style={{
        background: 'var(--bg-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem',
        display: 'flex',
        gap: '1.5rem',
        flexWrap: 'wrap',
      }}>
        <div>
          <span className="label">Modelo</span>
          <span className="mono">{report.method || '—'}</span>
        </div>
        <div>
          <span className="label">Score</span>
          <span className="mono" style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>
            {report.prediction?.[0]?.probabilityDecimal?.toFixed(4) ?? '—'}
          </span>
        </div>
        <div>
          <span className="label">Categoría</span>
          <span className={`badge badge-${report.prediction?.[0]?.qualitativeRisk?.coding?.[0]?.display?.toLowerCase() || 'low'}`}>
            {report.prediction?.[0]?.qualitativeRisk?.coding?.[0]?.display || '—'}
          </span>
        </div>
      </div>

      {/* Observations (mandatory ≥ 30 chars) */}
      <div>
        <label className="label" htmlFor="doctor-notes">
          Observaciones clínicas — mínimo 30 caracteres
          <span style={{ color: notes.length >= 30 ? 'var(--success)' : 'var(--danger)', marginLeft: '0.5rem' }}>
            {notes.length}/30
          </span>
        </label>
        <textarea
          id="doctor-notes"
          className="input"
          rows={3}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Describe los hallazgos clínicos relevantes para este resultado de IA..."
          aria-required="true"
          aria-describedby="notes-hint"
          style={{ resize: 'vertical', minHeight: 80 }}
        />
        {notes.length > 0 && notes.length < 30 && (
          <p id="notes-hint" style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.25rem' }}>
            Faltan {30 - notes.length} caracteres
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          className={`btn btn-success ${action === 'ACCEPTED' ? 'active-action' : ''}`}
          onClick={() => setAction('ACCEPTED')}
          style={{ flex: 1, justifyContent: 'center',
            boxShadow: action === 'ACCEPTED' ? '0 0 16px rgba(16,212,138,0.3)' : 'none' }}
          type="button"
        >
          ✅ Aceptar diagnóstico
        </button>
        <button
          className={`btn btn-danger ${action === 'REJECTED' ? 'active-action' : ''}`}
          onClick={() => setAction('REJECTED')}
          style={{ flex: 1, justifyContent: 'center',
            boxShadow: action === 'REJECTED' ? '0 0 16px rgba(239,68,68,0.3)' : 'none' }}
          type="button"
        >
          ❌ Rechazar diagnóstico
        </button>
      </div>

      {/* Rejection reason */}
      {action === 'REJECTED' && (
        <div>
          <label className="label" htmlFor="rejection-reason">
            Justificación del rechazo — mínimo 20 caracteres
            <span style={{ color: reason.length >= 20 ? 'var(--success)' : 'var(--danger)', marginLeft: '0.5rem' }}>
              {reason.length}/20
            </span>
          </label>
          <textarea
            id="rejection-reason"
            className="input"
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Motivo clínico del rechazo..."
            aria-required="true"
            style={{ resize: 'vertical' }}
          />
        </div>
      )}

      {/* Submit */}
      <button
        className="btn btn-primary"
        onClick={handleSign}
        disabled={!canSubmit || loading}
        style={{ alignSelf: 'flex-end' }}
        aria-label="Confirmar firma del RiskReport"
      >
        {loading
          ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Firmando…</>
          : '✍ Confirmar firma'
        }
      </button>
    </div>
  )
}
