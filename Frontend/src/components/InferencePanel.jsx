// frontend/src/components/InferencePanel.jsx
// Reemplaza tu componente de análisis IA con este.
// Corrige el polling, muestra SHAP/Grad-CAM y maneja alertas críticas.

import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ── Mapeo LOINC → nombre legible ──────────────────────────────────────────────
const LOINC_NAMES = {
  "2339-0":  "Glucosa",
  "55284-4": "Presión arterial",
  "39156-5": "BMI",
  "14749-6": "Insulina",
  "21612-7": "Edad",
  "11996-6": "Embarazos",
  "39106-0": "Grosor piel",
  "33914-3": "Pedigree diabetes",
};

const RISK_COLORS = {
  LOW:      { bg: "#14532d", text: "#86efac", label: "BAJO" },
  MEDIUM:   { bg: "#713f12", text: "#fde68a", label: "MEDIO" },
  HIGH:     { bg: "#7c2d12", text: "#fdba74", label: "ALTO" },
  CRITICAL: { bg: "#450a0a", text: "#fca5a5", label: "CRÍTICO" },
};

export default function InferencePanel({ patientId, onNewReport }) {
  const [modelType, setModelType]     = useState("ML");
  const [taskId, setTaskId]           = useState(null);
  const [status, setStatus]           = useState(null);  // PENDING|RUNNING|DONE|ERROR
  const [result, setResult]           = useState(null);
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState(null);
  const [criticalAlert, setCriticalAlert] = useState(false);
  const pollingRef = useRef(null);
  const wsRef = useRef(null);

  // ── Limpiar al desmontar ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(pollingRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // ── Ejecutar análisis ─────────────────────────────────────────────────────
  async function runInference() {
    setRunning(true);
    setError(null);
    setResult(null);
    setStatus("PENDING");
    setCriticalAlert(false);

    try {
      const r = await fetch(`${API}/infer`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ patient_id: patientId, model_type: modelType }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || `Error ${r.status}`);
      }
      const data = await r.json();
      setTaskId(data.task_id);
      startPolling(data.task_id);
      connectWebSocket(data.task_id);
    } catch (e) {
      setError(e.message);
      setRunning(false);
      setStatus(null);
    }
  }

  // ── Polling cada 3s ───────────────────────────────────────────────────────
  function startPolling(tid) {
    clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => checkStatus(tid), 3000);
    checkStatus(tid); // primera consulta inmediata
  }

  async function checkStatus(tid) {
    try {
      // Usar el endpoint /result que devuelve el reporte completo cuando está DONE
        const r = await fetch(`${API}/infer/${tid}`, {
        headers: getAuthHeaders(),
      });
      if (!r.ok) return;
      const data = await r.json();
      setStatus(data.status);

      if (data.status === "DONE" && data.result) {
        clearInterval(pollingRef.current);
        setResult(data.result);
        setRunning(false);
        if (data.result.is_critical) setCriticalAlert(true);
        if (onNewReport) onNewReport(data.result);
      } else if (data.status === "ERROR") {
        clearInterval(pollingRef.current);
        setError(data.error_msg || "Error en la inferencia");
        setRunning(false);
      }
    } catch (e) {
      // silenciar errores de red en polling
    }
  }

  // ── WebSocket para tiempo real ────────────────────────────────────────────
  function connectWebSocket(tid) {
    const wsUrl = API.replace("http", "ws").replace("https", "wss");
    try {
      const ws = new WebSocket(`${wsUrl}/ws/infer/${tid}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "ping") return;
        setStatus(msg.status);
        if (msg.status === "DONE" && msg.result_id) {
          fetchResult(msg.result_id);
        } else if (msg.type === "CRITICAL_ALERT") {
          setCriticalAlert(true);
        }
      };
      ws.onerror = () => {}; // silenciar — el polling es el fallback
    } catch (e) {}
  }

  async function fetchResult(resultId) {
    try {
      const r = await fetch(`${API}/fhir/RiskAssessment/${resultId}`, {
        headers: getAuthHeaders(),
      });
      if (!r.ok) return;
      const data = await r.json();
      clearInterval(pollingRef.current);
      setResult(data);
      setRunning(false);
      if (data.is_critical) setCriticalAlert(true);
      if (onNewReport) onNewReport(data);
    } catch (e) {}
  }

  // ── Render alerta crítica ─────────────────────────────────────────────────
  if (criticalAlert && result) {
    const risk = RISK_COLORS.CRITICAL;
    return (
      <div style={styles.criticalModal}>
        <div style={styles.criticalBox}>
          <div style={styles.criticalHeader}>
            <span style={styles.criticalIcon}>⚠️</span>
            <h3 style={styles.criticalTitle}>ALERTA CRÍTICA</h3>
          </div>
          <p style={styles.criticalSub}>
            El análisis detectó riesgo crítico. Debe gestionar este resultado antes de continuar.
          </p>
          <div style={{ ...styles.riskBadgeLarge, background: risk.bg, color: risk.text }}>
            {result.risk_score !== undefined
              ? `Riesgo: ${(result.risk_score * 100).toFixed(1)}% — ${risk.label}`
              : "CRÍTICO"}
          </div>
          {result.shap_values && <ShapChart values={result.shap_values} />}
          <p style={styles.disclaimer}>
            ⚕️ Resultado de apoyo diagnóstico. No reemplaza criterio médico.
          </p>
          <div style={styles.criticalActions}>
            <button
              onClick={() => { setCriticalAlert(false); }}
              style={styles.btnDanger}
            >
              Gestionar resultado →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const risk = RISK_COLORS[result?.risk_category] || RISK_COLORS.LOW;

  return (
    <div style={styles.panel}>
      {/* Selector de modelo */}
      <div style={styles.modelSelector}>
        {["ML", "DL", "MULTIMODAL"].map((m) => (
          <button
            key={m}
            onClick={() => !running && setModelType(m)}
            style={{
              ...styles.modelBtn,
              ...(modelType === m ? styles.modelBtnActive : {}),
              opacity: running ? 0.5 : 1,
            }}
          >
            {m === "ML" ? "📊 Tabular ML" : m === "DL" ? "🧠 Imagen DL" : "🔮 Multimodal"}
          </button>
        ))}
      </div>

      {/* Botón ejecutar */}
      <button
        onClick={runInference}
        disabled={running}
        style={{ ...styles.runBtn, opacity: running ? 0.7 : 1 }}
      >
        {running
          ? status === "PENDING"
            ? "⏳ En cola..."
            : "⚙️ Analizando..."
          : "▶ Ejecutar análisis"}
      </button>

      {/* Estado del task */}
      {taskId && running && (
        <div style={styles.statusBar}>
          <span style={styles.spinner}>⟳</span>
          <span style={styles.statusText}>
            {status === "PENDING" && "En cola..."}
            {status === "RUNNING" && "Procesando con IA..."}
          </span>
          <span style={styles.taskId}>{taskId.substring(0, 16)}...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={styles.errorBox}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Resultado */}
      {result && !running && (
        <div style={styles.resultBox}>
          <div style={styles.resultHeader}>
            <span style={{ ...styles.riskBadge, background: risk.bg, color: risk.text }}>
              {risk.label} — {result.risk_score !== undefined
                ? `${(result.risk_score * 100).toFixed(1)}%`
                : "N/A"}
            </span>
            <span style={styles.modelTag}>{result.method || modelType}</span>
          </div>

          {/* SHAP values */}
          {result.shap_values && <ShapChart values={result.shap_values} />}

          {/* Grad-CAM */}
          {result.gradcam_url && (
            <div style={styles.gradcamBox}>
              <p style={styles.sectionLabel}>Grad-CAM</p>
              <img src={result.gradcam_url} alt="Grad-CAM" style={styles.gradcam} />
            </div>
          )}

          <p style={styles.disclaimer}>
            ⚕️ Resultado generado por IA de apoyo diagnóstico. No reemplaza criterio médico.
            Sujeto a revisión clínica.
          </p>

          {/* Estado de firma */}
          {result.doctor_action ? (
            <div style={styles.signedBadge}>
              {result.doctor_action === "ACCEPTED" ? "✅ Firmado — Aceptado" : "❌ Firmado — Rechazado"}
            </div>
          ) : (
            <div style={styles.unsignedBadge}>
              🔴 Pendiente de firma médica
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Componente SHAP bars ──────────────────────────────────────────────────────
function ShapChart({ values }) {
  if (!values || typeof values !== "object") return null;
  const entries = Object.entries(values)
    .map(([k, v]) => ({ name: LOINC_NAMES[k] || k, value: Math.abs(parseFloat(v) || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const max = Math.max(...entries.map((e) => e.value), 0.001);

  return (
    <div style={styles.shapBox}>
      <p style={styles.sectionLabel}>Importancia de variables (SHAP)</p>
      {entries.map((e) => (
        <div key={e.name} style={styles.shapRow}>
          <span style={styles.shapName}>{e.name}</span>
          <div style={styles.shapBarBg}>
            <div
              style={{
                ...styles.shapBar,
                width: `${(e.value / max) * 100}%`,
              }}
            />
          </div>
          <span style={styles.shapVal}>{e.value.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const styles = {
  panel: { padding: "8px 0" },
  modelSelector: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  modelBtn: {
    background: "#1e293b", color: "#94a3b8", border: "1px solid #334155",
    padding: "7px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500,
  },
  modelBtnActive: {
    background: "#0e7490", color: "#e0f2fe", borderColor: "#06b6d4",
  },
  runBtn: {
    background: "#06b6d4", color: "#000", border: "none",
    padding: "10px 28px", borderRadius: 8, cursor: "pointer",
    fontWeight: 600, fontSize: 14, marginBottom: 16,
  },
  statusBar: {
    display: "flex", alignItems: "center", gap: 10,
    background: "#1e293b", borderRadius: 8, padding: "10px 16px", marginBottom: 12,
  },
  spinner: { fontSize: 18, animation: "spin 1s linear infinite" },
  statusText: { color: "#e2e8f0", fontSize: 13 },
  taskId: { fontSize: 11, color: "#64748b", marginLeft: "auto" },
  errorBox: {
    background: "#450a0a", color: "#fca5a5", borderRadius: 8,
    padding: "12px 16px", fontSize: 13, marginBottom: 12,
  },
  resultBox: {
    background: "#0f172a", borderRadius: 10, padding: 20,
    border: "1px solid #1e3a5f",
  },
  resultHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 },
  riskBadge: {
    padding: "6px 16px", borderRadius: 20,
    fontWeight: 700, fontSize: 14,
  },
  riskBadgeLarge: {
    padding: "12px 24px", borderRadius: 20,
    fontWeight: 700, fontSize: 18, textAlign: "center", marginBottom: 20,
  },
  modelTag: {
    fontSize: 11, color: "#64748b", background: "#1e293b",
    padding: "3px 10px", borderRadius: 12,
  },
  sectionLabel: { color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 10 },
  shapBox: {
    background: "#1e293b", borderRadius: 8, padding: "14px 16px", marginBottom: 16,
  },
  shapRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  shapName: { width: 130, fontSize: 12, color: "#e2e8f0", flexShrink: 0 },
  shapBarBg: { flex: 1, background: "#0f172a", borderRadius: 4, height: 12 },
  shapBar: { height: 12, background: "#06b6d4", borderRadius: 4, transition: "width 0.5s" },
  shapVal: { width: 50, fontSize: 11, color: "#64748b", textAlign: "right" },
  gradcamBox: { marginBottom: 16 },
  gradcam: { width: "100%", borderRadius: 8, maxHeight: 300, objectFit: "contain" },
  disclaimer: {
    fontSize: 12, color: "#64748b", fontStyle: "italic",
    borderTop: "1px solid #1e293b", paddingTop: 10, marginTop: 8,
  },
  signedBadge: {
    background: "#14532d", color: "#86efac",
    padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  },
  unsignedBadge: {
    background: "#450a0a", color: "#fca5a5",
    padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  },
  // Modal crítico
  criticalModal: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
  },
  criticalBox: {
    background: "#0f0a0a", border: "2px solid #ef4444",
    borderRadius: 12, padding: 32, maxWidth: 560, width: "90%",
  },
  criticalHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 },
  criticalIcon: { fontSize: 28 },
  criticalTitle: { color: "#fca5a5", margin: 0, fontSize: 20 },
  criticalSub: { color: "#94a3b8", fontSize: 14, marginBottom: 20 },
  criticalActions: { display: "flex", justifyContent: "flex-end", marginTop: 20 },
  btnDanger: {
    background: "#ef4444", color: "#fff", border: "none",
    padding: "10px 24px", borderRadius: 8, cursor: "pointer",
    fontWeight: 600, fontSize: 14,
  },
};