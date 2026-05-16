"""
routers/fhir.py — FHIR R4 resources
Patient, Observation, Media, RiskAssessment, DiagnosticReport, AuditEvent
All endpoints: doble API-Key (via JWT) + RBAC + audit log + paginación.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional
import asyncpg, uuid
from datetime import date, datetime, timedelta
from core.config import get_db, settings
from core.auth import require_authenticated, require_medico, require_admin
from core.audit import log_audit
from core.crypto import encrypt_value, decrypt_value
from fastapi import UploadFile, File, Form
from minio import Minio
import io as _io
import urllib3
import boto3
from botocore.config import Config

# ── Import del helper de creación de usuario paciente ────────────────────────
from routers.admin import create_patient_user

router = APIRouter(prefix="/fhir", tags=["FHIR"])


# ──────────────────────────────────────────────────────────────────────────────
# HELPER MinIO
# ──────────────────────────────────────────────────────────────────────────────
def _minio_client() -> Minio:
    """
    Cliente interno para subir/leer objetos.
    Usa minio:9000 (docker network) — conexión real garantizada.
    """
    return Minio(
        settings.MINIO_ENDPOINT,          # minio:9000
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=False,
    )


def _make_presigned_url(key: str) -> str:
    """
    Genera presigned URL con boto3 — SIN hacer conexión HTTP.
    boto3.generate_presigned_url() es puro cálculo HMAC,
    no intenta conectarse al endpoint.

    El URL resultante tiene host=localhost:9000 ✅
    MinIO lo verifica correctamente porque MINIO_SERVER_URL=http://localhost:9000
    hace que MinIO espere exactamente ese host en la firma.
    """
    s3 = boto3.client(
        "s3",
        endpoint_url="http://localhost:9000",          # host que verá el browser
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",                       # MinIO usa us-east-1 por defecto
    )
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.MINIO_BUCKET, "Key": key},
        ExpiresIn=3600,
    )

# ──────────────────────────────────────────────────────────────────────────────
# PATIENT
# ──────────────────────────────────────────────────────────────────────────────
class PatientCreate(BaseModel):
    name: str
    birth_date: str
    identification_doc: str
    ground_truth: Optional[int] = None


@router.post("/Patient", status_code=201)
async def create_patient(
    body: PatientCreate,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    enc_doc = await encrypt_value(db, body.identification_doc)
    birth_date_obj = datetime.strptime(body.birth_date, "%Y-%m-%d").date() if isinstance(body.birth_date, str) else body.birth_date
    row = await db.fetchrow(
        """INSERT INTO patients (owner_id, name, birth_date, identification_doc, ground_truth)
        VALUES ($1::uuid, $2, $3, $4, $5)
        RETURNING id, name, birth_date, created_at""",
        str(user["id"]), body.name, birth_date_obj, enc_doc, body.ground_truth,
    )
    pid = str(row["id"])

    # ── FIX: auto-asignar el paciente al médico que lo crea ──────────────────
    # Así el médico que crea el paciente también lo ve en su lista
    await db.execute(
        """INSERT INTO patient_assignments (patient_id, doctor_id, assigned_by)
           VALUES ($1::uuid, $2::uuid, $2::uuid)
           ON CONFLICT (patient_id, doctor_id) DO NOTHING""",
        pid, str(user["id"]),
    )

    await log_audit(db, str(user["id"]), user["role"], "CREATE_PATIENT", "Patient",
                    pid, request.client.host if request.client else None)
    return _patient_to_fhir(row)


@router.get("/Patient")
async def list_patients(
    request: Request,
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    if user["role"] == "ADMIN":
        where, params = "WHERE p.deleted_at IS NULL", []
    elif user["role"] == "MEDICO":
        # ── FIX: Médico SOLO ve pacientes asignados explícitamente ────────────
        where = """WHERE p.deleted_at IS NULL AND
            EXISTS (
                SELECT 1 FROM patient_assignments pa
                WHERE pa.patient_id = p.id AND pa.doctor_id = $1::uuid
            )"""
        params = [str(user["id"])]
    else:
        # PACIENTE: solo ve su propio registro, buscando por patient_user_id
        where, params = "WHERE p.deleted_at IS NULL AND p.patient_user_id = $1::uuid", [str(user["id"])]

    count_row = await db.fetchrow(f"SELECT COUNT(*) FROM patients p {where}", *params)
    rows = await db.fetch(
        f"""SELECT p.id, p.name, p.birth_date, p.created_at,
                   (SELECT COUNT(*) FROM risk_reports r
                    WHERE r.patient_id = p.id AND r.deleted_at IS NULL AND r.signed_at IS NULL) AS pending_reports,
                   (SELECT risk_category FROM risk_reports r
                    WHERE r.patient_id = p.id AND r.deleted_at IS NULL
                    ORDER BY r.created_at DESC LIMIT 1) AS last_risk_category
            FROM patients p {where}
            ORDER BY p.created_at DESC
            LIMIT ${len(params)+1} OFFSET ${len(params)+2}""",
        *params, limit, offset,
    )
    await log_audit(db, str(user["id"]), user["role"], "LIST_PATIENTS", "Patient",
                    None, request.client.host if request.client else None)
    return {
        "total": count_row["count"],
        "limit": limit,
        "offset": offset,
        "entry": [_patient_list_entry(r) for r in rows],
    }


@router.get("/Patient/{pid}")
async def get_patient(
    pid: str,
    request: Request,
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        "SELECT * FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", pid
    )
    if not row:
        raise HTTPException(404, "Paciente no encontrado")
    await _check_medico_access(user, row, db)

    dec_doc = await decrypt_value(db, row["identification_doc"])
    await log_audit(db, str(user["id"]), user["role"], "VIEW_PATIENT", "Patient",
                    pid, request.client.host if request.client else None)
    fhir = _patient_to_fhir(row)
    if user["role"] == "ADMIN":
        fhir["identification_doc"] = "••••••••"
        fhir["birthDate"] = "••••••••"
    elif user["role"] == "PACIENTE":
        fhir["identification_doc"] = "***"
        fhir.pop("ground_truth", None)
    else:
        fhir["identification_doc"] = dec_doc
    return fhir


@router.delete("/Patient/{pid}", status_code=204)
async def soft_delete_patient(
    pid: str,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    await db.execute(
        "UPDATE patients SET deleted_at = NOW() WHERE id = $1::uuid AND deleted_at IS NULL", pid
    )
    await log_audit(db, str(user["id"]), user["role"], "DELETE_USER", "Patient",
                    pid, request.client.host if request.client else None)


@router.patch("/Patient/{pid}/restore", status_code=200)
async def restore_patient(
    pid: str,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    await db.execute(
        "UPDATE patients SET deleted_at = NULL WHERE id = $1::uuid", pid
    )
    return {"restored": pid}


# ──────────────────────────────────────────────────────────────────────────────
# OBSERVATION
# ──────────────────────────────────────────────────────────────────────────────
class ObservationCreate(BaseModel):
    patient_id: str
    loinc_code: str
    value: float
    unit: str
    status: str = "final"


@router.post("/Observation", status_code=201)
async def create_observation(
    body: ObservationCreate,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        """INSERT INTO observations (patient_id, loinc_code, value, unit, status)
           VALUES ($1::uuid, $2, $3, $4, $5)
           RETURNING id, patient_id, loinc_code, value, unit, status, created_at""",
        body.patient_id, body.loinc_code, body.value, body.unit, body.status,
    )
    await log_audit(db, str(user["id"]), user["role"], "CREATE_OBSERVATION", "Observation",
                    str(row["id"]), request.client.host if request.client else None)
    return _observation_to_fhir(row)


@router.get("/Observation")
async def list_observations(
    subject: str = Query(...),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        """SELECT id, patient_id, loinc_code, value, unit, status, created_at
           FROM observations
           WHERE patient_id = $1::uuid AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT $2 OFFSET $3""",
        subject, limit, offset,
    )
    return {
        "total": len(rows), "limit": limit, "offset": offset,
        "entry": [_observation_to_fhir(r) for r in rows],
    }


# ──────────────────────────────────────────────────────────────────────────────
# MEDIA
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/Media/upload", status_code=201)
async def upload_media(
    request: Request,
    patient_id: str = Form(...),
    modality: str = Form("FUNDUS"),
    file: UploadFile = File(...),
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    content = await file.read()
    minio = _minio_client()
    if not minio.bucket_exists(settings.MINIO_BUCKET):
        minio.make_bucket(settings.MINIO_BUCKET)

    key = f"{patient_id}/{uuid.uuid4()}-{file.filename}"
    minio.put_object(
        settings.MINIO_BUCKET, key,
        _io.BytesIO(content), len(content),
        content_type=file.content_type or "application/octet-stream",
    )

    from core.crypto import encrypt_value as _enc
    enc_key = await _enc(db, key)

    row = await db.fetchrow(
        """INSERT INTO images (patient_id, minio_key, modality, uploaded_by)
           VALUES ($1::uuid, $2, $3, $4::uuid)
           RETURNING id, patient_id, modality, created_at""",
        patient_id, enc_key, modality, str(user["id"]),
    )
    await log_audit(db, str(user["id"]), user["role"], "UPLOAD_IMAGE", "Media",
                    str(row["id"]), request.client.host if request.client else None)
    return _media_to_fhir(row, key)


@router.get("/Media")
async def list_media(
    subject: str = Query(...),
    limit: int = Query(20, ge=1, le=100),
    presign: bool = Query(False),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        """SELECT id, patient_id, minio_key, modality, created_at
           FROM images
           WHERE patient_id = $1::uuid AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT $2""",
        subject, limit,
    )
    from core.crypto import decrypt_value as _dec
    entry = []
    for r in rows:
        plain_key = await _dec(db, r["minio_key"])
        item = _media_to_fhir(r, plain_key)
        if presign:
            item["presigned_url"] = _make_presigned_url(plain_key)
        entry.append(item)
    return {"total": len(entry), "limit": limit, "entry": entry}


@router.get("/Media/{mid}/url")
async def get_media_url(
    mid: str,
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        "SELECT minio_key FROM images WHERE id = $1::uuid AND deleted_at IS NULL", mid
    )
    if not row:
        raise HTTPException(404, "Imagen no encontrada")
    from core.crypto import decrypt_value as _dec
    plain_key = await _dec(db, row["minio_key"])
    url = _make_presigned_url(plain_key)
    return {"url": url}


# ──────────────────────────────────────────────────────────────────────────────
# RISK ASSESSMENT
# ──────────────────────────────────────────────────────────────────────────────
class SignReportBody(BaseModel):
    action: str           # ACCEPTED | REJECTED
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None


@router.patch("/RiskAssessment/{rid}/sign")
async def sign_risk_assessment(
    rid: str,
    body: SignReportBody,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    if body.action not in ("ACCEPTED", "REJECTED"):
        raise HTTPException(400, "action debe ser ACCEPTED o REJECTED")
    row = await db.fetchrow(
        "SELECT id FROM risk_reports WHERE id = $1::uuid AND deleted_at IS NULL", rid
    )
    if not row:
        raise HTTPException(404, "RiskReport no encontrado")
    await db.execute(
        """UPDATE risk_reports
           SET doctor_action = $1, doctor_notes = $2, rejection_reason = $3,
               signed_by = $4::uuid, signed_at = NOW()
           WHERE id = $5::uuid""",
        body.action, body.notes, body.rejection_reason,
        str(user["id"]), rid,
    )
    await log_audit(db, str(user["id"]), user["role"], "SIGN_REPORT", "RiskReport",
                    rid, request.client.host if request.client else None,
                    detail={"action": body.action})
    return {"signed": rid, "action": body.action}


@router.get("/RiskAssessment")
async def list_risk_assessments(
    subject: str = Query(...),
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        """SELECT id, patient_id, model_type, risk_score, risk_category,
                  is_critical, shap_json, doctor_action, doctor_notes,
                  rejection_reason, signed_by, signed_at, created_at
           FROM risk_reports
           WHERE patient_id = $1::uuid AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT $2""",
        subject, limit,
    )
    return {
        "total": len(rows), "limit": limit, "offset": 0,
        "entry": [_risk_to_fhir(r) for r in rows],
    }


@router.get("/RiskAssessment/{rid}")
async def get_risk_assessment(
    rid: str,
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        """SELECT id, patient_id, model_type, risk_score, risk_category,
                  is_critical, shap_json, gradcam_url, original_url,
                  doctor_action, doctor_notes,
                  rejection_reason, signed_by, signed_at, created_at
           FROM risk_reports
           WHERE id = $1::uuid AND deleted_at IS NULL""",
        rid,
    )
    if not row:
        raise HTTPException(404, "RiskReport no encontrado")
    await _check_subject_access(user, str(row["patient_id"]), db)
    return _risk_to_fhir(row)


# ──────────────────────────────────────────────────────────────────────────────
# PATIENT FULL — crea paciente + observaciones + usuario PACIENTE en un solo paso
# ──────────────────────────────────────────────────────────────────────────────
class ObsItem(BaseModel):
    loinc_code: str
    value: float
    unit: str

class PatientFull(BaseModel):
    name: str
    birth_date: str
    identification_doc: str
    ground_truth: Optional[int] = None
    observations: list[ObsItem] = []

@router.post("/Patient/full", status_code=201)
async def create_patient_full(
    body: PatientFull,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Crea paciente + observaciones en un solo request.
    Genera automáticamente un usuario PACIENTE con sus API keys
    y lo vincula al registro del paciente.
    Las credenciales se devuelven UNA SOLA VEZ en la respuesta.
    """
    # ── 1. Cifrar documento e insertar paciente ───────────────────────────────
    enc_doc = await encrypt_value(db, body.identification_doc)
    birth_date_obj = datetime.strptime(body.birth_date, "%Y-%m-%d").date()

    row = await db.fetchrow(
        """INSERT INTO patients (owner_id, name, birth_date, identification_doc, ground_truth)
           VALUES ($1::uuid, $2, $3, $4, $5)
           RETURNING id, name, birth_date, created_at""",
        str(user["id"]), body.name, birth_date_obj, enc_doc, body.ground_truth,
    )
    pid = str(row["id"])

    # ── 2. Auto-asignar al médico que crea el paciente ────────────────────────
    await db.execute(
        """INSERT INTO patient_assignments (patient_id, doctor_id, assigned_by)
           VALUES ($1::uuid, $2::uuid, $2::uuid)
           ON CONFLICT (patient_id, doctor_id) DO NOTHING""",
        pid, str(user["id"]),
    )

    # ── 3. Crear usuario PACIENTE y vincularlo ────────────────────────────────
    new_user = await create_patient_user(db, body.name, pid)

    await db.execute(
        "UPDATE patients SET patient_user_id = $1::uuid WHERE id = $2::uuid",
        str(new_user["id"]), pid,
    )

    # ── 4. Insertar observaciones LOINC ──────────────────────────────────────
    obs_created = []
    for obs in body.observations:
        obs_row = await db.fetchrow(
            """INSERT INTO observations (patient_id, loinc_code, value, unit, status)
               VALUES ($1::uuid, $2, $3, $4, 'final')
               RETURNING id, loinc_code, value, unit""",
            pid, obs.loinc_code, obs.value, obs.unit,
        )
        obs_created.append(dict(obs_row))

    # ── 5. Audit ──────────────────────────────────────────────────────────────
    ip = request.client.host if request.client else None
    await log_audit(
        db, str(user["id"]), user["role"], "CREATE_PATIENT", "Patient",
        pid, ip,
        detail={
            "observations_count": len(obs_created),
            "patient_user_id": str(new_user["id"]),
        },
    )

    # ── 6. Respuesta — credenciales solo se muestran aquí ────────────────────
    return {
        "resourceType": "Patient",
        "id": pid,
        "name": row["name"],
        "birthDate": str(row["birth_date"]),
        "meta": {"createdAt": row["created_at"].isoformat()},
        "observations_created": len(obs_created),
        # Credenciales del usuario PACIENTE — guardar antes de cerrar el modal
        "patient_user": {
            "user_id": str(new_user["id"]),
            "username": new_user["username"],
            "role": "PACIENTE",
            "access_key": new_user["access_key"],
            "permission_key": new_user["permission_key"],
            "note": "Guarda estas claves — no se volverán a mostrar",
        },
    }


# ──────────────────────────────────────────────────────────────────────────────
# CAN CLOSE PATIENT
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/Patient/{pid}/can-close")
async def can_close_patient(
    pid: str,
    request: Request,
    user: dict = Depends(require_medico),
    db: asyncpg.Connection = Depends(get_db),
):
    pending = await db.fetch(
        """SELECT id FROM risk_reports
           WHERE patient_id = $1::uuid AND signed_at IS NULL AND deleted_at IS NULL""",
        pid,
    )
    if pending:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "PENDING_SIGNATURE",
                "message": "Debe firmar el RiskReport antes de cerrar el paciente",
                "pending_count": len(pending),
            },
        )
    await log_audit(db, str(user["id"]), user["role"], "CLOSE_PATIENT", "Patient",
                    pid, request.client.host if request.client else None)
    return {"can_close": True, "message": "Paciente puede ser cerrado"}


# ──────────────────────────────────────────────────────────────────────────────
# HELPERS — resource mappers
# ──────────────────────────────────────────────────────────────────────────────
def _patient_to_fhir(row) -> dict:
    return {
        "resourceType": "Patient",
        "id": str(row["id"]),
        "name": row["name"],
        "birthDate": str(row["birth_date"]) if row.get("birth_date") else None,
        "active": row.get("is_active", True),
        "meta": {"createdAt": row["created_at"].isoformat()},
    }

def _patient_list_entry(row) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "birth_date": str(row["birth_date"]) if row.get("birth_date") else None,
        "pending_reports": row.get("pending_reports", 0),
        "last_risk_category": row.get("last_risk_category"),
    }

def _observation_to_fhir(row) -> dict:
    return {
        "resourceType": "Observation",
        "id": str(row["id"]),
        "subject": {"reference": f"Patient/{row['patient_id']}"},
        "status": row["status"],
        "code": {"coding": [{"system": "http://loinc.org", "code": row["loinc_code"]}]},
        "valueQuantity": {"value": float(row["value"]), "unit": row["unit"]},
        "effectiveDateTime": row["created_at"].isoformat(),
    }

def _media_to_fhir(row, plain_minio_key: str) -> dict:
    return {
        "resourceType": "Media",
        "id": str(row["id"]),
        "subject": {"reference": f"Patient/{row['patient_id']}"},
        "status": "completed",
        "modality": row["modality"],
        "content": {"url": f"/minio/{plain_minio_key}"},
        "createdDateTime": row["created_at"].isoformat(),
    }

def _risk_to_fhir(row) -> dict:
    snomed_map = {
        "LOW": "281414001", "MEDIUM": "281415000",
        "HIGH": "281416004", "CRITICAL": "24484000",
    }
    cat = row.get("risk_category", "LOW")
    return {
        "resourceType": "RiskAssessment",
        "id": str(row["id"]),
        "subject": {"reference": f"Patient/{row['patient_id']}"},
        "method": row.get("model_type"),
        "prediction": [{
            "probabilityDecimal": float(row["risk_score"]) if row.get("risk_score") else None,
            "qualitativeRisk": {
                "coding": [{"system": "http://snomed.info/sct",
                            "code": snomed_map.get(cat, "281414001"),
                            "display": cat}]
            },
        }],
        "is_critical": row.get("is_critical", False),
        "shap_values": row.get("shap_json"),
        "gradcam_url": row.get("gradcam_url"),
        "original_url": row.get("original_url"),
        "doctor_action": row.get("doctor_action"),
        "signed_at": row["signed_at"].isoformat() if row.get("signed_at") else None,
        "occurrenceDateTime": row["created_at"].isoformat(),
    }

def _check_patient_access(user: dict, row):
    """Acceso síncrono: solo verifica owner. Para MEDICO con asignación usar _check_medico_access."""
    if user["role"] == "ADMIN":
        return
    if user["role"] == "PACIENTE" and str(row["owner_id"]) != str(user["id"]):
        raise HTTPException(403, "Acceso denegado a este paciente")


async def _check_medico_access(user: dict, row, db: asyncpg.Connection):
    """
    ADMIN  → acceso total.
    MEDICO → solo pacientes asignados en patient_assignments.
    PACIENTE → solo su propio registro (por patient_user_id).
    """
    if user["role"] == "ADMIN":
        return
    if user["role"] == "MEDICO":
        assigned = await db.fetchval(
            "SELECT 1 FROM patient_assignments WHERE patient_id = $1::uuid AND doctor_id = $2::uuid",
            str(row["id"]), str(user["id"])
        )
        if not assigned:
            raise HTTPException(403, "No tiene acceso a este paciente")
        return
    if user["role"] == "PACIENTE":
        # Verifica por patient_user_id (columna agregada en migración)
        linked = await db.fetchval(
            "SELECT 1 FROM patients WHERE id = $1::uuid AND patient_user_id = $2::uuid AND deleted_at IS NULL",
            str(row["id"]), str(user["id"])
        )
        if not linked:
            raise HTTPException(403, "Acceso denegado a este paciente")

async def _check_subject_access(user: dict, subject_id: str, db: asyncpg.Connection):
    """
    ADMIN → acceso total
    MEDICO → (opcional: puedes validar asignación si quieres endurecer)
    PACIENTE → solo puede ver su propio patient_id vía patient_user_id
    """
    if user["role"] == "ADMIN":
        return

    if user["role"] == "PACIENTE":
        linked = await db.fetchval(
            """
            SELECT 1
            FROM patients
            WHERE id = $1::uuid
              AND patient_user_id = $2::uuid
              AND deleted_at IS NULL
            """,
            subject_id,
            str(user["id"]),
        )
        if not linked:
            raise HTTPException(403, "Solo puede ver sus propios datos")

@router.get("/Patient/me")
async def get_my_patient(
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    try:
        row = await db.fetchrow(
            """
            SELECT *
            FROM patients
            WHERE patient_user_id = $1::uuid
              AND deleted_at IS NULL
            """,
            str(user["id"]),
        )

        if not row:
            return {"debug": "NO PATIENT FOUND", "user_id": str(user["id"])}

        # 🔥 imprime para debug
        print("ROW:", row)

        row = dict(row)

        return row

    except Exception as e:
        return {"error": str(e), "type": str(type(e))}