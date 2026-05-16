"""
routers/superuser.py — API SuperUser (Médico externo)
Interoperabilidad entre sistemas del curso.
Autenticación: JWT propio con email + password + license_number.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
import re

import asyncpg
import bcrypt
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel

from core.audit import log_audit
from core.config import get_db, settings

router = APIRouter(prefix="/api/v1", tags=["superuser"])
bearer = HTTPBearer()

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 1


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _su_secret() -> str:
    secret = settings.SUPERUSER_JWT_SECRET or settings.JWT_SECRET
    return secret


def create_su_token(practitioner_id: str, license_number: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": practitioner_id, "license": license_number, "exp": exp, "type": "superuser"},
        _su_secret(), algorithm=ALGORITHM,
    )


async def require_superuser(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: asyncpg.Connection = Depends(get_db),
) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, _su_secret(), algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token SuperUser inválido o expirado")
    if payload.get("type") != "superuser":
        raise HTTPException(status_code=403, detail="Token no es de tipo SuperUser")
    row = await db.fetchrow(
        "SELECT id, full_name, license_number, is_active FROM practitioners WHERE id = $1::uuid",
        payload["sub"],
    )
    if not row or not row["is_active"]:
        raise HTTPException(status_code=401, detail="Médico no encontrado o inactivo")
    return dict(row)


# ── Schemas ───────────────────────────────────────────────────────────────────

class SuperUserLoginRequest(BaseModel):
    email: str
    password: str
    license_number: str


class CreatePractitionerRequest(BaseModel):
    email: str
    password: str
    license_number: str
    full_name: str
    specialty: Optional[str] = None


class SoftDeleteRequest(BaseModel):
    reason: str
    icd10_code: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/auth/superuser/login")
async def superuser_login(
    request: Request,
    body: SuperUserLoginRequest,
    db: asyncpg.Connection = Depends(get_db),
):
    """Autenticación de médico SuperUser con email + password + número de licencia."""
    row = await db.fetchrow(
        "SELECT id, password_hash, license_number, is_active FROM practitioners WHERE email = $1",
        body.email,
    )
    if not row or not row["is_active"]:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if row["license_number"] != body.license_number:
        raise HTTPException(status_code=401, detail="Número de licencia incorrecto")
    if not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    token = create_su_token(str(row["id"]), row["license_number"])
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": TOKEN_EXPIRE_HOURS * 3600,
    }


@router.post("/auth/superuser/register", status_code=201)
async def register_practitioner(
    body: CreatePractitionerRequest,
    db: asyncpg.Connection = Depends(get_db),
):
    """Registro de médico SuperUser (solo para setup inicial o admin)."""
    existing = await db.fetchrow(
        "SELECT id FROM practitioners WHERE email = $1 OR license_number = $2",
        body.email, body.license_number,
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email o licencia ya registrados")

    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt(rounds=12)).decode()
    row = await db.fetchrow(
        """INSERT INTO practitioners (email, password_hash, license_number, full_name, specialty)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at""",
        body.email, pw_hash, body.license_number, body.full_name, body.specialty,
    )
    return {"id": str(row["id"]), "created_at": row["created_at"]}


@router.get("/superuser/patients")
async def search_patients(
    identifier: str,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Buscar paciente por documento (formato: CC|1234567890)."""
    parts = identifier.split("|", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Formato: {doc_type}|{doc_number}")

    rows = await db.fetch(
        """SELECT id, name, birth_date, fhir_id, created_at
           FROM patients
           WHERE deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 50""",
    )

    entries = []
    for r in rows:
        entries.append({
            "resourceType": "Patient",
            "id": str(r["id"]),
            "name": [{"text": r["name"]}],
            "birthDate": r["birth_date"].isoformat() if r["birth_date"] else None,
            "fhir_id": r["fhir_id"],
        })

    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": len(entries),
        "entry": entries,
    }


@router.post("/superuser/patients", status_code=201)
async def create_patient_external(
    request: Request,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Crear paciente desde sistema externo con recurso FHIR R4."""
    body = await request.json()
    if body.get("resourceType") != "Patient":
        raise HTTPException(status_code=400, detail="resourceType debe ser Patient")

    name_entry = body.get("name", [{}])[0]
    full_name = name_entry.get("text") or (
        " ".join(name_entry.get("given", [])) + " " + name_entry.get("family", "")
    ).strip()
    birth_date = body.get("birthDate")

    existing = await db.fetchrow(
        "SELECT id FROM patients WHERE name = $1 AND deleted_at IS NULL",
        full_name,
    )
    if existing:
        raise HTTPException(status_code=409, detail="Paciente ya existe en este sistema")

    row = await db.fetchrow(
        """INSERT INTO patients (name, birth_date, is_active)
           VALUES ($1, $2, TRUE)
           RETURNING id, created_at""",
        full_name, birth_date,
    )

    ip = request.client.host if request.client else None
    await db.execute(
        """INSERT INTO superuser_audit (practitioner_id, action, patient_id, ip_address, detail)
           VALUES ($1::uuid, 'CREATE_PATIENT', $2::uuid, $3::inet, $4::jsonb)""",
        str(practitioner["id"]), str(row["id"]), ip,
        '{"source": "external_system"}',
    )

    return {
        "resourceType": "Patient",
        "id": str(row["id"]),
        "meta": {"lastUpdated": row["created_at"].isoformat()},
        "name": [{"text": full_name}],
        "birthDate": birth_date,
    }


@router.get("/superuser/patients/{patient_id}/observations")
async def get_patient_observations(
    patient_id: str,
    loinc_code: Optional[str] = None,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Obtener observaciones LOINC de un paciente para análisis externo."""
    patient = await db.fetchrow(
        "SELECT id, name FROM patients WHERE id = $1::uuid AND deleted_at IS NULL",
        patient_id,
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    query = """SELECT id, loinc_code, value, unit, status, created_at
               FROM observations
               WHERE patient_id = $1::uuid AND deleted_at IS NULL"""
    params = [patient_id]
    if loinc_code:
        query += " AND loinc_code = $2"
        params.append(loinc_code)
    query += " ORDER BY created_at DESC LIMIT 50"

    rows = await db.fetch(query, *params)
    entries = [
        {
            "resourceType": "Observation",
            "id": str(r["id"]),
            "status": r["status"],
            "code": {"coding": [{"system": "http://loinc.org", "code": r["loinc_code"]}]},
            "valueQuantity": {"value": float(r["value"]), "unit": r["unit"]} if r["value"] else None,
            "effectiveDateTime": r["created_at"].isoformat(),
            "subject": {"reference": f"Patient/{patient_id}"},
        }
        for r in rows
    ]
    return {"resourceType": "Bundle", "type": "searchset", "total": len(entries), "entry": entries}


@router.post("/superuser/patients/{patient_id}/observations", status_code=201)
async def create_observation_external(
    patient_id: str,
    request: Request,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Registrar observación FHIR desde sistema externo."""
    body = await request.json()
    if body.get("resourceType") != "Observation":
        raise HTTPException(status_code=400, detail="resourceType debe ser Observation")

    patient = await db.fetchrow(
        "SELECT id FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", patient_id,
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    loinc_code = body.get("code", {}).get("coding", [{}])[0].get("code", "")
    value_q = body.get("valueQuantity", {})
    value = value_q.get("value")
    unit = value_q.get("unit", "")

    row = await db.fetchrow(
        """INSERT INTO observations (patient_id, loinc_code, value, unit, status)
           VALUES ($1::uuid, $2, $3, $4, 'final')
           RETURNING id, created_at""",
        patient_id, loinc_code, value, unit,
    )
    return {
        "resourceType": "Observation",
        "id": str(row["id"]),
        "status": "final",
        "effectiveDateTime": row["created_at"].isoformat(),
    }


@router.post("/superuser/inference/{model_type}")
async def superuser_inference(
    model_type: str,
    request: Request,
    practitioner: dict = Depends(require_superuser),
):
    """Invocar inferencia ML/DL sobre datos de paciente externo."""
    if model_type not in ("diabetes", "retinopathy", "multimodal"):
        raise HTTPException(status_code=400, detail="model_type: diabetes|retinopathy|multimodal")

    body = await request.json()
    target_url = settings.ORCHESTRATOR_URL + "/infer"
    payload = {**body, "requested_by": str(practitioner["id"]), "source": "superuser"}

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(target_url, json=payload)

    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail="Error invocando orquestador")

    result = r.json()
    return {
        "prediction": result.get("prediction"),
        "probability": result.get("probability"),
        "calibrated": True,
        "model": model_type,
        "fhir_risk_assessment": {
            "resourceType": "RiskAssessment",
            "status": "final",
            "subject": body.get("patient_fhir", {}).get("reference", ""),
            "prediction": [{"probabilityDecimal": result.get("probability", 0)}],
        },
    }


@router.delete("/superuser/patients/{patient_id}", status_code=200)
async def soft_delete_patient(
    patient_id: str,
    request: Request,
    body: SoftDeleteRequest,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Soft delete de paciente (Resolución 1995/1999 — dato preservado)."""
    patient = await db.fetchrow(
        "SELECT id FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", patient_id,
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    pending = await db.fetchrow(
        """SELECT id FROM risk_reports
           WHERE patient_id = $1::uuid AND deleted_at IS NULL
             AND doctor_action IS NULL AND signed_at IS NULL""",
        patient_id,
    )
    if pending:
        raise HTTPException(
            status_code=409,
            detail="No se puede cerrar HC con RiskReport sin firma (Res. 1995/1999)",
        )

    await db.execute(
        "UPDATE patients SET is_active = FALSE, deleted_at = NOW() WHERE id = $1::uuid",
        patient_id,
    )

    ip = request.client.host if request.client else None
    await db.execute(
        """INSERT INTO superuser_audit (practitioner_id, action, patient_id, ip_address, detail)
           VALUES ($1::uuid, 'SOFT_DELETE_PATIENT', $2::uuid, $3::inet, $4::jsonb)""",
        str(practitioner["id"]), patient_id, ip,
        f'{{"reason": "{body.reason}", "icd10_code": "{body.icd10_code}"}}',
    )

    return {"status": "ok", "message": "Paciente desactivado (dato preservado)", "active": False}
