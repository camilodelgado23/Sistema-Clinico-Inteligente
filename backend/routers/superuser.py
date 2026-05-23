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
import io as _io
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel

from core.audit import log_audit
from core.auth import require_admin
from core.config import get_db, settings
from core.crypto import encrypt_value, decrypt_value

router = APIRouter(prefix="/api/v1", tags=["superuser"])
bearer = HTTPBearer()

LOINC_DISPLAY = {
    "2339-0":  "Glucosa",
    "55284-4": "Presión arterial",
    "39156-5": "BMI",
    "14749-6": "Insulina",
    "21612-7": "Edad",
    "11996-6": "Embarazos",
    "39106-0": "Grosor de piel",
    "33914-3": "Pedigree diabetes",
}

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 1


# ── MinIO helpers (mirror de fhir.py) ────────────────────────────────────────

def _su_minio_client():
    from minio import Minio
    return Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=False,
    )


def _su_presigned_url(key: str) -> str:
    import boto3
    from botocore.config import Config
    s3 = boto3.client(
        "s3",
        endpoint_url="http://minio:9000",
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.MINIO_BUCKET, "Key": key},
        ExpiresIn=3600,
    )
    # Rewrite internal Docker URL to nginx /minio/ proxy path.
    # nginx sets Host: minio:9000 so the AWS signature stays valid.
    return url.replace("http://minio:9000", "/minio")


# ── Security helper ──────────────────────────────────────────────────────────

async def _require_patient_assigned(
    db: asyncpg.Connection,
    practitioner_id: str,
    patient_id: str,
) -> None:
    """Raises 403 if patient is not assigned to this practitioner.
    All SuperUser patient endpoints must call this before accessing data."""
    assigned = await db.fetchval(
        """SELECT 1 FROM practitioner_assignments
           WHERE practitioner_id = $1::uuid AND patient_id = $2::uuid""",
        practitioner_id, patient_id,
    )
    if not assigned:
        raise HTTPException(
            status_code=403,
            detail="Acceso denegado: paciente no asignado a este médico externo",
        )


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
        """SELECT id,
                  pgp_sym_decrypt(full_name_enc,      $2) AS full_name,
                  pgp_sym_decrypt(license_number_enc, $2) AS license_number,
                  is_active
           FROM practitioners WHERE id = $1::uuid""",
        payload["sub"], settings.AES_KEY,
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


class SignReportRequest(BaseModel):
    action: str           # ACCEPTED | REJECTED
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/auth/superuser/login")
async def superuser_login(
    request: Request,
    body: SuperUserLoginRequest,
    db: asyncpg.Connection = Depends(get_db),
):
    """Autenticación de médico SuperUser con email + password + número de licencia."""
    row = await db.fetchrow(
        """SELECT id, password_hash, license_number_enc, is_active
           FROM practitioners
           WHERE pgp_sym_decrypt(email_enc, $2) = $1""",
        body.email, settings.AES_KEY,
    )
    if not row:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    license_plain = await decrypt_value(db, bytes(row["license_number_enc"]))
    if license_plain != body.license_number:
        raise HTTPException(status_code=401, detail="Número de licencia incorrecto")
    if not row["is_active"]:
        raise HTTPException(status_code=403, detail="Cuenta desactivada. Contacte al administrador.")

    token = create_su_token(str(row["id"]), license_plain)
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": TOKEN_EXPIRE_HOURS * 3600,
    }


@router.post("/auth/superuser/register", status_code=201)
async def register_practitioner(
    body: CreatePractitionerRequest,
    db: asyncpg.Connection = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Registro de médico SuperUser. Requiere rol ADMIN del sistema."""
    existing = await db.fetchrow(
        """SELECT id FROM practitioners
           WHERE pgp_sym_decrypt(email_enc,          $3) = $1
              OR pgp_sym_decrypt(license_number_enc, $3) = $2""",
        body.email, body.license_number, settings.AES_KEY,
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email o licencia ya registrados")

    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt(rounds=12)).decode()
    enc_email   = await encrypt_value(db, body.email)
    enc_name    = await encrypt_value(db, body.full_name)
    enc_license = await encrypt_value(db, body.license_number)
    row = await db.fetchrow(
        """INSERT INTO practitioners (email_enc, password_hash, license_number_enc, full_name_enc, specialty)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at""",
        enc_email, pw_hash, enc_license, enc_name, body.specialty,
    )
    return {"id": str(row["id"]), "created_at": row["created_at"]}


@router.get("/superuser/my-patients")
async def list_assigned_patients(
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Lista todos los pacientes asignados a este médico externo."""
    rows = await db.fetch(
        """SELECT p.id, p.name, p.birth_date, p.fhir_id, p.document_number, p.document_type, p.created_at
           FROM practitioner_assignments pa
           JOIN patients p ON p.id = pa.patient_id
           WHERE pa.practitioner_id = $1::uuid
             AND p.deleted_at IS NULL
           ORDER BY p.name""",
        str(practitioner["id"]),
    )
    entries = []
    for r in rows:
        doc_display = None
        if r["document_number"]:
            try:
                plain = await decrypt_value(db, r["document_number"])
                doc_display = plain[:2] + "****" + plain[-2:] if len(plain) > 4 else "****"
            except Exception:
                doc_display = "****"
        entries.append({
            "resourceType": "Patient",
            "id": str(r["id"]),
            "name": [{"text": r["name"]}],
            "birthDate": r["birth_date"].isoformat() if r["birth_date"] else None,
            "fhir_id": r["fhir_id"],
            "identifier": [
                {
                    "system": f"https://www.datos.gov.co/d/{(r['document_type'] or 'CC').lower()}",
                    "value": doc_display,
                }
            ] if doc_display else [],
        })
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": len(entries),
        "entry": entries,
    }


@router.get("/superuser/patients")
async def search_patients(
    identifier: str,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Buscar paciente por nombre o documento — restringido a pacientes asignados.
    Formatos:
      - "Juan Pérez"   → nombre (ILIKE)
      - "CC|12345678"  → tipo|número exacto
      - "12345678"     → número si es dígitos; nombre si no
    """
    doc_type, search_term = None, identifier.strip()

    if "|" in search_term:
        parts = search_term.split("|", 1)
        doc_type    = parts[0].strip().upper()
        search_term = parts[1].strip()

    if not search_term:
        raise HTTPException(status_code=400, detail="Ingresa un nombre o número de documento para buscar")

    practitioner_id = str(practitioner["id"])
    is_doc_search = search_term.isdigit() or doc_type is not None

    if is_doc_search:
        rows = await db.fetch(
            """SELECT p.id, p.name, p.birth_date, p.fhir_id, p.document_number, p.document_type, p.created_at
               FROM patients p
               JOIN practitioner_assignments pa
                    ON pa.patient_id = p.id AND pa.practitioner_id = $3::uuid
               WHERE p.deleted_at IS NULL
                 AND p.document_number IS NOT NULL
                 AND pgp_sym_decrypt(p.document_number, $2) = $1
               ORDER BY p.created_at DESC LIMIT 20""",
            search_term, settings.AES_KEY, practitioner_id,
        )
    else:
        rows = await db.fetch(
            """SELECT p.id, p.name, p.birth_date, p.fhir_id, p.document_number, p.document_type, p.created_at
               FROM patients p
               JOIN practitioner_assignments pa
                    ON pa.patient_id = p.id AND pa.practitioner_id = $2::uuid
               WHERE p.deleted_at IS NULL
                 AND p.name ILIKE $1
               ORDER BY p.created_at DESC LIMIT 20""",
            f"%{search_term}%", practitioner_id,
        )

    entries = []
    for r in rows:
        doc_display = None
        if r["document_number"]:
            try:
                plain = await decrypt_value(db, r["document_number"])
                doc_display = plain[:2] + "****" + plain[-2:] if len(plain) > 4 else "****"
            except Exception:
                doc_display = "****"
        entries.append({
            "resourceType": "Patient",
            "id": str(r["id"]),
            "name": [{"text": r["name"]}],
            "birthDate": r["birth_date"].isoformat() if r["birth_date"] else None,
            "fhir_id": r["fhir_id"],
            "identifier": [
                {
                    "system": f"https://www.datos.gov.co/d/{(r['document_type'] or 'CC').lower()}",
                    "value": doc_display,
                }
            ] if doc_display else [],
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
    birth_date_str = body.get("birthDate")
    birth_date = None
    if birth_date_str:
        try:
            from datetime import date as _date
            birth_date = _date.fromisoformat(birth_date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="birthDate inválido, use formato YYYY-MM-DD")

    # Extraer identifier FHIR R4 (ej. CC, TI, PA)
    doc_number, doc_type = None, "CC"
    for ident in body.get("identifier", []):
        val = ident.get("value", "").strip()
        if val:
            doc_number = val
            # Inferir tipo desde el system (URL) o type.coding
            sys = ident.get("system", "")
            coding = (ident.get("type", {}).get("coding") or [{}])[0]
            code = coding.get("code", "").upper() or sys.split("/")[-1].upper()
            if code in ("CC", "TI", "CE", "PA", "RC"):
                doc_type = code
            break

    # Evitar duplicado por número de documento (comparando cifrado)
    if doc_number:
        existing = await db.fetchrow(
            """SELECT id FROM patients
               WHERE deleted_at IS NULL
                 AND document_number IS NOT NULL
                 AND pgp_sym_decrypt(document_number, $2) = $1""",
            doc_number, settings.AES_KEY,
        )
    else:
        existing = await db.fetchrow(
            "SELECT id FROM patients WHERE name = $1 AND deleted_at IS NULL",
            full_name,
        )
    if existing:
        raise HTTPException(status_code=409, detail="Paciente ya existe en este sistema")

    # Cifrar número de documento antes de persistir
    enc_doc = await encrypt_value(db, doc_number) if doc_number else None

    row = await db.fetchrow(
        """INSERT INTO patients (name, birth_date, document_number, document_type, is_active)
           VALUES ($1, $2, $3, $4, TRUE)
           RETURNING id, created_at""",
        full_name, birth_date, enc_doc, doc_type,
    )

    ip = request.client.host if request.client else None
    import json as _json
    await db.execute(
        """INSERT INTO superuser_audit (practitioner_id, action, patient_id, ip_address, detail)
           VALUES ($1::uuid, 'CREATE_PATIENT', $2::uuid, $3::inet, $4::jsonb)""",
        str(practitioner["id"]), str(row["id"]), ip,
        _json.dumps({"source": "external_system", "doc_number": doc_number}),
    )

    doc_masked = (doc_number[:2] + "****" + doc_number[-2:]) if doc_number and len(doc_number) > 4 else "****"
    return {
        "resourceType": "Patient",
        "id": str(row["id"]),
        "meta": {"lastUpdated": row["created_at"].isoformat()},
        "name": [{"text": full_name}],
        "birthDate": birth_date_str,
        "identifier": [
            {
                "system": f"https://www.datos.gov.co/d/{doc_type.lower()}",
                "value": doc_masked,
            }
        ] if doc_number else [],
    }


@router.get("/superuser/patients/{patient_id}/observations")
async def get_patient_observations(
    patient_id: str,
    loinc_code: Optional[str] = None,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Obtener observaciones LOINC de un paciente para análisis externo."""
    await _require_patient_assigned(db, str(practitioner["id"]), patient_id)
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
    entries = []
    for r in rows:
        loinc = r["loinc_code"]
        display = LOINC_DISPLAY.get(loinc, loinc)
        entries.append({
            "resourceType": "Observation",
            "id": str(r["id"]),
            "status": r["status"],
            "code": {
                "coding": [{"system": "http://loinc.org", "code": loinc, "display": display}],
                "text": display,
            },
            "valueQuantity": {"value": float(r["value"]), "unit": r["unit"]} if r["value"] else None,
            "effectiveDateTime": r["created_at"].isoformat(),
            "subject": {"reference": f"Patient/{patient_id}"},
        })
    return {"resourceType": "Bundle", "type": "searchset", "total": len(entries), "entry": entries}


@router.post("/superuser/patients/{patient_id}/observations", status_code=201)
async def create_observation_external(
    patient_id: str,
    request: Request,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Registrar observación FHIR desde sistema externo."""
    await _require_patient_assigned(db, str(practitioner["id"]), patient_id)
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
    db: asyncpg.Connection = Depends(get_db),
):
    """Invocar inferencia ML/DL directamente sobre features del paciente externo.
    model_type: diabetes → ML service | retinopathy → DL service | multimodal → ambos
    """
    if model_type not in ("diabetes", "retinopathy", "multimodal"):
        raise HTTPException(status_code=400, detail="model_type: diabetes|retinopathy|multimodal")

    body = await request.json()
    features = body.get("features", {})
    patient_id = body.get("patient_id")

    if patient_id:
        await _require_patient_assigned(db, str(practitioner["id"]), patient_id)

    async with httpx.AsyncClient(timeout=30) as client:
        if model_type in ("diabetes", "multimodal"):
            ml_payload = {"features": features}
            if patient_id:
                ml_payload["patient_id"] = patient_id
            r_ml = await client.post(f"{settings.ML_SERVICE_URL}/ml/predict", json=ml_payload)
            if r_ml.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Error ML service: {r_ml.text[:200]}")
            ml_result = r_ml.json()
        else:
            ml_result = None

        if model_type in ("retinopathy", "multimodal") and patient_id:
            r_dl = await client.post(f"{settings.DL_SERVICE_URL}/dl/predict", params={"patient_id": patient_id})
            dl_result = r_dl.json() if r_dl.status_code == 200 else None
        else:
            dl_result = None

    if model_type == "diabetes":
        probability = ml_result.get("risk_score", 0)
        risk_category = ml_result.get("risk_category", "")
        shap = ml_result.get("shap_values", {})
    elif model_type == "retinopathy" and dl_result:
        probability = max(dl_result.get("probabilities", {}).values() or [0])
        risk_category = dl_result.get("risk_category", "")
        shap = {}
    elif model_type == "multimodal":
        ml_score = ml_result.get("risk_score", 0) if ml_result else 0
        dl_score = max(dl_result.get("probabilities", {}).values() or [0]) if dl_result else 0
        probability = round((ml_score + dl_score) / (2 if dl_result else 1), 4)
        risk_category = ml_result.get("risk_category", "") if ml_result else ""
        shap = ml_result.get("shap_values", {}) if ml_result else {}
    else:
        probability = 0
        risk_category = "UNKNOWN"
        shap = {}

    is_critical = risk_category in ("HIGH", "CRITICAL")
    report_id = None

    if patient_id:
        import json as _json
        model_type_db = {"diabetes": "ML", "retinopathy": "DL", "multimodal": "MULTIMODAL"}.get(model_type, "ML")
        pred_json = _json.dumps({"score": float(probability), "category": risk_category})
        enc_pred = await db.fetchrow("SELECT pgp_sym_encrypt($1, $2) AS enc", pred_json, settings.AES_KEY)
        enc_shap = None
        if shap:
            enc_shap_row = await db.fetchrow(
                "SELECT pgp_sym_encrypt($1, $2) AS enc", _json.dumps(shap), settings.AES_KEY
            )
            enc_shap = enc_shap_row["enc"]
        row_r = await db.fetchrow(
            """INSERT INTO risk_reports
               (patient_id, model_type, risk_score, risk_category, is_critical,
                prediction_enc, shap_enc, signed_by_practitioner)
               VALUES ($1::uuid, $2, NULL, NULL, $3, $4, $5, $6::uuid)
               RETURNING id""",
            patient_id, model_type_db, is_critical,
            enc_pred["enc"], enc_shap, str(practitioner["id"]),
        )
        report_id = str(row_r["id"])

    return {
        "probability": probability,
        "risk_score": probability,
        "risk_category": risk_category,
        "is_critical": is_critical,
        "calibrated": True,
        "model": model_type,
        "report_id": report_id,
        "shap_values": shap,
        "fhir_risk_assessment": {
            "resourceType": "RiskAssessment",
            "status": "final",
            "subject": {"reference": f"Patient/{patient_id}"} if patient_id else {},
            "prediction": [{"probabilityDecimal": probability, "qualitativeRisk": {"text": risk_category}}],
        },
    }


@router.get("/superuser/patients/{patient_id}/risk-reports")
async def list_risk_reports_su(
    patient_id: str,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Lista reportes de riesgo del paciente (ML/DL/MULTIMODAL) para revisión y firma."""
    await _require_patient_assigned(db, str(practitioner["id"]), patient_id)
    patient = await db.fetchrow(
        "SELECT id FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", patient_id,
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    rows = await db.fetch(
        """SELECT rr.id, rr.model_type, rr.is_critical, rr.doctor_action,
                  rr.doctor_notes, rr.rejection_reason, rr.signed_at, rr.created_at,
                  rr.risk_score AS raw_score,
                  rr.risk_category AS raw_category,
                  CASE WHEN rr.prediction_enc IS NOT NULL
                       THEN pgp_sym_decrypt(rr.prediction_enc, $2)::json->>'score'
                       ELSE NULL END AS score,
                  CASE WHEN rr.prediction_enc IS NOT NULL
                       THEN pgp_sym_decrypt(rr.prediction_enc, $2)::json->>'category'
                       ELSE rr.risk_category END AS category,
                  CASE WHEN su.full_name_enc IS NOT NULL
                       THEN pgp_sym_decrypt(su.full_name_enc, $2)
                       ELSE NULL END AS signed_by_name
           FROM risk_reports rr
           LEFT JOIN practitioners su ON su.id = rr.signed_by_practitioner
           WHERE rr.patient_id = $1::uuid AND rr.deleted_at IS NULL
           ORDER BY rr.created_at DESC LIMIT 50""",
        patient_id, settings.AES_KEY,
    )
    entries = []
    for r in rows:
        score_str = r["score"]
        if score_str is None and r["raw_score"] is not None:
            score_str = str(r["raw_score"])
        entries.append({
            "id": str(r["id"]),
            "model_type": r["model_type"],
            "risk_score": float(score_str) if score_str is not None else None,
            "risk_category": r["category"] or r["raw_category"],
            "is_critical": r["is_critical"],
            "doctor_action": r["doctor_action"],
            "doctor_notes": r["doctor_notes"],
            "rejection_reason": r["rejection_reason"],
            "signed_at": r["signed_at"].isoformat() if r["signed_at"] else None,
            "signed_by_name": r["signed_by_name"],
            "created_at": r["created_at"].isoformat(),
            "pending": r["doctor_action"] is None,
        })
    return {"total": len(entries), "entry": entries}


@router.patch("/superuser/risk-reports/{rid}/sign", status_code=200)
async def sign_risk_report_su(
    rid: str,
    body: SignReportRequest,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Firma (ACCEPTED/REJECTED) un reporte de riesgo generado por el médico externo."""
    if body.action not in ("ACCEPTED", "REJECTED"):
        raise HTTPException(status_code=400, detail="action debe ser ACCEPTED o REJECTED")

    row = await db.fetchrow(
        "SELECT id, doctor_action, patient_id FROM risk_reports WHERE id = $1::uuid AND deleted_at IS NULL", rid,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    await _require_patient_assigned(db, str(practitioner["id"]), str(row["patient_id"]))
    if row["doctor_action"] is not None:
        raise HTTPException(status_code=409, detail="El reporte ya fue firmado")

    patient_id_str = str(row["patient_id"])
    async with db.transaction():
        await db.execute(
            """UPDATE risk_reports
               SET doctor_action = $1, doctor_notes = $2, rejection_reason = $3,
                   signed_by_practitioner = $4::uuid, signed_at = NOW()
               WHERE id = $5::uuid""",
            body.action, body.notes, body.rejection_reason,
            str(practitioner["id"]), rid,
        )
        await db.execute(
            """INSERT INTO superuser_audit (practitioner_id, action, patient_id, detail)
               VALUES ($1::uuid, 'SIGN_REPORT', $2::uuid,
                       jsonb_build_object('report_id', $3::text, 'action', $4::text))""",
            str(practitioner["id"]), patient_id_str, rid, body.action,
        )
    return {"signed": rid, "action": body.action}


@router.delete("/superuser/patients/{patient_id}", status_code=200)
async def soft_delete_patient(
    patient_id: str,
    request: Request,
    body: SoftDeleteRequest,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Soft delete de paciente (Resolución 1995/1999 — dato preservado)."""
    await _require_patient_assigned(db, str(practitioner["id"]), patient_id)
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


# ── Imágenes (SuperUser) ─────────────────────────────────────────────────────

@router.post("/superuser/patients/{patient_id}/images", status_code=201)
async def upload_image_su(
    patient_id: str,
    modality: str = Form("FUNDUS"),
    file: UploadFile = File(...),
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Sube una imagen diagnóstica para el paciente. Clave MinIO cifrada con AES-256."""
    await _require_patient_assigned(db, str(practitioner["id"]), patient_id)
    patient = await db.fetchrow(
        "SELECT id FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", patient_id,
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    import uuid as _uuid_mod
    content = await file.read()
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower()
    object_key = f"patients/{patient_id}/{_uuid_mod.uuid4()}.{ext}"

    mc = _su_minio_client()
    bucket = settings.MINIO_BUCKET
    if not mc.bucket_exists(bucket):
        mc.make_bucket(bucket)
    mc.put_object(bucket, object_key, _io.BytesIO(content), length=len(content),
                  content_type=file.content_type or "application/octet-stream")

    enc_key = await db.fetchrow(
        "SELECT pgp_sym_encrypt($1, $2) AS enc", object_key, settings.AES_KEY,
    )
    row = await db.fetchrow(
        """INSERT INTO images (patient_id, minio_key, modality, uploaded_by)
           VALUES ($1::uuid, $2, $3, NULL)
           RETURNING id, created_at""",
        patient_id, enc_key["enc"], modality,
    )
    await db.execute(
        """INSERT INTO superuser_audit (practitioner_id, action, patient_id, detail)
           VALUES ($1::uuid, 'UPLOAD_IMAGE', $2::uuid,
                   jsonb_build_object('image_id', $3::text, 'modality', $4::text))""",
        str(practitioner["id"]), patient_id, str(row["id"]), modality,
    )
    return {
        "id": str(row["id"]),
        "modality": modality,
        "created_at": row["created_at"].isoformat(),
        "url": _su_presigned_url(object_key),
    }


@router.get("/superuser/patients/{patient_id}/images")
async def list_images_su(
    patient_id: str,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Lista imágenes del paciente con URLs presignadas (1 h)."""
    await _require_patient_assigned(db, str(practitioner["id"]), patient_id)
    patient = await db.fetchrow(
        "SELECT id FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", patient_id,
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    rows = await db.fetch(
        """SELECT id, modality, created_at,
                  pgp_sym_decrypt(minio_key, $2) AS object_key
           FROM images
           WHERE patient_id = $1::uuid AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 50""",
        patient_id, settings.AES_KEY,
    )
    entries = []
    for r in rows:
        try:
            url = _su_presigned_url(r["object_key"])
        except Exception:
            url = None
        entries.append({
            "id": str(r["id"]),
            "modality": r["modality"],
            "created_at": r["created_at"].isoformat(),
            "url": url,
        })
    return {"total": len(entries), "entry": entries}


# ── Agent proxy ───────────────────────────────────────────────────────────────

class AgentChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    mode: Optional[str] = "agentic"
    patient_id: Optional[str] = None


async def _get_or_create_proxy_user(db: asyncpg.Connection) -> str:
    """Retorna el ID de la cuenta de servicio interna usada para proxear al RAG Agent.
    Esta cuenta no tiene contraseña real ni keys expuestas — solo sirve para generar JWT.
    is_active=TRUE es requerido por require_authenticated del RAG Agent."""
    import secrets as _secrets
    from core.auth import hash_password

    row = await db.fetchrow(
        "SELECT id FROM users WHERE username = '_su_proxy' AND deleted_at IS NULL"
    )
    if row:
        return str(row["id"])

    pw_hash = hash_password(_secrets.token_urlsafe(32) + "Aa1!")
    new_row = await db.fetchrow(
        """INSERT INTO users (username, password_hash, role, access_key, permission_key, is_active)
           VALUES ('_su_proxy', $1, 'MEDICO', $2, $3, TRUE)
           ON CONFLICT (username) DO NOTHING
           RETURNING id""",
        pw_hash,
        _secrets.token_hex(32),
        _secrets.token_hex(32),
    )
    if new_row:
        return str(new_row["id"])
    row = await db.fetchrow("SELECT id FROM users WHERE username = '_su_proxy'")
    return str(row["id"])


@router.post("/superuser/agent/chat")
async def superuser_agent_chat(
    request: Request,
    body: AgentChatRequest,
    practitioner: dict = Depends(require_superuser),
    db: asyncpg.Connection = Depends(get_db),
):
    """Proxy al RAG Agent para médicos externos.
    El SuperUser JWT no es válido en el RAG Agent (tabla distinta), así que el
    backend genera un JWT de cuenta de servicio interna (_su_proxy) para el reenvío.
    La autorización real ya fue validada por require_superuser + _require_patient_assigned."""
    from core.config import settings as _settings
    from core.auth import create_access_token

    if body.patient_id:
        await _require_patient_assigned(db, str(practitioner["id"]), body.patient_id)

    proxy_user_id = await _get_or_create_proxy_user(db)
    proxy_token = create_access_token(proxy_user_id, "MEDICO")

    proxy_headers = {"Authorization": f"Bearer {proxy_token}"}
    if body.patient_id and _settings.INTERNAL_PROXY_SECRET:
        # Indicar al RAG Agent que este acceso ya fue validado por el backend
        proxy_headers["X-Granted-Patient-Id"] = body.patient_id
        proxy_headers["X-Proxy-Secret"] = _settings.INTERNAL_PROXY_SECRET

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{_settings.RAG_AGENT_URL}/agent/chat",
                json=body.model_dump(exclude_none=True),
                headers=proxy_headers,
            )
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="RAG Agent no disponible")

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])

    return resp.json()
