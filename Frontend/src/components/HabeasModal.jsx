import { useState } from 'react'
import { authAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import toast from 'react-hot-toast'

export default function HabeasModal({ onAccepted }) {
  const [checked, setChecked]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const { needsHabeas, setAuth, token, role, userId } = useAuthStore()

  if (!needsHabeas) return null

  const handleAccept = async () => {
    if (!checked || loading) return // 👈 IMPORTANTE

    setLoading(true)
    try {
      await authAPI.acceptHabeasData('1.0')
      useAuthStore.setState({ needsHabeas: false })
      toast.success('Consentimiento registrado')
      onAccepted?.()
    } catch (e) {
      console.error(e) // 👈 añade esto para debug
      toast.error('Error al registrar consentimiento')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(4,8,16,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-active)',
        borderRadius: 'var(--radius-xl)',
        padding: '2.5rem',
        maxWidth: '620px',
        width: '100%',
        boxShadow: '0 0 60px rgba(56,189,248,0.1)',
      }}>
        {/* Header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6875rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--cyan)',
            marginBottom: '0.5rem',
          }}>
            Ley 1581/2012 · Política de Privacidad v1.0
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem' }}>
            Autorización Tratamiento de Datos
          </h2>
        </div>

        {/* Policy text */}
        <div style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '1.25rem',
          maxHeight: '280px',
          overflowY: 'auto',
          marginBottom: '1.5rem',
          fontSize: '0.875rem',
          color: 'var(--text-secondary)',
          lineHeight: '1.7',
        }}>
          <p style={{ marginBottom: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Autorización para el Tratamiento de Datos Personales y Datos Sensibles de Salud
          </p>
          <p style={{ marginBottom: '0.875rem' }}>
            En cumplimiento de la <strong style={{ color: 'var(--text-primary)' }}>Ley Estatutaria 1581 de 2012</strong> y el 
            Decreto 1377 de 2013, usted autoriza al Sistema Clínico ClinAI a recolectar, almacenar, 
            usar, circular y suprimir sus datos personales y datos sensibles de salud para los 
            siguientes fines:
          </p>
          <ul style={{ paddingLeft: '1.25rem', marginBottom: '0.875rem' }}>
            {[
              'Prestación de servicios de apoyo diagnóstico mediante inteligencia artificial',
              'Generación de reportes de riesgo clínico (RiskAssessment FHIR R4)',
              'Análisis de imágenes médicas de retina para detección de retinopatía diabética',
              'Registro de historia clínica electrónica interoperable (Ley 2015/2020)',
              'Auditoría y trazabilidad de acciones clínicas (Resolución 1995/1999)',
            ].map((item, i) => (
              <li key={i} style={{ marginBottom: '0.375rem' }}>{item}</li>
            ))}
          </ul>
          <p style={{ marginBottom: '0.875rem' }}>
            Sus datos de salud son clasificados como <strong style={{ color: 'var(--danger)' }}>datos sensibles</strong> y 
            cuentan con protección reforzada. El sistema aplica cifrado AES-256 en reposo y 
            TLS en tránsito. Sus datos no serán cedidos a terceros sin su consentimiento expreso.
          </p>
          <p style={{ marginBottom: '0.875rem' }}>
            Usted tiene derecho a conocer, actualizar, rectificar y suprimir sus datos 
            (<strong style={{ color: 'var(--text-primary)' }}>Derechos ARCO</strong>). 
            Para ejercer estos derechos, contacte al administrador del sistema.
          </p>
          <p style={{ marginBottom: '0.875rem' }}>
            Los resultados generados por los modelos de IA son de <strong style={{ color: 'var(--warning)' }}>apoyo diagnóstico únicamente</strong> y 
            no reemplazan el criterio del profesional médico tratante.
          </p>
          <p>
            La retención mínima de datos de historia clínica es de <strong style={{ color: 'var(--text-primary)' }}>15 años</strong> conforme 
            a la Resolución 1995 de 1999 del Ministerio de Salud.
          </p>
        </div>

        {/* Checkbox */}
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
          cursor: 'pointer', marginBottom: '1.5rem',
          padding: '0.875rem',
          background: checked ? 'rgba(56,189,248,0.06)' : 'transparent',
          border: `1px solid ${checked ? 'var(--border-active)' : 'var(--border-subtle)'}`,
          borderRadius: 'var(--radius-md)',
          transition: 'all 0.2s',
        }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--cyan)', flexShrink: 0 }}
          />
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            He leído y comprendo la política de privacidad. Autorizo expresamente el tratamiento 
            de mis datos personales y datos sensibles de salud conforme a la Ley 1581/2012.
          </span>
        </label>

        {/* Action */}
        <button
          className="btn btn-primary"
          onClick={handleAccept}
          disabled={!checked || loading}
          style={{ width: '100%', justifyContent: 'center', padding: '0.75rem' }}
        >
          {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}
          {loading ? 'Registrando...' : 'Acepto y Continuar'}
        </button>

        <p style={{
          fontSize: '0.6875rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
          marginTop: '0.875rem',
          fontFamily: 'var(--font-mono)',
        }}>
          Esta ventana no puede cerrarse sin aceptar · IP y timestamp registrados
        </p>
      </div>
    </div>
  )
}
