"""
core/tools.py — Herramientas del agente: FHIR, ML, DL, reportes.
Implementa Agentic RAG via tool calling.
"""
import os
from typing import Any, Optional

import httpx
from langchain.tools import tool

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")
ML_URL = os.getenv("ML_SERVICE_URL", "http://ml-service:8001")
DL_URL = os.getenv("DL_SERVICE_URL", "http://dl-service:8002")
FHIR_URL = os.getenv("FHIR_SERVER_URL", "http://fhir-server:8080/fhir")

_db_pool = None

def set_db_pool(pool):
    global _db_pool
    _db_pool = pool

_HTTP_TIMEOUT = 15


@tool
async def query_fhir(patient_id: str) -> str:
    """
    Recupera datos FHIR R4 del paciente: Observations, DiagnosticReports, RiskAssessments.
    Útil cuando el usuario pregunta sobre historial clínico o resultados previos.
    """
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            r = await client.get(f"{FHIR_URL}/Observation?subject=Patient/{patient_id}&_count=20")
            obs = r.json().get("entry", []) if r.status_code == 200 else []
        except Exception:
            obs = []
        try:
            r2 = await client.get(f"{FHIR_URL}/DiagnosticReport?subject=Patient/{patient_id}&_count=5")
            reports = r2.json().get("entry", []) if r2.status_code == 200 else []
        except Exception:
            reports = []

    summary_parts = []
    for entry in obs[:10]:
        res = entry.get("resource", {})
        loinc = res.get("code", {}).get("coding", [{}])[0].get("code", "")
        val = res.get("valueQuantity", {})
        summary_parts.append(f"{loinc}: {val.get('value')} {val.get('unit','')}")

    result = "Observaciones LOINC: " + ("; ".join(summary_parts) if summary_parts else "Sin datos")
    if reports:
        result += f" | DiagnosticReports: {len(reports)} registros"
    return result


@tool
async def invoke_ml_model(features_json: str) -> str:
    """
    Invoca el modelo ML (XGBoost ONNX) para predicción de diabetes.
    Parámetro: JSON con features: Pregnancies, Glucose, BloodPressure, SkinThickness,
    Insulin, BMI, DiabetesPedigreeFunction, Age.
    """
    import json
    try:
        features = json.loads(features_json)
    except Exception:
        return "Error: features_json debe ser un JSON válido"

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            r = await client.post(f"{ML_URL}/predict", json={"features": features})
            if r.status_code == 200:
                data = r.json()
                prob = data.get("probability", data.get("risk_score", "?"))
                cat = data.get("risk_category", "")
                return f"Predicción diabetes: {prob:.3f} probabilidad | Categoría: {cat}"
            return f"ML service error {r.status_code}"
        except Exception as e:
            return f"No se pudo conectar al servicio ML: {e}"


@tool
async def invoke_dl_model(patient_id: str) -> str:
    """
    Invoca el modelo DL de retinopatía diabética (EfficientNet-B0 ONNX) para el paciente.
    Recupera la última imagen de fondo de ojo almacenada y retorna la clasificación APTOS 2019
    con probabilidades por clase y nivel de riesgo.
    Parámetro: patient_id (UUID del paciente).
    """
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            r = await client.post(f"{DL_URL}/dl/predict", params={"patient_id": patient_id})
            if r.status_code == 200:
                data = r.json()
                cls_name = data.get("class_name", "?")
                risk_cat = data.get("risk_category", "?")
                probs = data.get("probabilities", {})
                elapsed = data.get("elapsed_ms", "?")
                top_probs = ", ".join(
                    f"{k}: {v:.2%}" for k, v in sorted(probs.items(), key=lambda x: -x[1])[:3]
                )
                return (
                    f"Retinopatía diabética: {cls_name} | Riesgo: {risk_cat} | "
                    f"Top probabilidades: {top_probs} | Latencia: {elapsed}ms"
                )
            elif r.status_code == 404:
                return (
                    "Sin imagen de fondo de ojo registrada para este paciente. "
                    "El médico debe cargar una imagen retiniana antes de ejecutar el modelo DL."
                )
            return f"DL service error {r.status_code}: {r.text[:200]}"
        except Exception as e:
            return f"No se pudo conectar al servicio DL: {e}"


@tool
async def create_fhir_report(patient_id: str, summary: str, risk_level: str) -> str:
    """
    Crea un DiagnosticReport FHIR R4 con el resumen clínico generado por el agente.
    risk_level: LOW | MEDIUM | HIGH | CRITICAL
    """
    import json
    report = {
        "resourceType": "DiagnosticReport",
        "status": "final",
        "category": [{"coding": [{"system": "http://loinc.org", "code": "11502-2"}]}],
        "code": {"coding": [{"system": "http://loinc.org", "code": "34133-9", "display": "Summary note"}]},
        "subject": {"reference": f"Patient/{patient_id}"},
        "conclusion": summary,
        "conclusionCode": [
            {"coding": [{"system": "http://snomed.info/sct", "display": risk_level}]}
        ],
    }

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            r = await client.post(f"{FHIR_URL}/DiagnosticReport", json=report)
            if r.status_code in (200, 201):
                fhir_id = r.json().get("id", "?")
                return f"DiagnosticReport creado: ID={fhir_id}"
            return f"FHIR error {r.status_code}: {r.text[:200]}"
        except Exception as e:
            return f"No se pudo crear reporte FHIR: {e}"


@tool
def search_clinical_docs(query: str) -> str:
    """
    Busca en la base de conocimiento clínica (guías, protocolos, literatura).
    Retorna contexto relevante sobre diabetes y retinopatía diabética.
    """
    from core.retriever import retriever
    results = retriever.retrieve(query, k=4, mode="hybrid")
    if not results:
        return "Sin documentos relevantes encontrados."
    return "\n\n".join(f"[{r['source']}] {r['text'][:400]}" for r in results)


@tool
async def query_risk_reports(patient_id: str) -> str:
    """
    Consulta los reportes de riesgo clínico del paciente almacenados en el sistema local.
    Retorna el historial de predicciones ML/DL con categoría de riesgo y score.
    Parámetro: patient_id (UUID del paciente).
    """
    if _db_pool is None:
        return "Base de datos no disponible para consultar reportes."
    try:
        async with _db_pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT model_type, risk_score, risk_category, is_critical,
                          doctor_action, doctor_notes, created_at
                   FROM risk_reports
                   WHERE patient_id = $1::uuid AND deleted_at IS NULL
                   ORDER BY created_at DESC LIMIT 5""",
                patient_id,
            )
        if not rows:
            return "No hay reportes de riesgo registrados para este paciente."
        lines = []
        for r in rows:
            action = r["doctor_action"] or "Pendiente revisión médica"
            critical = " ⚠ CRÍTICO" if r["is_critical"] else ""
            date = str(r["created_at"])[:10]
            lines.append(
                f"[{date}] {r['model_type']}: score={float(r['risk_score']):.3f} | "
                f"{r['risk_category']}{critical} | Médico: {action}"
            )
        return "Reportes de riesgo clínico:\n" + "\n".join(lines)
    except Exception as e:
        return f"Error consultando reportes: {e}"


AGENT_TOOLS = [query_fhir, query_risk_reports, invoke_ml_model, invoke_dl_model, create_fhir_report, search_clinical_docs]
