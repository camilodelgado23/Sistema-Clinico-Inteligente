"""
core/memory.py — Memoria corto plazo (Redis) + largo plazo (PostgreSQL).
"""
import json
import uuid
from typing import Optional

import asyncpg
import redis.asyncio as aioredis

MAX_SHORT_TURNS = 20


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
    """Memoria de largo plazo por paciente en PostgreSQL."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def save_summary(self, patient_id: str, summary: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO agent_long_memory (patient_id, summary)
                   VALUES ($1::uuid, $2)""",
                patient_id, summary,
            )

    async def get_summaries(self, patient_id: str, limit: int = 5) -> list[str]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT summary FROM agent_long_memory
                   WHERE patient_id = $1::uuid
                   ORDER BY created_at DESC LIMIT $2""",
                patient_id, limit,
            )
        return [r["summary"] for r in rows]
