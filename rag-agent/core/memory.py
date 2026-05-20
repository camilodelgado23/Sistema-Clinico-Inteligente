"""
core/memory.py — Memoria corto plazo (Redis) + largo plazo (PostgreSQL + embeddings).
"""
import json
import uuid
from typing import Optional

import asyncpg
import numpy as np
import redis.asyncio as aioredis

MAX_SHORT_TURNS = 20


def _get_embedder():
    from core.retriever import retriever
    return retriever._embedder_lazy()


def _encode(text: str) -> bytes:
    vec = _get_embedder().encode([text], normalize_embeddings=True)[0].astype(np.float32)
    return vec.tobytes()


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


class ShortTermMemory:
    """Memoria de sesión en Redis — historial de la conversación activa."""

    def __init__(self, redis_client: aioredis.Redis):
        self._r = redis_client

    def _key(self, session_id: str) -> str:
        return f"agent:session:{session_id}"

    async def get_history(self, session_id: str) -> list[dict]:
        raw = await self._r.get(self._key(session_id))
        return json.loads(raw) if raw else []

    async def add_turn(self, session_id: str, role: str, content: str) -> None:
        history = await self.get_history(session_id)
        history.append({"role": role, "content": content})
        if len(history) > MAX_SHORT_TURNS * 2:
            history = history[-(MAX_SHORT_TURNS * 2):]
        await self._r.setex(self._key(session_id), 3600, json.dumps(history))

    async def clear(self, session_id: str) -> None:
        await self._r.delete(self._key(session_id))


class LongTermMemory:
    """
    Memoria de largo plazo por paciente en PostgreSQL.
    Los resúmenes se almacenan junto con su embedding semántico (BYTEA).
    La recuperación usa similitud coseno contra la consulta actual.
    """

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def save_summary(self, patient_id: str, summary: str) -> None:
        embedding_bytes = _encode(summary)
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO agent_long_memory (patient_id, summary, embedding)
                   VALUES ($1::uuid, $2, $3)""",
                patient_id, summary, embedding_bytes,
            )

    async def get_summaries(
        self,
        patient_id: str,
        query: Optional[str] = None,
        limit: int = 5,
    ) -> list[str]:
        """
        Si se proporciona query, recupera los resúmenes más relevantes
        semánticamente. Sin query, devuelve los más recientes.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT summary, embedding FROM agent_long_memory
                   WHERE patient_id = $1::uuid
                   ORDER BY created_at DESC LIMIT 50""",
                patient_id,
            )

        if not rows:
            return []

        if query is None or not any(r["embedding"] for r in rows):
            return [r["summary"] for r in rows[:limit]]

        q_vec = _get_embedder().encode([query], normalize_embeddings=True)[0].astype(np.float32)

        scored = []
        for row in rows:
            if row["embedding"]:
                s_vec = np.frombuffer(bytes(row["embedding"]), dtype=np.float32)
                score = _cosine(q_vec, s_vec)
            else:
                score = 0.0
            scored.append((score, row["summary"]))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [s for _, s in scored[:limit]]
