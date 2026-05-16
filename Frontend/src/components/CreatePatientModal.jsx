// frontend/src/components/CreatePatientModal.jsx
// Modal para que el médico cree un paciente completo con todas sus observaciones.
// Al crear exitosamente muestra las credenciales del usuario PACIENTE generado.

import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const LOINC_FIELDS = [
  { loinc: "2339-0",  name: "Glucosa",          unit: "mg/dL",   min: 50,  max: 500, placeholder: "ej. 120" },
  { loinc: "55284-4", name: "Presión arterial",  unit: "mmHg",    min: 40,  max: 200, placeholder: "ej. 80" },
  { loinc: "39156-5", name: "BMI",               unit: "kg/m2",   min: 10,  max: 70,  placeholder: "ej. 28.5" },
  { loinc: "14749-6", name: "Insulina",          unit: "uU/mL",   min: 0,   max: 800, placeholder: "ej. 80" },
  { loinc: "21612-7", name: "Edad",              unit: "a",       min: 1,   max: 120, placeholder: "ej. 35" },
  { loinc: "11996-6", name: "Embarazos",         unit: "{count}", min: 0,   max: 20,  placeholder: "ej. 2" },
  { loinc: "39106-0", name: "Grosor de piel",    unit: "mm",      min: 0,   max: 100, placeholder: "ej. 23" },
  { loinc: "33914-3", name: "Pedigree diabetes", unit: "{score}", min: 0,   max: 3,   placeholder: "ej. 0.627" },
];

// ── Pantalla de credenciales (igual al modal de admin) ────────────────────────
function CredentialsScreen({ patient, onClose }) {
  const u = patient.patient_user;
  const [copied, setCopied] = useState(null);

  const copy = (value, field) => {
    navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, maxWidth: 480 }}>
        <div style={styles.header}>
          <h2 style={styles.title}>Paciente creado</h2>
        </div>

        <div style={styles.body}>
          {/* Banner éxito */}
          <div style={styles.successBanner}>
            ✅ <strong>Paciente y usuario creados exitosamente</strong>
          </div>

          {/* Info del paciente */}
          <div style={styles.infoBox}>
            <div style={styles.infoRow}><span style={styles.infoLabel}>Paciente</span><span>{patient.name}</span></div>
            <div style={styles.infoRow}><span style={styles.infoLabel}>Usuario</span><span style={{ color: "#06b6d4" }}>{u.username}</span></div>
            <div style={styles.infoRow}><span style={styles.infoLabel}>Rol</span><span>{u.role}</span></div>
          </div>

          {/* Aviso claves */}
          <div style={styles.warningBox}>
            🔑 <strong>Guarda estas claves — no se volverán a mostrar</strong>
          </div>

          {/* Claves */}
          {[
            { label: "X-Access-Key", value: u.access_key },
            { label: "X-Permission-Key", value: u.permission_key },
          ].map(({ label, value }) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={styles.infoLabel}>{label}</div>
              <div style={styles.keyRow}>
                <code style={styles.keyCode}>{value}</code>
                <button
                  style={styles.copyBtn}
                  onClick={() => copy(value, label)}
                >
                  {copied === label ? "✓" : "Copiar"}
                </button>
              </div>
            </div>
          ))}

          <p style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
            El paciente usa estas claves para iniciar sesión en el sistema.
          </p>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.submitBtn}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────────────────────
export default function CreatePatientModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", birth_date: "", identification_doc: "" });
  const [observations, setObservations] = useState(
    Object.fromEntries(LOINC_FIELDS.map((f) => [f.loinc, ""]))
  );
  const [errors, setErrors]       = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError]   = useState(null);
  const [createdPatient, setCreatedPatient] = useState(null); // ← credenciales

  function setField(key, val) {
    setForm((p) => ({ ...p, [key]: val }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function setObs(loinc, val) {
    setObservations((p) => ({ ...p, [loinc]: val }));
  }

  function validate() {
    const errs = {};
    if (!form.name.trim()) errs.name = "Nombre requerido";
    if (!form.birth_date) errs.birth_date = "Fecha de nacimiento requerida";
    if (!form.identification_doc.trim()) errs.identification_doc = "Documento requerido";
    if (!observations["2339-0"]) errs.glucose = "Glucosa es requerida para el análisis ML";
    return errs;
  }

  async function handleSubmit() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    setApiError(null);

    const obs = LOINC_FIELDS
      .filter((f) => observations[f.loinc] !== "")
      .map((f) => ({ loinc_code: f.loinc, value: parseFloat(observations[f.loinc]), unit: f.unit }))
      .filter((o) => !isNaN(o.value));

    try {
      const r = await fetch(`${API}/fhir/Patient/full`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: form.name.trim(),
          birth_date: form.birth_date,
          identification_doc: form.identification_doc.trim(),
          observations: obs,
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || `Error ${r.status}`);
      }
      const patient = await r.json();
      onCreated && onCreated(patient);
      // Mostrar pantalla de credenciales en vez de cerrar de inmediato
      setCreatedPatient(patient);
    } catch (e) {
      setApiError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Si ya se creó, mostrar pantalla de credenciales
  if (createdPatient) {
    return (
      <CredentialsScreen
        patient={createdPatient}
        onClose={onClose}
      />
    );
  }

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Nuevo paciente</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.body}>
          {/* Datos personales */}
          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Datos personales</h3>
            <div style={styles.fieldGrid}>
              <Field label="Nombre completo *" error={errors.name}>
                <input
                  style={inputStyle(errors.name)}
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="Ej. María García López"
                />
              </Field>

              <Field label="Fecha de nacimiento *" error={errors.birth_date}>
                <input
                  type="date"
                  style={inputStyle(errors.birth_date)}
                  value={form.birth_date}
                  onChange={(e) => setField("birth_date", e.target.value)}
                />
              </Field>

              <Field
                label="Documento de identidad *"
                error={errors.identification_doc}
                hint="Se cifrará con AES-256"
              >
                <input
                  style={inputStyle(errors.identification_doc)}
                  value={form.identification_doc}
                  onChange={(e) => setField("identification_doc", e.target.value)}
                  placeholder="Número de cédula"
                />
              </Field>
            </div>
          </section>

          {/* Nota sobre usuario automático */}
          <div style={styles.infoNote}>
            👤 Se creará automáticamente un usuario con rol <strong>PACIENTE</strong> para
            que el paciente pueda acceder al sistema con sus credenciales.
          </div>

          {/* Observaciones clínicas LOINC */}
          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>
              Observaciones clínicas
              <span style={styles.loincTag}>LOINC</span>
            </h3>
            <p style={styles.hint}>
              Complete los valores de laboratorio. Al menos Glucosa es requerida para el análisis ML.
            </p>
            {errors.glucose && <p style={styles.fieldError}>{errors.glucose}</p>}
            <div style={styles.obsGrid}>
              {LOINC_FIELDS.map((f) => (
                <div key={f.loinc} style={styles.obsField}>
                  <label style={styles.obsLabel}>
                    {f.name}
                    <span style={styles.unit}>{f.unit}</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min={f.min}
                    max={f.max}
                    style={styles.obsInput}
                    value={observations[f.loinc]}
                    onChange={(e) => setObs(f.loinc, e.target.value)}
                    placeholder={f.placeholder}
                  />
                  <span style={styles.loincCode}>{f.loinc}</span>
                </div>
              ))}
            </div>
          </section>

          {apiError && (
            <div style={styles.apiError}>
              <strong>Error:</strong> {apiError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelBtn} disabled={submitting}>
            Cancelar
          </button>
          <button onClick={handleSubmit} style={styles.submitBtn} disabled={submitting}>
            {submitting ? "Creando..." : "✅ Crear paciente"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponente Field ───────────────────────────────────────────────────────
function Field({ label, error, hint, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label style={styles.label}>{label}</label>
      {children}
      {hint && <p style={styles.hint}>{hint}</p>}
      {error && <p style={styles.fieldError}>{error}</p>}
    </div>
  );
}

function inputStyle(hasError) {
  return {
    width: "100%", background: "#1e293b",
    border: `1px solid ${hasError ? "#ef4444" : "#334155"}`,
    borderRadius: 8, padding: "9px 12px", color: "#e2e8f0",
    fontSize: 14, outline: "none", boxSizing: "border-box",
  };
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 16,
  },
  modal: {
    background: "#0f172a", borderRadius: 14, width: "100%",
    maxWidth: 700, maxHeight: "90vh", display: "flex",
    flexDirection: "column", border: "1px solid #1e3a5f",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "20px 24px 16px", borderBottom: "1px solid #1e293b",
  },
  title: { margin: 0, color: "#e2e8f0", fontSize: 18, fontWeight: 600 },
  closeBtn: {
    background: "none", border: "none", color: "#94a3b8",
    fontSize: 18, cursor: "pointer", padding: 4,
  },
  body: { flex: 1, overflowY: "auto", padding: "20px 24px" },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: "#e2e8f0", fontSize: 15, fontWeight: 600,
    margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8,
  },
  loincTag: {
    fontSize: 10, background: "#0e3a4a", color: "#06b6d4",
    padding: "2px 8px", borderRadius: 10, fontWeight: 600,
  },
  fieldGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" },
  label: { display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 500, marginBottom: 5 },
  hint: { fontSize: 11, color: "#64748b", margin: "3px 0 0" },
  fieldError: { fontSize: 12, color: "#ef4444", margin: "3px 0 0" },
  obsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  obsField: { display: "flex", flexDirection: "column", gap: 3 },
  obsLabel: {
    fontSize: 12, color: "#94a3b8", fontWeight: 500,
    display: "flex", justifyContent: "space-between",
  },
  unit: { color: "#64748b", fontSize: 11 },
  obsInput: {
    background: "#1e293b", border: "1px solid #334155",
    borderRadius: 8, padding: "7px 10px", color: "#e2e8f0",
    fontSize: 14, outline: "none",
  },
  loincCode: { fontSize: 10, color: "#475569" },
  apiError: {
    background: "#450a0a", color: "#fca5a5", borderRadius: 8,
    padding: "10px 14px", fontSize: 13, marginTop: 8,
  },
  infoNote: {
    background: "#0e2a3a", color: "#7dd3fc", borderRadius: 8,
    padding: "10px 14px", fontSize: 13, marginBottom: 20,
    border: "1px solid #0369a1",
  },
  footer: {
    display: "flex", justifyContent: "flex-end", gap: 10,
    padding: "16px 24px", borderTop: "1px solid #1e293b",
  },
  cancelBtn: {
    background: "#334155", color: "#e2e8f0", border: "none",
    padding: "9px 20px", borderRadius: 8, cursor: "pointer", fontSize: 14,
  },
  submitBtn: {
    background: "#06b6d4", color: "#000", border: "none",
    padding: "9px 24px", borderRadius: 8, cursor: "pointer",
    fontWeight: 600, fontSize: 14,
  },
  // Pantalla de credenciales
  successBanner: {
    background: "#052e16", color: "#86efac", borderRadius: 8,
    padding: "10px 14px", fontSize: 14, marginBottom: 16,
    border: "1px solid #166534",
  },
  warningBox: {
    background: "#1c1007", color: "#fbbf24", borderRadius: 8,
    padding: "10px 14px", fontSize: 13, marginBottom: 16,
    border: "1px solid #92400e",
  },
  infoBox: {
    background: "#0f172a", borderRadius: 8, padding: "12px 14px",
    marginBottom: 16, border: "1px solid #1e293b",
  },
  infoRow: {
    display: "flex", justifyContent: "space-between",
    padding: "4px 0", fontSize: 14, color: "#e2e8f0",
  },
  infoLabel: { color: "#64748b", fontSize: 12, marginBottom: 4 },
  keyRow: {
    display: "flex", alignItems: "center", gap: 8,
    background: "#1e293b", borderRadius: 8, padding: "8px 12px",
  },
  keyCode: {
    flex: 1, color: "#06b6d4", fontFamily: "monospace",
    fontSize: 13, wordBreak: "break-all",
  },
  copyBtn: {
    background: "#334155", color: "#e2e8f0", border: "none",
    padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
    whiteSpace: "nowrap",
  },
};