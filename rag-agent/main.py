"""
rag-agent/main.py — Agente RAG Clínico Inteligente
Puerto: 8004
RAG types: Naive, Advanced (reranking), Modular, Agentic (ReAct tool-calling)
"""
import os
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg
import httpx
import redis.asyncio as aioredis
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel
from pydantic_settings import BaseSettings

from core.injection import mask_pii, sanitize_input
from core.memory import LongTermMemory, ShortTermMemory
from core.retriever import retriever
from core.tools import AGENT_TOOLS, set_db_pool


class Settings(BaseSettings):
    DATABASE_URL: str = ""
    REDIS_URL: str = "redis://redis:6379/0"
    LLM_PROVIDER: str = "ollama"
    GROQ_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    OLLAMA_BASE_URL: str = "http://ollama:11434"
    LLM_MODEL: str = "phi3:mini"
    FHIR_SERVER_URL: str = "http://fhir-server:8080/fhir"
    ML_SERVICE_URL: str = "http://ml-service:8001"
    DL_SERVICE_URL: str = "http://dl-service:8002"
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    ALLOWED_ORIGINS: str = "https://147.182.131.232"

    class Config:
        env_file = ".env"


settings = Settings()

_redis: Optional[aioredis.Redis] = None
_pg_pool: Optional[asyncpg.Pool] = None
_short_mem: Optional[ShortTermMemory] = None
_long_mem: Optional[LongTermMemory] = None


def _build_llm():
    """Construye el LLM según el proveedor configurado."""
    if settings.LLM_PROVIDER == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(base_url=settings.OLLAMA_BASE_URL, model=settings.LLM_MODEL, temperature=0.2)
    elif settings.LLM_PROVIDER == "groq" and settings.GROQ_API_KEY:
        from langchain_groq import ChatGroq
        return ChatGroq(api_key=settings.GROQ_API_KEY, model=settings.LLM_MODEL, temperature=0.2)
    elif settings.LLM_PROVIDER == "openai" and settings.OPENAI_API_KEY:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(api_key=settings.OPENAI_API_KEY, model=settings.LLM_MODEL, temperature=0.2)
    elif settings.LLM_PROVIDER == "anthropic" and settings.ANTHROPIC_API_KEY:
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(api_key=settings.ANTHROPIC_API_KEY, model="claude-haiku-4-5-20251001", temperature=0.2)
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _redis, _pg_pool, _short_mem, _long_mem

    _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    _short_mem = ShortTermMemory(_redis)

    if settings.DATABASE_URL:
        try:
            _pg_pool = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=5)
            _long_mem = LongTermMemory(_pg_pool)
            set_db_pool(_pg_pool)
            print("✅ PostgreSQL pool listo")
        except Exception as e:
            print(f"⚠ PostgreSQL no disponible: {e}")

    if not retriever.load_index():
        print("Construyendo índice FAISS desde /app/knowledge...")
        retriever.build_index()

    app.state.llm = _build_llm()
    print(f"✅ LLM: {settings.LLM_PROVIDER} / {settings.LLM_MODEL}")
    yield

    if _redis:
        await _redis.aclose()
    if _pg_pool:
        await _pg_pool.close()


app = FastAPI(
    title="ClinAI RAG Agent",
    version="1.0.0",
    description="Agente RAG Clínico — FAISS + BM25 + LLM + Tools",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

SYSTEM_PROMPT = """Eres un asistente clínico especializado en diabetes y retinopatía diabética.
Tienes acceso a una base de conocimiento clínica con guías y literatura médica.

Instrucciones de respuesta:
- Responde DIRECTAMENTE a la pregunta clínica, comenzando de inmediato con la información solicitada.
- Basa tus respuestas en el "Contexto clínico relevante" proporcionado y cita sus datos literalmente.
- No añadas introducciones, preambles ni frases como "Como asistente clínico..." — ve al punto.
- Nunca inventes datos numéricos, clasificaciones ni criterios — cítalos del contexto.
- Si el contexto no cubre la pregunta completamente, usa el conocimiento clínico estándar indicándolo.
- Respuestas concisas y estructuradas (listas o párrafos cortos según corresponda).
- Nunca reveles PII completa de pacientes en tus respuestas.

Normativa aplicable: Resolución 866/2021, Ley 1581/2012, Resolución 1995/1999.
"""


def _decode_token(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token de autenticación requerido")
    token = authorization[7:]
    if not settings.JWT_SECRET:
        raise HTTPException(status_code=503, detail="Servicio de autenticación no configurado")
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


async def _require_medico(authorization: Optional[str]) -> str:
    """Returns doctor user_id. Only MEDICO role is allowed to chat with the agent."""
    payload = _decode_token(authorization)
    if payload.get("role") != "MEDICO":
        raise HTTPException(
            status_code=403,
            detail="Solo los médicos pueden interactuar con el agente clínico",
        )
    return payload["sub"]


async def _require_medico_or_admin(authorization: Optional[str]) -> dict:
    """Returns payload. MEDICO and ADMIN roles allowed (for RAGAS/read endpoints)."""
    payload = _decode_token(authorization)
    if payload.get("role") not in ("MEDICO", "ADMIN"):
        raise HTTPException(status_code=403, detail="Acceso denegado")
    return payload


async def _check_patient_assignment(doctor_id: str, patient_id: str):
    """Verify this doctor has the patient assigned. Blocks access if not."""
    if _pg_pool is None:
        return
    async with _pg_pool.acquire() as conn:
        assigned = await conn.fetchval(
            "SELECT 1 FROM patient_assignments WHERE patient_id=$1::uuid AND doctor_id=$2::uuid",
            patient_id, doctor_id,
        )
        if not assigned:
            raise HTTPException(
                status_code=403,
                detail="No tiene acceso a este paciente. Solo puede consultar pacientes que tenga asignados.",
            )


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    patient_id: Optional[str] = None
    rag_mode: str = "agentic"  # naive | hybrid | rerank | agentic


class ChatResponse(BaseModel):
    answer: str
    session_id: str
    sources: list[str] = []
    contexts: list[str] = []
    rag_mode: str


@app.get("/health")
async def health():
    return {"status": "ok", "service": "rag-agent", "version": "1.0.0"}


@app.post("/agent/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, authorization: Optional[str] = Header(None, alias="Authorization")):
    """
    Endpoint principal del agente RAG.
    Solo accesible para usuarios con rol MEDICO.
    Si se provee patient_id, se verifica que el médico tenga ese paciente asignado.
    """
    doctor_id = await _require_medico(authorization)

    if body.patient_id:
        await _check_patient_assignment(doctor_id, body.patient_id)

    client_ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")
    sanitize_input(body.message, user_id=doctor_id, ip=client_ip)
    session_id = body.session_id or str(uuid.uuid4())

    history = await _short_mem.get_history(session_id) if _short_mem else []

    long_context = ""
    if _long_mem and body.patient_id:
        summaries = await _long_mem.get_summaries(body.patient_id, query=body.message)
        if summaries:
            long_context = "\n".join(f"- {s}" for s in summaries)

    # Datos FHIR del paciente en tiempo real (todos los modos)
    fhir_context = ""
    if body.patient_id:
        fhir_context = await _fetch_patient_context(body.patient_id)

    # Recuperación RAG
    rag_mode = body.rag_mode
    retrieved = retriever.retrieve(body.message, k=8, mode="naive" if rag_mode == "naive" else "hybrid")
    sources = list({r["source"] for r in retrieved})
    rag_context = "\n\n".join(r["text"][:800] for r in retrieved) if retrieved else ""

    llm = app.state.llm

    if llm is None:
        answer = _fallback_response(body.message, rag_context, retrieved, fhir_context)
    elif rag_mode == "agentic":
        answer = await _agentic_response(llm, body.message, history, body.patient_id, rag_context, long_context, fhir_context)
    else:
        answer = await _standard_response(llm, body.message, history, rag_context, long_context, fhir_context)

    answer = mask_pii(answer)

    if _short_mem:
        await _short_mem.add_turn(session_id, "user", body.message)
        await _short_mem.add_turn(session_id, "assistant", answer)

    if _long_mem and body.patient_id and len(history) >= 10:
        summary = f"Consulta sobre: {body.message[:100]} | Respuesta: {answer[:200]}"
        await _long_mem.save_summary(body.patient_id, summary)

    contexts = [r["text"][:1200] for r in retrieved] if retrieved else []
    return ChatResponse(answer=answer, session_id=session_id, sources=sources, contexts=contexts, rag_mode=rag_mode)


async def _standard_response(llm, message: str, history: list, rag_context: str, long_context: str,
                              fhir_context: str = "") -> str:
    """Naive / Advanced RAG: LLM con contexto recuperado."""
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    messages = [SystemMessage(content=SYSTEM_PROMPT)]

    if fhir_context:
        messages.append(SystemMessage(content=fhir_context))
    if long_context:
        messages.append(SystemMessage(content=f"Historial previo del paciente:\n{long_context}"))
    if rag_context:
        messages.append(SystemMessage(content=f"Contexto clínico relevante:\n{rag_context}"))

    for turn in history[-10:]:
        if turn["role"] == "user":
            messages.append(HumanMessage(content=turn["content"]))
        else:
            messages.append(AIMessage(content=turn["content"]))

    messages.append(HumanMessage(content=message))

    try:
        response = await llm.ainvoke(messages)
        return response.content
    except Exception as e:
        err = str(e)
        if "429" in err or "rate_limit" in err.lower() or "rate limit" in err.lower():
            import re
            retry_match = re.search(r"try again in (\d+m[\d.]+s|\d+[\d.]+s)", err)
            retry_info = f" Intenta de nuevo en {retry_match.group(1)}." if retry_match else " Intenta de nuevo en unos minutos."
            return (
                f"⚠ El servicio de IA alcanzó el límite de uso temporalmente.{retry_info}\n\n"
                f"Mientras tanto, aquí está el contexto clínico recuperado:\n\n{rag_context[:600] if rag_context else 'No hay contexto disponible.'}"
            )
        return f"Error del LLM: {e}. Contexto disponible: {rag_context[:300] if rag_context else 'Ninguno.'}"


async def _agentic_response(llm, message: str, history: list, patient_id: Optional[str],
                             rag_context: str, long_context: str, fhir_context: str = "") -> str:
    """Agentic RAG con tool calling nativo (compatible con Groq/OpenAI/Anthropic)."""
    from langchain.agents import AgentExecutor, create_tool_calling_agent
    from langchain_core.prompts import ChatPromptTemplate

    patient_section = fhir_context if fhir_context else f"Paciente activo ID: {patient_id or 'no especificado'}"

    system = f"""Eres un asistente clínico especializado en diabetes y retinopatía diabética.
Tienes acceso a herramientas reales — ÚSALAS para responder, no inventes datos.

{patient_section}

Contexto RAG: {rag_context[:600] if rag_context else 'Sin contexto adicional'}
{"Historial previo: " + long_context[:400] if long_context else ""}

Reglas de uso de herramientas:
- Si necesitas datos adicionales del paciente o actualizarlos → query_fhir con patient_id="{patient_id or ''}"
- "reporte", "riesgo", "resultado ML", "resultado DL", "predicción" → query_risk_reports con patient_id="{patient_id or ''}"
- "predecir diabetes", "modelo ML", "XGBoost" → invoke_ml_model
- "retinopatía", "fondo de ojo", "modelo DL", "EfficientNet" → invoke_dl_model
- "crear reporte", "generar informe FHIR" → create_fhir_report
- preguntas clínicas generales → search_clinical_docs
- Responde siempre en español con lenguaje clínico preciso."""

    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])

    try:
        agent = create_tool_calling_agent(llm, AGENT_TOOLS, prompt)
        executor = AgentExecutor(agent=agent, tools=AGENT_TOOLS, verbose=False,
                                  max_iterations=6, handle_parsing_errors=True)
        result = await executor.ainvoke({"input": message})
        return result.get("output", "Sin respuesta del agente.")
    except Exception as e:
        return await _standard_response(llm, message, history, rag_context, long_context, fhir_context)


LOINC_DISPLAY = {
    "2339-0":   "Glucosa",
    "4548-4":   "HbA1c",
    "55284-4":  "Presión arterial",
    "8480-6":   "PA sistólica",
    "8462-4":   "PA diastólica",
    "39156-5":  "IMC",
    "39106-0":  "Pliegue cutáneo",
    "33914-3":  "TFGe (creatinina)",
    "14749-6":  "Glucosa (ayunas)",
    "11996-6":  "Insulina sérica",
    "21612-7":  "Edad",
}


async def _fetch_patient_context(patient_id: str) -> str:
    """Obtiene datos del paciente desde la BD local (PostgreSQL) e inyecta contexto clínico real."""
    if _pg_pool is None:
        return f"Paciente ID {patient_id} — BD no disponible."

    parts = []
    try:
        async with _pg_pool.acquire() as conn:
            # Datos demográficos
            pat = await conn.fetchrow(
                "SELECT name, birth_date, document_type FROM patients WHERE id=$1::uuid AND deleted_at IS NULL",
                patient_id,
            )
            if pat is None:
                return f"Paciente ID {patient_id} — No encontrado en el sistema."
            parts.append(
                f"Paciente: {pat['name']} | Tipo doc: {pat['document_type']} | "
                f"Fecha nac.: {str(pat['birth_date'])}"
            )

            # Observaciones LOINC
            obs_rows = await conn.fetch(
                """SELECT loinc_code, value, unit, created_at
                   FROM observations
                   WHERE patient_id=$1::uuid AND deleted_at IS NULL
                   ORDER BY created_at DESC LIMIT 20""",
                patient_id,
            )
            if obs_rows:
                obs_lines = []
                for o in obs_rows:
                    display = LOINC_DISPLAY.get(o["loinc_code"], o["loinc_code"])
                    val = float(o["value"]) if o["value"] is not None else "?"
                    date = str(o["created_at"])[:10]
                    obs_lines.append(f"  - {display}: {val} {o['unit'] or ''} ({date})")
                parts.append("Observaciones clínicas (LOINC):\n" + "\n".join(obs_lines))

            # Reportes de riesgo ML/DL — descifrar prediction_enc (fuente autoritativa)
            aes_key = os.getenv("AES_KEY", "")
            risk_rows = await conn.fetch(
                """SELECT model_type, is_critical, doctor_action, created_at,
                          CASE WHEN prediction_enc IS NOT NULL AND $2 != ''
                               THEN pgp_sym_decrypt(prediction_enc, $2)
                               ELSE NULL END AS pred_dec,
                          risk_score, risk_category
                   FROM risk_reports
                   WHERE patient_id=$1::uuid AND deleted_at IS NULL
                   ORDER BY created_at DESC LIMIT 5""",
                patient_id, aes_key,
            )
            if risk_rows:
                risk_lines = []
                for r in risk_rows:
                    import json as _json
                    if r["pred_dec"]:
                        try:
                            pred = _json.loads(r["pred_dec"])
                            score = pred.get("score")
                            category = pred.get("category", "?")
                        except Exception:
                            score = r["risk_score"]
                            category = r["risk_category"] or "?"
                    else:
                        score = r["risk_score"]
                        category = r["risk_category"] or "?"
                    critical = " ⚠ CRÍTICO" if r["is_critical"] else ""
                    action = r["doctor_action"] or "Pendiente revisión"
                    date = str(r["created_at"])[:10]
                    score_str = f"{float(score):.3f}" if score is not None else "N/D"
                    risk_lines.append(
                        f"  - [{date}] {r['model_type']}: score={score_str} | "
                        f"{category}{critical} | Acción médico: {action}"
                    )
                parts.append("Reportes de riesgo clínico:\n" + "\n".join(risk_lines))

    except Exception as e:
        return f"Paciente ID {patient_id} — Error al obtener datos: {e}"

    return f"=== DATOS CLÍNICOS DEL PACIENTE (ID: {patient_id}) ===\n" + "\n\n".join(parts)


def _fallback_response(message: str, rag_context: str, retrieved: list, fhir_context: str = "") -> str:
    """Respuesta sin LLM configurado — solo recuperación RAG + datos FHIR disponibles."""
    sections = []
    if fhir_context:
        sections.append(fhir_context)
    if not retrieved:
        msg = "No hay LLM configurado. Configure GROQ_API_KEY o OPENAI_API_KEY en las variables de entorno."
        if not fhir_context:
            msg += " Tampoco se encontró contexto relevante en la base de conocimiento."
        return msg if not sections else "\n\n".join(sections) + f"\n\n{msg}"
    top = retrieved[0]["text"][:800]
    source = retrieved[0]["source"]
    sections.append(
        f"[Sin LLM — respuesta basada en recuperación RAG]\n\n"
        f"Contexto más relevante encontrado en '{source}':\n\n{top}\n\n"
        f"Para respuestas generativas, configure un proveedor LLM."
    )
    return "\n\n".join(sections)


@app.delete("/agent/session/{session_id}", status_code=204)
async def clear_session(session_id: str):
    if _short_mem:
        await _short_mem.clear(session_id)


@app.post("/agent/index/rebuild", status_code=202)
async def rebuild_index():
    """Reconstruye el índice FAISS desde los documentos en /app/knowledge."""
    retriever.build_index()
    return {"status": "rebuilding", "chunks": len(retriever._chunks)}


@app.get("/agent/index/status")
async def index_status():
    return {
        "loaded": retriever._loaded,
        "chunks": len(retriever._chunks),
        "has_faiss": retriever._index is not None,
        "has_bm25": retriever._bm25 is not None,
    }


_ragas_running = False


@app.post("/agent/ragas/run", status_code=202)
async def ragas_run(background_tasks: BackgroundTasks, authorization: Optional[str] = Header(None, alias="Authorization")):
    """Lanza la evaluación RAGAS en segundo plano. Solo MEDICO o ADMIN."""
    await _require_medico_or_admin(authorization)
    global _ragas_running
    if _ragas_running:
        raise HTTPException(status_code=409, detail="Evaluación RAGAS ya en curso.")
    background_tasks.add_task(_run_ragas_eval)
    return {"status": "started", "message": "Evaluación RAGAS iniciada. Consulte /agent/ragas/report cuando termine."}


async def _run_ragas_eval():
    """Ejecuta ragas_eval.py como subproceso y guarda ragas_report.json."""
    global _ragas_running
    import asyncio
    _ragas_running = True
    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            "python", "/app/ragas_eval.py",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=1200)
        if proc.returncode != 0:
            print(f"RAGAS eval error: {stderr.decode()[:500]}")
        else:
            print("RAGAS eval completado.")
    except asyncio.TimeoutError:
        print("RAGAS eval timeout (20 min) — abortando.")
        if proc:
            proc.kill()
    except Exception as e:
        print(f"Error lanzando RAGAS eval: {e}")
    finally:
        _ragas_running = False


@app.get("/agent/ragas/status")
async def ragas_status(authorization: Optional[str] = Header(None, alias="Authorization")):
    """Retorna si hay una evaluación RAGAS en curso. Solo MEDICO o ADMIN."""
    await _require_medico_or_admin(authorization)
    return {"running": _ragas_running}


@app.get("/agent/ragas/report")
async def ragas_report(authorization: Optional[str] = Header(None, alias="Authorization")):
    """Sirve el reporte RAGAS generado por ragas_eval.py. Solo MEDICO o ADMIN."""
    await _require_medico_or_admin(authorization)
    import json
    from pathlib import Path

    report_path = Path("/app/ragas_report.json")
    if not report_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Reporte RAGAS no disponible. Ejecute la evaluación desde el botón o con python ragas_eval.py.",
        )
    with open(report_path) as f:
        data = json.load(f)

    thresholds = {
        "faithfulness":      {"min": 0.75, "ideal": 0.85},
        "answer_relevancy":  {"min": 0.70, "ideal": 0.80},
        "context_precision": {"min": 0.65, "ideal": 0.75},
        "context_recall":    {"min": 0.65, "ideal": 0.75},
    }

    # Soporte para formato de ragas_eval.py: {"metrics": {...}, "total_questions": N}
    raw_metrics = data.get("metrics", data)
    total = data.get("total_questions", 30)

    def _safe_float(v, default=0.0) -> float:
        """Convierte a float seguro para JSON (reemplaza NaN/Inf con default)."""
        import math
        try:
            f = float(v)
            return default if (math.isnan(f) or math.isinf(f)) else f
        except (TypeError, ValueError):
            return default

    summary = {}
    for m, thresh in thresholds.items():
        score = _safe_float(raw_metrics.get(m, 0.0))
        summary[m] = {
            "score": round(score, 4),
            "threshold": thresh,
            "pass": score >= thresh["min"],
        }

    return {
        "summary": summary,
        "total_questions": total,
        "penalization_risk": data.get("penalization_risk", summary["faithfulness"]["score"] < 0.75),
        "running": _ragas_running,
    }
