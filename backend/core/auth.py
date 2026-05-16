"""
core/auth.py — Doble API-Key + JWT + RBAC
Todos los endpoints deben pasar por require_authenticated().
Endpoints de médico usan require_medico().
Endpoints de admin usan require_admin().
"""
from fastapi import Header, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
from typing import Optional
import asyncpg
from typing import Optional


from core.config import settings, get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

# ── Token blacklist (in-memory; swap for Redis in production) ────────────────
_blacklist: set[str] = set()

# ── Password helpers ──────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain[:72], hashed)

# ── JWT helpers ───────────────────────────────────────────────────────────────
def create_access_token(user_id: str, role: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=settings.JWT_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": user_id, "role": role, "exp": exp},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

def blacklist_token(token: str):
    _blacklist.add(token)

# ── Doble API-Key validation ──────────────────────────────────────────────────
async def validate_api_keys(
    x_access_key: str = Header(..., alias="X-Access-Key"),
    x_permission_key: str = Header(..., alias="X-Permission-Key"),
    db: asyncpg.Connection = Depends(get_db),
) -> dict:
    """Validates X-Access-Key + X-Permission-Key. Returns user row."""
    row = await db.fetchrow(
        """SELECT id, username, role, is_active
           FROM users
           WHERE access_key = $1
             AND permission_key = $2
             AND deleted_at IS NULL""",
        x_access_key, x_permission_key,
    )
    if not row:
        raise HTTPException(status_code=401, detail="API Keys inválidas")
    if not row["is_active"]:
        raise HTTPException(status_code=403, detail="Usuario desactivado")
    return dict(row)

# ── JWT bearer validation ─────────────────────────────────────────────────────
async def require_authenticated(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: asyncpg.Connection = Depends(get_db),
) -> dict:
    """Used by SPA — validates JWT Bearer token."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Token requerido")
    token = credentials.credentials
    if token in _blacklist:
        raise HTTPException(status_code=401, detail="Token revocado")
    payload = decode_token(token)
    row = await db.fetchrow(
        "SELECT id, username, role, is_active FROM users WHERE id = $1::uuid AND deleted_at IS NULL",
        payload["sub"],
    )
    if not row or not row["is_active"]:
        raise HTTPException(status_code=401, detail="Usuario no encontrado o inactivo")
    return dict(row)

# ── RBAC decorators ───────────────────────────────────────────────────────────
async def require_medico(user: dict = Depends(require_authenticated)) -> dict:
    if user["role"] not in ("MEDICO", "ADMIN"):
        raise HTTPException(status_code=403, detail="Se requiere rol MEDICO o ADMIN")
    return user

async def require_admin(user: dict = Depends(require_authenticated)) -> dict:
    if user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Se requiere rol ADMIN")
    return user

async def require_paciente_or_above(user: dict = Depends(require_authenticated)) -> dict:
    # Any authenticated user
    return user