import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

const LOINC_LABELS = {
  '2339-0':  { label: 'Glucosa',    unit: 'mg/dL',  danger_hi: 500 },
  '55284-4': { label: 'Presión',    unit: 'mmHg',   danger_hi: 180 },
  '39156-5': { label: 'BMI',        unit: 'kg/m²',  danger_hi: 50  },
  '14749-6': { label: 'Insulina',   unit: 'uU/mL',  danger_hi: 300 },
  '21612-7': { label: 'Edad',       unit: 'años',   danger_hi: null },
  '11996-6': { label: 'Embarazos',  unit: '',        danger_hi: null },
  '39106-0': { label: 'Pliegue',    unit: 'mm',     danger_hi: null },
  '33914-3': { label: 'Pedigrí DM', unit: '',        danger_hi: null },
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-md)',
      padding: '0.75rem',
      fontSize: '0.8125rem',
      fontFamily: 'var(--font-mono)',
    }}>
      <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.label}</p>
      <p style={{ color: d.isOutlier ? 'var(--danger)' : 'var(--cyan)' }}>
        {d.value} {d.unit}
        {d.isOutlier && ' ⚠ OUTLIER'}
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.6875rem' }}>LOINC: {d.loinc}</p>
    </div>
  )
}

export default function ObservationsChart({ observations }) {
  // Deduplicate — take most recent per LOINC code
  const seen = new Set()
  const data = observations
    .filter(o => {
      if (seen.has(o.code?.coding?.[0]?.code)) return false
      seen.add(o.code?.coding?.[0]?.code)
      return true
    })
    .map(o => {
      const loinc = o.code?.coding?.[0]?.code || ''
      const meta  = LOINC_LABELS[loinc] || { label: loinc, unit: o.valueQuantity?.unit || '' }
      const value = o.valueQuantity?.value || 0
      const isOutlier = meta.danger_hi != null && value > meta.danger_hi
      return { loinc, label: meta.label, value, unit: meta.unit, isOutlier }
    })
    .filter(d => d.value > 0)
    .sort((a, b) => a.label.localeCompare(b.label))

  if (data.length === 0) return (
    <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
      Sin observaciones registradas
    </p>
  )

  return (
    <div>
      {/* Outlier warnings */}
      {data.filter(d => d.isOutlier).map(d => (
        <div key={d.loinc} style={{
          background: 'var(--critical-dim)',
          border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.4rem 0.875rem',
          marginBottom: '0.5rem',
          fontSize: '0.8125rem',
          color: 'var(--danger)',
          fontFamily: 'var(--font-mono)',
        }}>
          ⚠ Valor extremo — {d.label}: {d.value} {d.unit}
        </div>
      ))}

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-tertiary)', fontSize: 11,
                    fontFamily: 'var(--font-mono)' }}
            angle={-30}
            textAnchor="end"
            interval={0}
          />
          <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} width={40} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="value" radius={[4,4,0,0]}>
            {data.map((d, i) => (
              <Cell key={i}
                fill={d.isOutlier ? 'var(--danger)' : 'var(--cyan)'}
                opacity={d.isOutlier ? 1 : 0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem',
        fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--cyan)' }}>■ Normal</span>
        <span style={{ color: 'var(--danger)' }}>■ Valor extremo</span>
      </div>
    </div>
  )
}
