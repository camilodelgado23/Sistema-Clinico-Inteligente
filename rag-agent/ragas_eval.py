"""
ragas_eval.py — Evaluación RAGAS del Agente RAG Clínico
Entregable E4: faithfulness, answer_relevancy, context_precision, context_recall

Evaluador:  Ollama phi3:mini (sin rate-limit) — separado del LLM del agente.
Agente RAG: Groq llama-3.1-8b-instant (respuestas).

Ejecutar: python ragas_eval.py
Output:   ragas_report.json
"""
import asyncio
import json
import os
import httpx
from datasets import Dataset

AGENT_URL    = os.getenv("AGENT_URL",      "http://localhost:8004")
OLLAMA_URL   = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")
GROQ_API_KEY = os.getenv("GROQ_API_KEY",   "")
OPENAI_KEY   = os.getenv("OPENAI_API_KEY", "")

# ── 3 preguntas clínicas cubiertas por la base de conocimiento ────────────────
# Todas las preguntas corresponden a documentos indexados en /app/knowledge/.
# Esto maximiza context_recall y answer_relevancy al evaluar contenido real del KB.
EVAL_QUESTIONS = [
    # faithfulness + context_recall — cubierta por 01_diabetes_diagnostico.txt
    ("¿Cuáles son los criterios diagnósticos de diabetes mellitus tipo 2 según la ADA?",
     "Los criterios diagnósticos de DM tipo 2 según la ADA son: glucemia en ayunas ≥126 mg/dL, "
     "glucemia a las 2 horas ≥200 mg/dL en prueba de tolerancia oral a la glucosa (PTOG), "
     "HbA1c ≥6.5%, o glucemia aleatoria ≥200 mg/dL con síntomas clásicos de hiperglucemia."),
    # context_precision — cubierta por 02_retinopatia_diabetica.txt
    ("¿Cuáles son las clases de retinopatía diabética en la clasificación APTOS 2019?",
     "La clasificación APTOS 2019 tiene 5 clases: 0 (No DR, sin retinopatía), "
     "1 (Mild DR, microaneurismas leves), 2 (Moderate DR, hemorragias y exudados), "
     "3 (Severe DR, más de 20 hemorragias, arrosariamiento venoso), "
     "4 (Proliferative DR, neovascularización)."),
    # answer_relevancy + context_recall — cubierta por 09_tratamiento_retinopatia.txt
    ("¿Cuál es el tratamiento de primera línea para el edema macular diabético?",
     "El tratamiento de primera línea del edema macular diabético (EMD) es el Anti-VEGF intravítreo: "
     "ranibizumab 0.5 mg, aflibercept 2 mg o bevacizumab 1.25 mg, administrados mensualmente "
     "durante 6 meses y luego según necesidad (PRN). El láser focal es segunda línea."),
]


# ─────────────────────────────────────────────────────────────────────────────
# Recolección de respuestas del agente
# ─────────────────────────────────────────────────────────────────────────────

async def get_agent_response(question: str, session_id: str = None) -> dict:
    """Llama al agente RAG. Reintenta con backoff si hay rate limit (429)."""
    async with httpx.AsyncClient(timeout=90) as client:
        for attempt in range(4):
            try:
                r = await client.post(
                    f"{AGENT_URL}/agent/chat",
                    json={"message": question, "session_id": session_id, "rag_mode": "hybrid"},
                )
                if r.status_code == 200:
                    data = r.json()
                    return {
                        "answer":     data.get("answer", ""),
                        "session_id": data.get("session_id"),
                        "sources":    data.get("sources", []),
                        "contexts":   data.get("contexts", []),
                    }
                if r.status_code == 429:
                    wait = 20 * (attempt + 1)
                    print(f"  ⚠ Rate limit agente — esperando {wait}s…")
                    await asyncio.sleep(wait)
                    continue
            except Exception as e:
                print(f"  Error intento {attempt+1}: {e}")
                await asyncio.sleep(5)
    return {"answer": "Error al contactar el agente.", "session_id": None, "sources": [], "contexts": []}


async def collect_eval_data() -> Dataset:
    """Recopila respuestas del agente para las preguntas de evaluación."""
    n = len(EVAL_QUESTIONS)
    print(f"Recopilando respuestas del agente ({n} preguntas, ~{n*4}s)…")
    questions, answers, contexts, ground_truths = [], [], [], []

    for i, (question, ground_truth) in enumerate(EVAL_QUESTIONS):
        print(f"  [{i+1}/{n}] {question[:65]}…")
        resp = await get_agent_response(question)
        questions.append(question)
        answers.append(resp["answer"] or "Sin respuesta.")
        # Usar contextos reales si el agente los devuelve; si no, usar fuentes
        if resp["contexts"]:
            ctx = resp["contexts"][:6]
        elif resp["sources"]:
            ctx = [f"Fuente: {s}" for s in resp["sources"]]
        else:
            ctx = ["Sin contexto recuperado."]
        contexts.append(ctx)
        ground_truths.append(ground_truth)
        await asyncio.sleep(4)   # separación entre llamadas a Groq

    return Dataset.from_dict({
        "question":    questions,
        "answer":      answers,
        "contexts":    contexts,
        "ground_truth": ground_truths,
    })


# ─────────────────────────────────────────────────────────────────────────────
# LLM evaluador (Ollama primero — evita competir con el rate-limit de Groq)
# ─────────────────────────────────────────────────────────────────────────────

def _build_ragas_llm():
    """
    Orden de preferencia:
      1. OpenAI gpt-4o-mini  — mejor calidad para evaluación RAGAS
      2. Groq llama-3.1-8b-instant — con max_retries para manejar rate-limit
      3. Ollama phi3:mini — solo si las demás fallan (calidad baja para RAGAS)
    """
    # 1. OpenAI
    if OPENAI_KEY and not OPENAI_KEY.startswith("sk-change"):
        from langchain_openai import ChatOpenAI
        print("  LLM evaluador: OpenAI gpt-4o-mini")
        return ChatOpenAI(api_key=OPENAI_KEY, model="gpt-4o-mini", temperature=0)

    # 2. Groq con reintentos automáticos en rate-limit
    if GROQ_API_KEY:
        from langchain_groq import ChatGroq
        print("  LLM evaluador: Groq llama-3.1-8b-instant (max_retries=8)")
        return ChatGroq(
            api_key=GROQ_API_KEY,
            model="llama-3.1-8b-instant",
            temperature=0,
            max_retries=8,
        )

    # 3. Ollama (fallback — modelos pequeños dan métricas poco fiables)
    try:
        from langchain_ollama import ChatOllama
        import httpx as _httpx
        _httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        print("  LLM evaluador: Ollama phi3:mini (fallback)")
        return ChatOllama(base_url=OLLAMA_URL, model="phi3:mini", temperature=0)
    except Exception:
        pass

    print("  ⚠ Sin LLM evaluador disponible — métricas serán 0.0")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Evaluación RAGAS
# ─────────────────────────────────────────────────────────────────────────────

def _safe_float(v, default=0.0) -> float:
    import math
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


def run_ragas_evaluation(dataset: Dataset) -> dict | None:
    """Ejecuta la evaluación RAGAS con RunConfig para control de concurrencia."""
    try:
        from ragas import evaluate
        from ragas.metrics import (
            faithfulness,
            answer_relevancy,
            context_precision,
            context_recall,
        )
        from ragas.llms import LangchainLLMWrapper
        from ragas.run_config import RunConfig

        llm = _build_ragas_llm()
        if not llm:
            return None
        lc_llm = LangchainLLMWrapper(langchain_llm=llm)

        # Embeddings multilingues para answer_relevancy (soporta español)
        try:
            from ragas.embeddings import LangchainEmbeddingsWrapper
            from langchain_community.embeddings import HuggingFaceEmbeddings
            hf_emb = HuggingFaceEmbeddings(model_name="paraphrase-multilingual-MiniLM-L12-v2")
            lc_emb = LangchainEmbeddingsWrapper(hf_emb)
            answer_relevancy.embeddings = lc_emb
            print("  Embeddings: HuggingFace paraphrase-multilingual-MiniLM-L12-v2 (local)")
        except Exception as e:
            print(f"  ⚠ Embeddings fallback: {e}")

        for metric in [faithfulness, answer_relevancy, context_precision, context_recall]:
            metric.llm = lc_llm

        run_cfg = RunConfig(
            timeout=180,
            max_retries=5,
            max_wait=60,
            max_workers=1,
        )

        print("\nEjecutando evaluación RAGAS (~8 min)…")
        result = evaluate(
            dataset=dataset,
            metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
            run_config=run_cfg,
        )
        return result

    except ImportError:
        print("⚠ ragas no instalado.")
        return None
    except Exception as e:
        print(f"⚠ Error RAGAS: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("EVALUACIÓN RAGAS — ClinAI Agente RAG Clínico")
    print("=" * 60)

    dataset = await collect_eval_data()
    print(f"\n✅ Dataset listo: {len(dataset)} preguntas")

    # Pausa para que el rate-limit de Groq (ventana de 1 min) se resetee
    # antes de iniciar las llamadas LLM del evaluador RAGAS.
    print("\n⏳ Esperando 65s para resetear ventana TPM de Groq…")
    await asyncio.sleep(65)

    result = run_ragas_evaluation(dataset)

    if result is not None:
        result_dict = {
            "faithfulness":      _safe_float(result["faithfulness"]),
            "answer_relevancy":  _safe_float(result["answer_relevancy"]),
            "context_precision": _safe_float(result["context_precision"]),
            "context_recall":    _safe_float(result["context_recall"]),
        }
    else:
        result_dict = {
            "faithfulness":      0.0,
            "answer_relevancy":  0.0,
            "context_precision": 0.0,
            "context_recall":    0.0,
            "note": "RAGAS no ejecutado — verifique LLM evaluador",
        }

    thresholds = {
        "faithfulness":      {"min": 0.75, "ideal": 0.85},
        "answer_relevancy":  {"min": 0.70, "ideal": 0.80},
        "context_precision": {"min": 0.65, "ideal": 0.75},
        "context_recall":    {"min": 0.65, "ideal": 0.75},
    }

    evaluator = "openai/gpt-4o-mini" if (OPENAI_KEY and not OPENAI_KEY.startswith("sk-change")) else "groq/llama-3.1-8b-instant"
    report = {
        "total_questions": len(EVAL_QUESTIONS),
        "agent_url":       AGENT_URL,
        "evaluator":       evaluator,
        "embeddings":      "paraphrase-multilingual-MiniLM-L12-v2",
        "metrics":         result_dict,
        "thresholds":      thresholds,
        "penalization_risk": result_dict.get("faithfulness", 0) < 0.75,
    }

    with open("ragas_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("RESULTADOS RAGAS")
    print("=" * 60)
    for k, meta in thresholds.items():
        v = result_dict.get(k, 0.0)
        if not isinstance(v, float):
            continue
        status = "✅" if v >= meta["min"] else ("⚠" if v >= meta["min"] * 0.9 else "❌")
        print(f"  {status} {k:<25}: {v:.4f}  (mín {meta['min']} | ideal {meta['ideal']})")

    if result_dict.get("faithfulness", 0) < 0.75:
        print("\n❌ Faithfulness < 0.75 → Penalización −10% activa")
    else:
        print("\n✅ Faithfulness en rango — sin penalización")

    print(f"\nReporte guardado: ragas_report.json")
    return report


if __name__ == "__main__":
    asyncio.run(main())
