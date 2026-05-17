"""
ragas_eval.py — Evaluación RAGAS del Agente RAG Clínico
Entregable E4: faithfulness, answer_relevancy, context_precision, context_recall

Ejecutar: python ragas_eval.py
Output: ragas_report.json
"""
import asyncio
import json
import os
import httpx
from datasets import Dataset

AGENT_URL = os.getenv("AGENT_URL", "http://localhost:8004")

# ── 30 preguntas clínicas de evaluación ──────────────────────────────────────
EVAL_QUESTIONS = [
    ("¿Cuáles son los criterios diagnósticos de diabetes mellitus tipo 2 según la ADA?",
     "Los criterios son: glucemia ayunas ≥126 mg/dL, glucemia 2h PTOG ≥200 mg/dL, HbA1c ≥6.5%, o glucemia aleatoria ≥200 mg/dL con síntomas."),
    ("¿Qué significa un valor de glucosa de 148 mg/dL en PTOG a las 2 horas?",
     "Un valor de 148 mg/dL en PTOG 2h indica tolerancia glucosa alterada (TGA), que es prediabetes (rango 140-199 mg/dL)."),
    ("¿Cuáles son las clases de retinopatía diabética en la clasificación APTOS 2019?",
     "Las clases son: 0 (No DR), 1 (Mild DR), 2 (Moderate DR), 3 (Severe DR), 4 (Proliferative DR)."),
    ("¿Cuál es el objetivo de HbA1c recomendado para la mayoría de adultos con DM2?",
     "El objetivo general es HbA1c <7.0% para la mayoría de adultos no embarazadas con DM2 según la ADA 2024."),
    ("¿Qué es la retinopatía diabética proliferativa y qué riesgo representa?",
     "La RDP implica neovascularización o hemorragia vítrea/prerretiniana. Es la fase más severa y puede causar ceguera sin tratamiento inmediato."),
    ("¿Qué variables del dataset PIMA son más importantes para predecir diabetes?",
     "Según valores SHAP del modelo XGBoost: Glucose > BMI > Age > DiabetesPedigreeFunction son los predictores más importantes."),
    ("¿Cuál es el tratamiento de primera línea para el edema macular diabético central?",
     "El tratamiento de primera línea es anti-VEGF intravítreo (ranibizumab, aflibercept o bevacizumab), con inyecciones mensuales durante 6 meses."),
    ("¿Cómo se clasifica la presión arterial diastólica en mmHg?",
     "Normal: <80 mmHg, Elevada: 80-89 mmHg, Hipertensión estadio 1: 90-99 mmHg, Hipertensión estadio 2: ≥100 mmHg."),
    ("¿Qué resolución colombiana regula la interoperabilidad FHIR en el SGSSS?",
     "La Resolución 866 de 2021 del MSPS adopta FHIR R4 como estándar de interoperabilidad en el Sistema General de Seguridad Social en Salud de Colombia."),
    ("¿Qué es el IMC y cuál es el rango considerado obesidad?",
     "IMC = peso(kg)/talla²(m). Obesidad se define como IMC ≥30 kg/m². Clase I: 30-34.9, Clase II: 35-39.9, Clase III (mórbida): ≥40."),
    ("¿Cuándo debe iniciarse el cribado de retinopatía en DM tipo 2?",
     "En DM tipo 2, el cribado debe iniciarse en el momento del diagnóstico y repetirse anualmente."),
    ("¿Qué fármacos tienen evidencia de reducción de eventos cardiovasculares en DM2?",
     "Los GLP-1 RA (liraglutida, semaglutida) y SGLT-2i (empagliflozina, dapagliflozina) tienen evidencia de reducción de MACE en estudios cardiovasculares."),
    ("¿Qué indica la función pedigrí de diabetes (DiabetesPedigreeFunction) en el dataset PIMA?",
     "Es un score que cuantifica el riesgo genético de diabetes basado en el historial familiar. Rango 0.078-2.42; valores >0.5 indican riesgo genético significativo."),
    ("¿Cuál es la diferencia entre RDNP severa y RDP según la regla 4-2-1?",
     "RDNP severa cumple la regla 4-2-1: hemorragias en 4 cuadrantes, O arrosariamiento venoso en ≥2, O AMIR en ≥1. RDP implica neovascularización activa."),
    ("¿Qué significa soft-delete en el contexto de la Resolución 1995/1999?",
     "El soft-delete preserva el registro clínico (active=false) sin eliminación física, cumpliendo la obligación de conservar la historia clínica según la resolución colombiana."),
    ("¿Cuáles son los síntomas clásicos de hipoglucemia leve?",
     "Los síntomas autonómicos de hipoglucemia leve (54-70 mg/dL) incluyen sudoración, temblor, palpitaciones, sensación de hambre y ansiedad."),
    ("¿Qué es el modelo ONNX INT8 y por qué se usa en este sistema?",
     "ONNX INT8 es cuantización de 8 bits del modelo exportado a formato ONNX. Reduce el tamaño del modelo 4x y la latencia de inferencia en CPU a ≤400ms, sin GPU."),
    ("¿Qué recursos FHIR R4 son obligatorios según los requisitos del proyecto?",
     "Son obligatorios: Patient, Observation (LOINC), DiagnosticReport, RiskAssessment y Practitioner. AuditEvent y Condition son recomendados."),
    ("¿Cuáles son los criterios para diagnóstico de síndrome metabólico?",
     "Síndrome metabólico requiere ≥3 de 5 criterios: circunferencia cintura aumentada, triglicéridos ≥150 mg/dL, HDL bajo, PA ≥130/85 mmHg, glucosa ayunas ≥100 mg/dL."),
    ("¿Qué diferencia hay entre Naive RAG y Advanced RAG?",
     "Naive RAG usa solo recuperación por similitud coseno (dense). Advanced RAG añade BM25 híbrido, query expansion y reranking para mejorar la precisión del contexto recuperado."),
    ("¿Cuál es la latencia objetivo del modelo ML de diabetes en el sistema?",
     "La latencia objetivo es ≤400ms por inferencia en CPU, usando el modelo XGBoost exportado a ONNX con cuantización INT8."),
    ("¿Qué ley colombiana regula la protección de datos de salud?",
     "La Ley 1581 de 2012 (Habeas Data) regula la protección de datos personales en Colombia. Los datos de salud son categoría especial con mayor protección."),
    ("¿Cuáles son los estadios de la Enfermedad Renal Crónica según KDIGO?",
     "ERC se estadifica por TFGe: G1 (≥90), G2 (60-89), G3a (45-59), G3b (30-44), G4 (15-29), G5 (<15) ml/min/1.73m². Combinado con estadio de albuminuria A1-A3."),
    ("¿Qué es la calibración isotónica en el contexto de modelos ML clínicos?",
     "La calibración isotónica (CalibratedClassifierCV, method='isotonic') corrige la sobreconfianza del modelo para que las probabilidades reportadas reflejen las frecuencias reales de los eventos."),
    ("¿Cómo se clasifica el pie diabético según Wagner?",
     "Wagner: Grado 0 (pie en riesgo), Grado 1 (úlcera superficial), Grado 2 (úlcera profunda), Grado 3 (osteomielitis/absceso), Grado 4 (gangrena localizada), Grado 5 (gangrena extensa)."),
    ("¿Qué es el AuditEvent FHIR y para qué se usa en el sistema?",
     "AuditEvent es un recurso FHIR que registra accesos a datos clínicos. En el sistema se usa para auditar accesos de médicos SuperUser externos, cumpliendo trazabilidad regulatoria."),
    ("¿Cuáles son los objetivos glucémicos durante el embarazo con diabetes?",
     "Ayunas <95 mg/dL, 1h postprandial <140 mg/dL, 2h postprandial <120 mg/dL, HbA1c <6.0% (ideal) o <6.5% (aceptable) en diabetes pregestacional."),
    ("¿Qué tratamiento se recomienda para RDNP severa?",
     "RDNP severa requiere referencia urgente a retinólogo, panfotocoagulación láser (PFC) preventiva, anti-VEGF si hay EMD, y seguimiento mensual hasta estabilización."),
    ("¿Qué es el BCrypt y por qué se usa con factor ≥12?",
     "BCrypt es un algoritmo de hashing de contraseñas adaptativo. El factor de trabajo ≥12 asegura que el cómputo sea suficientemente lento para resistir ataques de fuerza bruta, según estándares de seguridad actuales."),
    ("¿Qué diferencia hay entre DM tipo 1 y tipo 2 en términos de fisiopatología?",
     "DM1 es destrucción autoinmune de células beta (insulinopenia absoluta). DM2 es resistencia insulínica con disfunción progresiva de células beta (insulinopenia relativa). DM2 representa >90% de los casos."),
]


async def get_agent_response(question: str, session_id: str = None) -> dict:
    """Llama al agente y obtiene respuesta + contexto."""
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            r = await client.post(
                f"{AGENT_URL}/agent/chat",
                json={"message": question, "session_id": session_id, "rag_mode": "hybrid"},
            )
            if r.status_code == 200:
                data = r.json()
                return {
                    "answer": data.get("answer", ""),
                    "session_id": data.get("session_id"),
                    "sources": data.get("sources", []),
                }
        except Exception as e:
            print(f"  Error: {e}")
    return {"answer": "Error al contactar el agente.", "session_id": None, "sources": []}


async def collect_eval_data():
    """Recopila respuestas del agente para todas las preguntas de evaluación."""
    print(f"Recopilando respuestas del agente ({len(EVAL_QUESTIONS)} preguntas)…")
    questions, answers, contexts, ground_truths = [], [], [], []

    for i, (question, ground_truth) in enumerate(EVAL_QUESTIONS):
        print(f"  [{i+1}/{len(EVAL_QUESTIONS)}] {question[:60]}…")
        resp = await get_agent_response(question)
        questions.append(question)
        answers.append(resp["answer"])
        contexts.append([f"Fuentes: {', '.join(resp['sources'])}" if resp["sources"] else "Sin contexto recuperado"])
        ground_truths.append(ground_truth)
        await asyncio.sleep(0.5)

    return Dataset.from_dict({
        "question": questions,
        "answer": answers,
        "contexts": contexts,
        "ground_truth": ground_truths,
    })


def _safe_float(v, default=0.0) -> float:
    """Convierte a float seguro para JSON — reemplaza NaN/Inf."""
    import math
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


def _build_ragas_llm():
    """Construye el LLM evaluador para RAGAS según variables de entorno disponibles."""
    groq_key = os.getenv("GROQ_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")

    if openai_key:
        from langchain_openai import ChatOpenAI
        print("  LLM evaluador: OpenAI")
        return ChatOpenAI(api_key=openai_key, model="gpt-4o-mini", temperature=0)
    if groq_key:
        from langchain_groq import ChatGroq
        print("  LLM evaluador: Groq (llama-3.1-8b-instant)")
        return ChatGroq(api_key=groq_key, model="llama-3.1-8b-instant", temperature=0)
    if anthropic_key:
        from langchain_anthropic import ChatAnthropic
        print("  LLM evaluador: Anthropic (claude-haiku-4-5-20251001)")
        return ChatAnthropic(api_key=anthropic_key, model="claude-haiku-4-5-20251001", temperature=0)
    # Fallback: Ollama
    try:
        from langchain_ollama import ChatOllama
        model = os.getenv("LLM_MODEL", "phi3:mini")
        print(f"  LLM evaluador: Ollama ({model})")
        return ChatOllama(base_url=ollama_url, model=model, temperature=0)
    except Exception:
        return None


def run_ragas_evaluation(dataset: Dataset) -> dict:
    """Ejecuta la evaluación RAGAS sobre el dataset."""
    try:
        from ragas import evaluate
        from ragas.metrics import (
            faithfulness,
            answer_relevancy,
            context_precision,
            context_recall,
        )
        from ragas.llms import LangchainLLM

        llm = _build_ragas_llm()
        if llm:
            lc_llm = LangchainLLM(llm)
            for metric in [faithfulness, answer_relevancy, context_precision, context_recall]:
                metric.llm = lc_llm

        print("\nEjecutando evaluación RAGAS…")
        result = evaluate(
            dataset=dataset,
            metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        )
        return result
    except ImportError:
        print("⚠ ragas no instalado. Ejecute: pip install ragas")
        return None
    except Exception as e:
        print(f"⚠ Error RAGAS: {e}")
        return None


async def main():
    print("=" * 60)
    print("EVALUACIÓN RAGAS — ClinAI Agente RAG Clínico")
    print("=" * 60)

    # Recopilar datos
    dataset = await collect_eval_data()
    print(f"\n✅ Dataset listo: {len(dataset)} preguntas")

    # Ejecutar RAGAS
    result = run_ragas_evaluation(dataset)

    if result is not None:
        result_dict = {
            "faithfulness":      _safe_float(result["faithfulness"]),
            "answer_relevancy":  _safe_float(result["answer_relevancy"]),
            "context_precision": _safe_float(result["context_precision"]),
            "context_recall":    _safe_float(result["context_recall"]),
        }
    else:
        # Métricas simuladas si RAGAS no está disponible
        result_dict = {
            "faithfulness":      0.0,
            "answer_relevancy":  0.0,
            "context_precision": 0.0,
            "context_recall":    0.0,
            "note": "RAGAS no ejecutado — instale ragas y configure LLM",
        }

    # Guardar reporte JSON
    report = {
        "total_questions": len(EVAL_QUESTIONS),
        "agent_url": AGENT_URL,
        "metrics": result_dict,
        "thresholds": {
            "faithfulness": {"min": 0.75, "ideal": 0.85},
            "answer_relevancy": {"min": 0.70, "ideal": 0.80},
            "context_precision": {"min": 0.65, "ideal": 0.75},
            "context_recall": {"min": 0.65, "ideal": 0.75},
        },
        "penalization_risk": result_dict.get("faithfulness", 0) < 0.75,
    }

    with open("ragas_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("RESULTADOS RAGAS")
    print("=" * 60)
    for k, v in result_dict.items():
        if isinstance(v, float):
            status = "✅" if v >= 0.75 else ("⚠" if v >= 0.65 else "❌")
            print(f"  {status} {k:<25}: {v:.4f}")

    if result_dict.get("faithfulness", 0) < 0.75:
        print("\n❌ ADVERTENCIA: Faithfulness < 0.75 → Penalización del 10% en nota final")
    else:
        print("\n✅ Faithfulness en rango aceptable — sin penalización")

    print(f"\nReporte guardado: ragas_report.json")
    return report


if __name__ == "__main__":
    asyncio.run(main())
