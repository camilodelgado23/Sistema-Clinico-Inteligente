"""
routers/auth.py — Login, Logout, Habeas Data consent
"""
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncpg

from core.config import get_db
from core.auth import (
    validate_api_keys, create_access_token,
    blacklist_token, bearer_scheme, require_authenticated
)
from core.audit import log_audit

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: str
    patient_id: Optional[str] = None
    needs_habeas_data: bool


@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    user: dict = Depends(validate_api_keys),
    db: asyncpg.Connection = Depends(get_db),
):
    token = create_access_token(str(user["id"]), user["role"])

    # ── 🔥 Obtener patient_id si es PACIENTE ───────────────────────
    patient_id = None
    if user["role"] == "PACIENTE":
        row = await db.fetchrow(
            """
            SELECT id
            FROM patients
            WHERE patient_user_id = $1::uuid
              AND deleted_at IS NULL
            """,
            str(user["id"]),
        )
        if row:
            patient_id = str(row["id"])

    # ── Habeas Data ───────────────────────────────────────────────
    consent_row = await db.fetchrow(
        "SELECT id FROM consent WHERE user_id = $1::uuid",
        str(user["id"]),
    )
    needs_habeas = consent_row is None

    ip = request.client.host if request.client else None
    await log_audit(
        db, str(user["id"]), user["role"],
        "LOGIN", "User", str(user["id"]), ip
    )

    return LoginResponse(
        access_token=token,
        role=user["role"],
        user_id=str(user["id"]),
        patient_id=patient_id,   # 👈 NUEVO
        needs_habeas_data=needs_habeas,
    )

@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    credentials=Depends(bearer_scheme),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    blacklist_token(credentials.credentials)
    ip = request.client.host if request.client else None
    await log_audit(db, str(user["id"]), user["role"], "LOGOUT", "User",
                    str(user["id"]), ip)
    return


class HabeasDataRequest(BaseModel):
    policy_version: str = "1.0"


@router.post("/habeas-data", status_code=201)
async def accept_habeas_data(
    request: Request,
    body: HabeasDataRequest,
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Records Habeas Data acceptance (Ley 1581/2012).
    Called once per user after the mandatory modal.
    Also creates FHIR Consent resource.
    """
    ip = request.client.host if request.client else None

    # Check not already accepted
    existing = await db.fetchrow(
        "SELECT id FROM consent WHERE user_id = $1::uuid AND policy_version = $2",
        str(user["id"]), body.policy_version,
    )
    if existing:
        raise HTTPException(status_code=409, detail="Habeas Data ya aceptado")

    row = await db.fetchrow(
        """INSERT INTO consent (user_id, policy_version, ip_address)
           VALUES ($1::uuid, $2, $3::inet)
           RETURNING id, accepted_at""",
        str(user["id"]), body.policy_version, ip,
    )

    await log_audit(db, str(user["id"]), user["role"],
                    "HABEAS_DATA_ACCEPTED", "Consent",
                    str(row["id"]), ip,
                    detail={"policy_version": body.policy_version})

    # Build FHIR Consent resource
    fhir_consent = {
        "resourceType": "Consent",
        "status": "active",
        "scope": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/consentscope",
                               "code": "patient-privacy"}]},
        "category": [{"coding": [{"code": "IDSCL"}]}],
        "patient": {"reference": f"Patient/{user['id']}"},
        "dateTime": row["accepted_at"].isoformat(),
        "policyRule": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3ActCode",
                                   "code": "OPTIN"}]},
        "sourceReference": {"display": f"Política Privacidad v{body.policy_version} — Ley 1581/2012 Colombia"},
    }

    return {"consent_id": str(row["id"]), "accepted_at": row["accepted_at"], "fhir": fhir_consent}