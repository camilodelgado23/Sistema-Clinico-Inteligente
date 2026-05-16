"""
core/crypto.py — AES-256 encryption via pgcrypto
Uses PostgreSQL's pgcrypto.encrypt / pgcrypto.decrypt so keys never
leave the DB connection. The AES_KEY is injected from .env.
"""
import asyncpg
from core.config import settings


async def encrypt_value(db: asyncpg.Connection, plaintext: str) -> bytes:
    """Encrypt a string value using pgcrypto AES-256. Returns bytea."""
    row = await db.fetchrow(
        "SELECT pgp_sym_encrypt($1, $2) AS enc",
        plaintext,
        settings.AES_KEY,
    )
    return row["enc"]


async def decrypt_value(db: asyncpg.Connection, ciphertext: bytes) -> str:
    """Decrypt a bytea value using pgcrypto. Returns plaintext string."""
    row = await db.fetchrow(
        "SELECT pgp_sym_decrypt($1, $2) AS dec",
        ciphertext,
        settings.AES_KEY,
    )
    return row["dec"]