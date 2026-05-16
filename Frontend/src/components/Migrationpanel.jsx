// frontend/src/components/MigrationPanel.jsx
// Componente para el Panel Admin — migra pacientes existentes a usuarios PACIENTE.
// Úsalo dentro de AdminPanel.jsx en la pestaña de Usuarios o Administración.
//
// Uso:
//   import MigrationPanel from "./MigrationPanel";
//   <MigrationPanel />

import { useState } from "react";
import { adminAPI } from "../services/api";

export default function MigrationPanel() {
  const [status,  setStatus]  = useState("idle"); // idle | loading | done | error
  const [result,  setResult]  = useState(null);
  const [copiedRow, setCopiedRow] = useState(null);

  const copyField = (text, rowId) => {
    navigator.clipboard.writeText(text);
    setCopiedRow(rowId);
    setTimeout(() => setCopiedRow(null), 2000);
  };

  const copyAllCSV = () => {
    if (!result?.entry?.length) return;
    const header = "patient_name,username,access_key,permission_key";
    const rows = result.entry.map(
      (e) => `"${e.patient_name}","${e.username}","${e.access_key}","${e.permission_key}"`
    );
    navigator.clipboard.writeText([header, ...rows].join("\n"));
  };

  const run = async () => {
    setStatus("loading");
    setResult(null);
    try {
      const res = await adminAPI.migratePatientUsers();
      setResult(res.data);
      setStatus("done");
    } catch (e) {
      setResult({ error: e.response?.data?.detail || e.message });
      setStatus("error");
    }
  };

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <span style={s.icon}>🔄</span>
        <div>
          <h3 style={s.title}>Migrar pacientes a usuarios</h3>
          <p style={s.subtitle}>
            Crea un usuario con rol <strong>PACIENTE</strong> para cada paciente que
            aún no tenga credenciales de acceso al sistema.
          </p>
        </div>
      </div>

      {/* Aviso */}
      {status === "idle" && (
        <div style={s.warningBox}>
          ⚠️ Esta operación genera credenciales nuevas. Las claves se mostrarán
          <strong> una sola vez</strong> — descárgalas o cópialas antes de cerrar.
        </div>
      )}

      {/* Botón de acción */}
      {status !== "done" && (
        <button
          style={{ ...s.btn, opacity: status === "loading" ? 0.6 : 1 }}
          disabled={status === "loading"}
          onClick={run}
        >
          {status === "loading" ? "Procesando…" : "Ejecutar migración"}
        </button>
      )}

      {/* Resultado */}
      {status === "error" && (
        <div style={s.errorBox}>
          <strong>Error:</strong> {result?.error}
        </div>
      )}

      {status === "done" && result && (
        <div style={{ marginTop: 16 }}>
          <div style={s.successBox}>
            ✅ {result.message}
          </div>

          {result.entry?.length > 0 && (
            <>
              <div style={s.tableActions}>
                <span style={s.tableNote}>
                  Guarda estas credenciales — no se volverán a mostrar
                </span>
                <button style={s.copyAllBtn} onClick={copyAllCSV}>
                  📋 Copiar todo como CSV
                </button>
              </div>

              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      {["Paciente", "Usuario", "X-Access-Key", "X-Permission-Key"].map((h) => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.entry.map((row, i) => (
                      <tr key={i} style={i % 2 === 0 ? s.trEven : {}}>
                        <td style={s.td}>{row.patient_name}</td>
                        <td style={{ ...s.td, color: "#06b6d4" }}>{row.username}</td>
                        <td style={s.tdMono}>
                          <div style={s.keyCell}>
                            <span style={s.keyText}>{row.access_key}</span>
                            <button
                              style={s.copySmall}
                              onClick={() => copyField(row.access_key, `ak-${i}`)}
                            >
                              {copiedRow === `ak-${i}` ? "✓" : "⧉"}
                            </button>
                          </div>
                        </td>
                        <td style={s.tdMono}>
                          <div style={s.keyCell}>
                            <span style={s.keyText}>{row.permission_key}</span>
                            <button
                              style={s.copySmall}
                              onClick={() => copyField(row.permission_key, `pk-${i}`)}
                            >
                              {copiedRow === `pk-${i}` ? "✓" : "⧉"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                style={{ ...s.btn, marginTop: 12, background: "#334155" }}
                onClick={run}
              >
                Volver a ejecutar (nuevos pacientes sin usuario)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const s = {
  card: {
    background: "#0f172a", borderRadius: 12, padding: 20,
    border: "1px solid #1e293b", marginBottom: 24,
  },
  cardHeader: { display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 },
  icon: { fontSize: 28, lineHeight: 1 },
  title: { margin: "0 0 4px", color: "#e2e8f0", fontSize: 15, fontWeight: 600 },
  subtitle: { margin: 0, color: "#64748b", fontSize: 13 },
  warningBox: {
    background: "#1c1007", color: "#fbbf24", borderRadius: 8,
    padding: "10px 14px", fontSize: 13, marginBottom: 14,
    border: "1px solid #92400e",
  },
  errorBox: {
    background: "#450a0a", color: "#fca5a5", borderRadius: 8,
    padding: "10px 14px", fontSize: 13, marginTop: 12,
  },
  successBox: {
    background: "#052e16", color: "#86efac", borderRadius: 8,
    padding: "10px 14px", fontSize: 14, marginBottom: 12,
    border: "1px solid #166534",
  },
  btn: {
    background: "#06b6d4", color: "#000", border: "none",
    padding: "9px 20px", borderRadius: 8, cursor: "pointer",
    fontWeight: 600, fontSize: 14,
  },
  tableActions: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 8,
  },
  tableNote: { fontSize: 12, color: "#f59e0b" },
  copyAllBtn: {
    background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155",
    padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12,
  },
  tableWrap: { overflowX: "auto", borderRadius: 8, border: "1px solid #1e293b" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    background: "#1e293b", color: "#94a3b8", padding: "8px 12px",
    textAlign: "left", fontWeight: 500, fontSize: 11,
    textTransform: "uppercase", letterSpacing: "0.06em",
  },
  td:     { padding: "7px 12px", color: "#e2e8f0", borderTop: "1px solid #1e293b" },
  tdMono: { padding: "7px 12px", borderTop: "1px solid #1e293b" },
  trEven: { background: "#0a1628" },
  keyCell: { display: "flex", alignItems: "center", gap: 6 },
  keyText: { fontFamily: "monospace", color: "#7dd3fc", fontSize: 12 },
  copySmall: {
    background: "#334155", color: "#e2e8f0", border: "none",
    padding: "2px 7px", borderRadius: 4, cursor: "pointer", fontSize: 11,
  },
};