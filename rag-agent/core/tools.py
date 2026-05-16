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
async def invoke_dl_model(image_description: str) -> str:
    """
    Consulta el modelo DL de retinopatía diabética (EfficientNet ONNX).
    No envía la imagen directamente; retorna información del último análisis disponible.
    """
    return (
        "El modelo DL de retinopatía analiza imágenes de fondo de ojo. "
        "Para procesar una imagen nueva, use el endpoint /infer con model_type=DL desde la interfaz clínica. "
        f"Descripción solicitada: {image_description}"
    )


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


AGENT_TOOLS = [query_fhir, invoke_ml_model, invoke_dl_model, create_fhir_report, search_clinical_docs]
