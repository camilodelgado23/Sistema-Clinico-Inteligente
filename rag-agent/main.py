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
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
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
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = """Eres un asistente clínico especializado en diabetes y retinopatía diabética.
Tienes acceso a datos de pacientes via FHIR R4, modelos de IA calibrados (ML/DL) y una base de
conocimiento clínica con guías y literatura médica.

Principios:
1. Basa tus respuestas en evidencia clínica y datos reales del paciente cuando estén disponibles.
2. Nunca inventes datos — si no tienes información, indícalo claramente.
3. Usa lenguaje clínico preciso pero comprensible para el médico.
4. Cita las fuentes cuando uses la base de conocimiento.
5. Para diagnósticos definitivos, indica que son de apoyo y requieren criterio médico.
6. Nunca reveles PII completa de pacientes en tus respuestas.

Normativa aplicable: Resolución 866/2021, Ley 1581/2012, Resolución 1995/1999.
"""


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    patient_id: Optional[str] = None
    rag_mode: str = "hybrid"  # naive | hybrid | rerank | agentic


class ChatResponse(BaseModel):
    answer: str
    session_id: str
    sources: list[str] = []
    rag_mode: str


@app.get("/health")
async def health():
    return {"status": "ok", "service": "rag-agent", "version": "1.0.0"}


@app.post("/agent/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    """
    Endpoint principal del agente RAG.
    Soporta: Naive, Advanced, Modular, Agentic RAG.
    """
    sanitize_input(body.message)
    session_id = body.session_id or str(uuid.uuid4())

    history = await _short_mem.get_history(session_id) if _short_mem else []

    long_context = ""
    if _long_mem and body.patient_id:
        summaries = await _long_mem.get_summaries(body.patient_id, query=body.message)
        if summaries:
            long_context = "\n".join(f"- {s}" for s in summaries)

    # Recuperación RAG
    rag_mode = body.rag_mode
    retrieved = retriever.retrieve(body.message, k=5, mode="naive" if rag_mode == "naive" else "hybrid")
    sources = list({r["source"] for r in retrieved})
    rag_context = "\n\n".join(r["text"][:600] for r in retrieved) if retrieved else ""

    llm = app.state.llm

    if llm is None:
        answer = _fallback_response(body.message, rag_context, retrieved)
    elif rag_mode == "agentic":
        answer = await _agentic_response(llm, body.message, history, body.patient_id, rag_context, long_context)
    else:
        answer = await _standard_response(llm, body.message, history, rag_context, long_context)

    answer = mask_pii(answer)

    if _short_mem:
        await _short_mem.add_turn(session_id, "user", body.message)
        await _short_mem.add_turn(session_id, "assistant", answer)

    if _long_mem and body.patient_id and len(history) >= 10:
        summary = f"Consulta sobre: {body.message[:100]} | Respuesta: {answer[:200]}"
        await _long_mem.save_summary(body.patient_id, summary)

    return ChatResponse(answer=answer, session_id=session_id, sources=sources, rag_mode=rag_mode)


async def _standard_response(llm, message: str, history: list, rag_context: str, long_context: str) -> str:
    """Naive / Advanced RAG: LLM con contexto recuperado."""
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    messages = [SystemMessage(content=SYSTEM_PROMPT)]

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
        return f"Error del LLM: {e}. Contexto disponible: {rag_context[:300] if rag_context else 'Ninguno.'}"


async def _agentic_response(llm, message: str, history: list, patient_id: Optional[str],
                             rag_context: str, long_context: str) -> str:
    """Agentic RAG con tool calling nativo (compatible con Groq/OpenAI/Anthropic)."""
    from langchain.agents import AgentExecutor, create_tool_calling_agent
    from langchain_core.prompts import ChatPromptTemplate

    system = f"""Eres un asistente clínico especializado en diabetes y retinopatía diabética.
Tienes acceso a herramientas reales — ÚSALAS para responder, no inventes datos.

Paciente activo ID: {patient_id or 'no especificado'}
Contexto RAG: {rag_context[:600] if rag_context else 'Sin contexto adicional'}
{"Historial previo: " + long_context[:400] if long_context else ""}

Reglas de uso de herramientas (OBLIGATORIAS):
- "reporte", "riesgo", "resultado ML", "resultado DL", "predicción" → llama a query_risk_reports con patient_id="{patient_id or ''}"
- "observaciones", "glucosa", "historial FHIR", "laboratorios" → llama a query_fhir con patient_id="{patient_id or ''}"
- "predecir diabetes", "modelo ML", "XGBoost" → llama a invoke_ml_model
- "retinopatía", "fondo de ojo", "modelo DL", "EfficientNet" → llama a invoke_dl_model
- "crear reporte", "generar informe FHIR" → llama a create_fhir_report
- preguntas clínicas generales sin datos de paciente → llama a search_clinical_docs
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
        return await _standard_response(llm, message, history, rag_context, long_context)


def _fallback_response(message: str, rag_context: str, retrieved: list) -> str:
    """Respuesta sin LLM configurado — solo recuperación RAG."""
    if not retrieved:
        return ("No hay LLM configurado. Configure GROQ_API_KEY o OPENAI_API_KEY en las variables de entorno. "
                "Tampoco se encontró contexto relevante en la base de conocimiento.")
    top = retrieved[0]["text"][:800]
    source = retrieved[0]["source"]
    return (f"[Sin LLM — respuesta basada en recuperación RAG]\n\n"
            f"Contexto más relevante encontrado en '{source}':\n\n{top}\n\n"
            f"Para respuestas generativas, configure un proveedor LLM.")


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
