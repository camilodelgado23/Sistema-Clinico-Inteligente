"""
backend/main.py — FastAPI app principal
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
import httpx
import asyncpg

from core.config import settings, get_pool, close_pool, get_db
from core.auth import require_medico
from routers.auth import router as auth_router
from routers.fhir import router as fhir_router
from routers.admin import router as admin_router
from routers.superuser import router as superuser_router

limiter = Limiter(key_func=get_remote_address, default_limits=["500/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: crea pool y aplica migraciones
    pool = await get_pool()
    from core.migrations import MIGRATION_SQL
    async with pool.acquire() as conn:
        await conn.execute(MIGRATION_SQL)
    print("✅ DB pool listo, migraciones aplicadas")
    yield
    await close_pool()
    print("✅ DB pool cerrado")


app = FastAPI(
    title="ClinAI Backend — Proyecto 2",
    version="2.0.0",
    description="FastAPI + FHIR R4 + Doble API-Key + RBAC + AES-256",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(fhir_router)
app.include_router(admin_router)
app.include_router(superuser_router)

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["infra"])
async def health():
    return {"status": "ok", "service": "backend", "version": "2.0.0"}

# ── Proxy a orquestador (rate-limited) ────────────────────────────────────────

@app.post("/infer", tags=["inference"])
@limiter.limit("10/minute")
async def request_inference(
    request: Request,
    user: dict = Depends(require_medico),
):
    """Proxy al orquestador. Rate-limit: 10 inferencias/min/key."""
    body = await request.json()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{settings.ORCHESTRATOR_URL}/infer",
            json={**body, "requested_by": str(user["id"])},
        )
    return r.json()


@app.get("/infer/{task_id}", tags=["inference"])
async def get_inference_status(
    task_id: str,
    user: dict = Depends(require_medico),
):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{settings.ORCHESTRATOR_URL}/infer/{task_id}")
    return r.json()


# ── NUEVO ENDPOINT: RESULT ────────────────────────────────────────────────────

@app.get("/infer/{task_id}/result", tags=["inference"])
async def get_inference_result(
    task_id: str,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),  # ✅ FIX: get_db no get_pool
):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{settings.ORCHESTRATOR_URL}/infer/{task_id}")
    task = r.json()

    # Si no está listo, devolver estado tal cual
    if task.get("status") != "DONE" or not task.get("result_id"):
        return task

    result_id = task["result_id"]

    row = await db.fetchrow(
        """SELECT id, patient_id, model_type, risk_score, risk_category,
                  is_critical, shap_json, gradcam_url, original_url,
                  doctor_action, signed_at, created_at,
                  CASE WHEN prediction_enc IS NOT NULL
                       THEN pgp_sym_decrypt(prediction_enc, $2)
                       ELSE NULL END AS pred_decrypted,
                  CASE WHEN shap_enc IS NOT NULL
                       THEN pgp_sym_decrypt(shap_enc, $2)
                       ELSE NULL END AS shap_decrypted
           FROM risk_reports
           WHERE id = $1::uuid AND deleted_at IS NULL""",
        result_id, settings.AES_KEY,
    )

    if not row:
        return task

    import json as _json

    # Descifrar diagnóstico desde prediction_enc (fuente autoritativa)
    pred_raw = row["pred_decrypted"]
    if pred_raw:
        try:
            pred = _json.loads(pred_raw)
            risk_score_val = pred.get("score")
            risk_category_val = pred.get("category", "LOW")
        except Exception:
            risk_score_val = float(row["risk_score"]) if row["risk_score"] else None
            risk_category_val = row["risk_category"] or "LOW"
    else:
        risk_score_val = float(row["risk_score"]) if row["risk_score"] else None
        risk_category_val = row["risk_category"] or "LOW"

    # Descifrar SHAP desde shap_enc (fuente autoritativa)
    shap_raw = row["shap_decrypted"]
    if shap_raw:
        try:
            shap_values = _json.loads(shap_raw)
        except Exception:
            shap_values = None
    elif row["shap_json"]:
        try:
            shap_values = _json.loads(row["shap_json"])
        except Exception:
            shap_values = row["shap_json"]
    else:
        shap_values = None

    dl_metadata = None
    ml_metadata = None
    if isinstance(shap_values, dict):
        dl_metadata = shap_values.get("_dl")
        ml_metadata = shap_values.get("_ml")

    snomed_map = {
        "LOW": "281414001",
        "MEDIUM": "281415000",
        "HIGH": "281416004",
        "CRITICAL": "24484000",
    }

    cat = risk_category_val

    return {
        **task,
        "result": {
            "id":            str(row["id"]),
            "patient_id":    str(row["patient_id"]),
            "model_type":    row["model_type"],
            "risk_score":    risk_score_val,
            "risk_category": risk_category_val,
            "is_critical":   row["is_critical"],
            "shap_values":   shap_values,
            "dl_metadata":   dl_metadata,
            "ml_metadata":   ml_metadata,
            "gradcam_url":   row["gradcam_url"],
            "original_url":  row["original_url"],
            "doctor_action": row["doctor_action"],
            "signed_at":     row["signed_at"].isoformat() if row["signed_at"] else None,
            "prediction": [
                {
                    "probabilityDecimal": risk_score_val,
                    "qualitativeRisk": {
                        "coding": [
                            {
                                "system": "http://snomed.info/sct",
                                "code": snomed_map.get(cat, "281414001"),
                                "display": cat,
                            }
                        ]
                    },
                }
            ],
        },
    }