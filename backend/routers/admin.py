"""
routers/admin.py — Panel Admin
CRUD usuarios, audit log filtrable + exportar CSV/JSON, estadísticas,
migración masiva de pacientes existentes a usuarios con rol PACIENTE.
Solo rol ADMIN.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import asyncpg, csv, io, json, secrets, re

from core.config import get_db
from core.auth import require_admin, hash_password
from core.audit import log_audit

router = APIRouter(prefix="/admin", tags=["admin"])


# ──────────────────────────────────────────────────────────────────────────────
# HELPER: crear usuario de paciente (reutilizable desde admin y desde fhir)
# ──────────────────────────────────────────────────────────────────────────────
async def create_patient_user(
    db: asyncpg.Connection,
    patient_name: str,
    patient_id: str,
) -> dict:
    """
    Genera un usuario con rol PACIENTE derivado del nombre del paciente.
    Retorna dict con: id, username, access_key, permission_key
    El llamador es responsable de actualizar patients.patient_user_id.
    """
    # Generar username base desde el nombre (sin tildes, sin espacios)
    base = _slugify(patient_name)[:20] or "paciente"

    # Garantizar unicidad añadiendo sufijo si ya existe
    username = base
    suffix = 1
    while True:
        exists = await db.fetchval(
            "SELECT id FROM users WHERE username = $1",
            username,
        )
        if not exists:
            break
        username = f"{base}{suffix}"
        suffix += 1

    access_key = secrets.token_hex(16)
    permission_key = secrets.token_hex(16)
    # Contraseña aleatoria segura (no se entrega al usuario — usa las API keys)
    temp_password = secrets.token_urlsafe(16) + "Aa1!"
    ph = hash_password(temp_password)

    row = await db.fetchrow(
        """INSERT INTO users (username, password_hash, role, access_key, permission_key)
           VALUES ($1, $2, 'PACIENTE', $3, $4)
           RETURNING id, username, role, access_key, permission_key, created_at""",
        username, ph, access_key, permission_key,
    )
    return dict(row)


def _slugify(text: str) -> str:
    """Convierte nombre a slug minúsculas sin tildes ni espacios."""
    replacements = str.maketrans("áéíóúÁÉÍÓÚñÑüÜ", "aeiouAEIOUnNuU")
    text = text.translate(replacements)
    text = re.sub(r"[^a-zA-Z0-9]", "", text)
    return text.lower()


# ──────────────────────────────────────────────────────────────────────────────
# USER CRUD
# ──────────────────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    username: str
    password: str
    role: str       # ADMIN | MEDICO | PACIENTE


class UserUpdate(BaseModel):
    is_active: Optional[bool] = None
    role: Optional[str] = None


@router.get("/users")
async def list_users(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    include_deleted: bool = Query(False),
    role: Optional[str] = Query(None),          # ← filtro de rol
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    filters = []
    if not include_deleted:
        filters.append("deleted_at IS NULL")
    if role and role in ("ADMIN", "MEDICO", "PACIENTE"):
        filters.append(f"role = '{role}'")
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    rows = await db.fetch(
        f"""SELECT id, username, role, is_active, created_at, deleted_at
            FROM users {where}
            ORDER BY created_at DESC LIMIT $1 OFFSET $2""",
        limit, offset,
    )
    total = await db.fetchval(f"SELECT COUNT(*) FROM users {where}")
    return {"total": total, "limit": limit, "offset": offset,
            "entry": [dict(r) for r in rows]}


@router.post("/users", status_code=201)
async def create_user(
    body: UserCreate,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    if body.role not in ("ADMIN", "MEDICO", "PACIENTE"):
        raise HTTPException(400, "Rol inválido")
    _validate_password(body.password)

    access_key = secrets.token_hex(16)
    permission_key = secrets.token_hex(16)
    ph = hash_password(body.password[:72])

    row = await db.fetchrow(
        """INSERT INTO users (username, password_hash, role, access_key, permission_key)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, username, role, access_key, permission_key, created_at""",
        body.username, ph, body.role, access_key, permission_key,
    )
    await log_audit(db, str(user["id"]), user["role"], "CREATE_USER", "User",
                    str(row["id"]), request.client.host if request.client else None)
    return dict(row)


@router.patch("/users/{uid}")
async def update_user(
    uid: str,
    body: UserUpdate,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    updates, params = [], []
    if body.is_active is not None:
        params.append(body.is_active); updates.append(f"is_active = ${len(params)}")
    if body.role is not None:
        params.append(body.role); updates.append(f"role = ${len(params)}")
    if not updates:
        raise HTTPException(400, "Nada que actualizar")
    params.append(uid)
    await db.execute(
        f"UPDATE users SET {', '.join(updates)} WHERE id = ${len(params)}::uuid",
        *params,
    )
    return {"updated": uid}


@router.delete("/users/{uid}", status_code=204)
async def deactivate_user(
    uid: str,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    await db.execute(
        "UPDATE users SET deleted_at = NOW(), is_active = FALSE WHERE id = $1::uuid", uid
    )
    await log_audit(db, str(user["id"]), user["role"], "DELETE_USER", "User",
                    uid, request.client.host if request.client else None)


@router.patch("/users/{uid}/restore")
async def restore_user(
    uid: str,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    row = await db.fetchrow(
        "SELECT id, deleted_at FROM users WHERE id = $1::uuid", uid
    )
    if not row:
        raise HTTPException(404, "Usuario no encontrado")
    if row["deleted_at"] is None:
        raise HTTPException(400, "El usuario no está eliminado")
    await db.execute(
        "UPDATE users SET deleted_at = NULL, is_active = TRUE WHERE id = $1::uuid", uid
    )
    await log_audit(db, str(user["id"]), user["role"], "RESTORE_USER", "User",
                    uid, request.client.host if request.client else None)
    return {"restored": uid}


@router.post("/users/{uid}/regenerate-keys")
async def regenerate_api_keys(
    uid: str,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    new_access = secrets.token_hex(16)
    new_perm = secrets.token_hex(16)
    await db.execute(
        "UPDATE users SET access_key = $1, permission_key = $2 WHERE id = $3::uuid",
        new_access, new_perm, uid,
    )
    return {"access_key": new_access, "permission_key": new_perm}


# ──────────────────────────────────────────────────────────────────────────────
# MIGRACIÓN MASIVA: pacientes existentes → usuarios PACIENTE
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/migrate-patients-to-users")
async def migrate_patients_to_users(
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    """
    Recorre todos los pacientes que NO tienen patient_user_id (sin usuario asociado)
    y crea un usuario PACIENTE para cada uno.
    Devuelve la lista de credenciales generadas — guardarlas de inmediato,
    las claves NO se volverán a mostrar.
    """
    # Pacientes sin usuario vinculado
    patients = await db.fetch(
        """SELECT id, name FROM patients
           WHERE patient_user_id IS NULL
             AND deleted_at IS NULL
           ORDER BY created_at""",
    )

    if not patients:
        return {"migrated": 0, "message": "Todos los pacientes ya tienen usuario.", "entry": []}

    results = []
    for p in patients:
        patient_id = str(p["id"])
        patient_name = p["name"] or f"paciente_{patient_id[:8]}"

        # Crear usuario
        new_user = await create_patient_user(db, patient_name, patient_id)

        # Vincular al paciente
        await db.execute(
            "UPDATE patients SET patient_user_id = $1::uuid WHERE id = $2::uuid",
            str(new_user["id"]), patient_id,
        )

        await log_audit(
            db, str(user["id"]), user["role"],
            "MIGRATE_PATIENT_USER", "Patient",
            patient_id,
            request.client.host if request.client else None,
            detail={"new_user_id": str(new_user["id"]), "username": new_user["username"]},
        )

        results.append({
            "patient_id": patient_id,
            "patient_name": patient_name,
            "username": new_user["username"],
            "access_key": new_user["access_key"],
            "permission_key": new_user["permission_key"],
        })

    return {
        "migrated": len(results),
        "message": f"Se crearon {len(results)} usuario(s) PACIENTE.",
        "entry": results,
    }


# ──────────────────────────────────────────────────────────────────────────────
# AUDIT LOG
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/audit-log")
async def get_audit_log(
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    result: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    filters, params = [], []
    if action:
        params.append(action); filters.append(f"action = ${len(params)}")
    if user_id:
        params.append(user_id); filters.append(f"user_id = ${len(params)}::uuid")
    if result:
        params.append(result); filters.append(f"result = ${len(params)}")
    if date_from:
        params.append(date_from); filters.append(f"ts >= ${len(params)}::timestamptz")
    if date_to:
        params.append(date_to); filters.append(f"ts <= ${len(params)}::timestamptz")

    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    params += [limit, offset]

    rows = await db.fetch(
        f"""SELECT id, ts, user_id, role, action, resource_type, resource_id,
                   ip_address, result, detail
            FROM audit_log {where}
            ORDER BY ts DESC
            LIMIT ${len(params)-1} OFFSET ${len(params)}""",
        *params,
    )
    total = await db.fetchval(f"SELECT COUNT(*) FROM audit_log {where}", *params[:-2])
    return {"total": total, "limit": limit, "offset": offset,
            "entry": [_audit_row(r) for r in rows]}


@router.get("/audit-log/export")
async def export_audit_log(
    fmt: str = Query("json", regex="^(json|csv)$"),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        """SELECT id, ts, user_id, role, action, resource_type, resource_id,
                  ip_address, result, detail
           FROM audit_log ORDER BY ts DESC LIMIT 10000"""
    )
    data = [_audit_row(r) for r in rows]

    if fmt == "json":
        content = json.dumps(data, default=str, indent=2)
        return StreamingResponse(
            iter([content]),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=audit_log.json"},
        )
    else:
        output = io.StringIO()
        if data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit_log.csv"},
        )


# ──────────────────────────────────────────────────────────────────────────────
# STATISTICS
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/stats")
async def get_stats(
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    total_inferences = await db.fetchval("SELECT COUNT(*) FROM risk_reports WHERE deleted_at IS NULL")
    accepted = await db.fetchval(
        "SELECT COUNT(*) FROM risk_reports WHERE doctor_action = 'ACCEPTED' AND deleted_at IS NULL"
    )
    rejected = await db.fetchval(
        "SELECT COUNT(*) FROM risk_reports WHERE doctor_action = 'REJECTED' AND deleted_at IS NULL"
    )
    total_patients = await db.fetchval("SELECT COUNT(*) FROM patients WHERE deleted_at IS NULL")
    total_users = await db.fetchval("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL")
    return {
        "total_inferences": total_inferences,
        "accepted": accepted,
        "rejected": rejected,
        "pending_signature": total_inferences - (accepted or 0) - (rejected or 0),
        "acceptance_rate": round(accepted / total_inferences, 4) if total_inferences else 0,
        "total_patients": total_patients,
        "total_users": total_users,
    }


# ──────────────────────────────────────────────────────────────────────────────
# PATIENT ASSIGNMENTS
# ──────────────────────────────────────────────────────────────────────────────
class AssignmentCreate(BaseModel):
    patient_id: str
    doctor_id: str


@router.get("/assignments")
async def list_assignments(
    doctor_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    filters, params = [], []
    if doctor_id:
        params.append(doctor_id)
        filters.append(f"pa.doctor_id = ${len(params)}::uuid")
    if patient_id:
        params.append(patient_id)
        filters.append(f"pa.patient_id = ${len(params)}::uuid")
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    params += [limit, offset]
    rows = await db.fetch(
        f"""SELECT pa.id, pa.assigned_at,
                   p.id AS patient_id, p.name AS patient_name,
                   d.id AS doctor_id, d.username AS doctor_username,
                   ab.username AS assigned_by_username
            FROM patient_assignments pa
            JOIN patients p ON p.id = pa.patient_id
            JOIN users d ON d.id = pa.doctor_id
            LEFT JOIN users ab ON ab.id = pa.assigned_by
            {where}
            ORDER BY pa.assigned_at DESC
            LIMIT ${len(params)-1} OFFSET ${len(params)}""",
        *params,
    )
    total = await db.fetchval(
        f"SELECT COUNT(*) FROM patient_assignments pa {where}", *params[:-2]
    )
    return {
        "total": total, "limit": limit, "offset": offset,
        "entry": [_assignment_row(r) for r in rows],
    }


@router.post("/assignments", status_code=201)
async def create_assignment(
    body: AssignmentCreate,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    doctor = await db.fetchrow(
        "SELECT id, role FROM users WHERE id = $1::uuid AND deleted_at IS NULL", body.doctor_id
    )
    if not doctor or doctor["role"] != "MEDICO":
        raise HTTPException(400, "El usuario seleccionado no es un médico activo")

    patient = await db.fetchrow(
        "SELECT id FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", body.patient_id
    )
    if not patient:
        raise HTTPException(404, "Paciente no encontrado")

    row = await db.fetchrow(
        """INSERT INTO patient_assignments (patient_id, doctor_id, assigned_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid)
           ON CONFLICT (patient_id) DO UPDATE
             SET doctor_id   = EXCLUDED.doctor_id,
                 assigned_by = EXCLUDED.assigned_by,
                 assigned_at = now()
           RETURNING id, patient_id, doctor_id, assigned_at""",
        body.patient_id, body.doctor_id, str(user["id"]),
    )

    await log_audit(db, str(user["id"]), user["role"], "ASSIGN_PATIENT", "PatientAssignment",
                    str(row["id"]), request.client.host if request.client else None,
                    detail={"patient_id": body.patient_id, "doctor_id": body.doctor_id})
    return {
        "id": str(row["id"]),
        "patient_id": str(row["patient_id"]),
        "doctor_id": str(row["doctor_id"]),
        "assigned_at": row["assigned_at"].isoformat(),
    }


@router.delete("/assignments/{aid}", status_code=204)
async def delete_assignment(
    aid: str,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    result = await db.execute(
        "DELETE FROM patient_assignments WHERE id = $1::uuid", aid
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Asignación no encontrada")
    await log_audit(db, str(user["id"]), user["role"], "REMOVE_ASSIGNMENT", "PatientAssignment",
                    None, request.client.host if request.client else None)


@router.get("/assignments/doctors")
async def list_doctors(
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        "SELECT id, username FROM users WHERE role = 'MEDICO' AND deleted_at IS NULL AND is_active = TRUE ORDER BY username"
    )
    return [{"id": str(r["id"]), "username": r["username"]} for r in rows]


@router.get("/assignments/patients")
async def list_all_patients(
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        "SELECT id, name FROM patients WHERE deleted_at IS NULL ORDER BY name"
    )
    return [{"id": str(r["id"]), "name": r["name"]} for r in rows]


@router.get("/assignments/practitioners")
async def list_active_practitioners_for_assignment(
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    """Lista médicos externos activos para el selector de asignación."""
    from core.config import settings
    rows = await db.fetch(
        """SELECT id,
                  pgp_sym_decrypt(full_name_enc,      $1) AS full_name,
                  pgp_sym_decrypt(license_number_enc, $1) AS license_number
           FROM practitioners WHERE is_active = TRUE ORDER BY full_name_enc""",
        settings.AES_KEY,
    )
    return [{"id": str(r["id"]), "full_name": r["full_name"], "license_number": r["license_number"]} for r in rows]


# ── PRACTITIONER ASSIGNMENTS (médico externo ↔ paciente) ──────────────────────

class PractitionerAssignmentCreate(BaseModel):
    practitioner_id: str
    patient_id: str


@router.get("/practitioner-assignments")
async def list_practitioner_assignments(
    practitioner_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    from core.config import settings as _s
    filters, params = [], []
    if practitioner_id:
        params.append(practitioner_id)
        filters.append(f"pa.practitioner_id = ${len(params)}::uuid")
    if patient_id:
        params.append(patient_id)
        filters.append(f"pa.patient_id = ${len(params)}::uuid")
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    filter_count = len(params)
    params += [limit, offset, _s.AES_KEY]   # $N-2=limit, $N-1=offset, $N=AES_KEY
    n = len(params)
    rows = await db.fetch(
        f"""SELECT pa.id, pa.assigned_at,
                   p.id AS patient_id, p.name AS patient_name,
                   pr.id AS practitioner_id,
                   pgp_sym_decrypt(pr.full_name_enc,      ${n}) AS practitioner_name,
                   pgp_sym_decrypt(pr.license_number_enc, ${n}) AS license_number,
                   ab.username AS assigned_by_username
            FROM practitioner_assignments pa
            JOIN patients p  ON p.id  = pa.patient_id
            JOIN practitioners pr ON pr.id = pa.practitioner_id
            LEFT JOIN users ab ON ab.id = pa.assigned_by
            {where}
            ORDER BY pa.assigned_at DESC
            LIMIT ${n-2} OFFSET ${n-1}""",
        *params,
    )
    total = await db.fetchval(
        f"SELECT COUNT(*) FROM practitioner_assignments pa {where}", *params[:filter_count]
    )
    return {
        "total": total, "limit": limit, "offset": offset,
        "entry": [_pract_assignment_row(r) for r in rows],
    }


@router.post("/practitioner-assignments", status_code=201)
async def create_practitioner_assignment(
    body: PractitionerAssignmentCreate,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    practitioner = await db.fetchrow(
        "SELECT id, is_active FROM practitioners WHERE id = $1::uuid", body.practitioner_id
    )
    if not practitioner or not practitioner["is_active"]:
        raise HTTPException(400, "El médico externo no existe o está inactivo")

    patient = await db.fetchrow(
        "SELECT id FROM patients WHERE id = $1::uuid AND deleted_at IS NULL", body.patient_id
    )
    if not patient:
        raise HTTPException(404, "Paciente no encontrado")

    row = await db.fetchrow(
        """INSERT INTO practitioner_assignments (practitioner_id, patient_id, assigned_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid)
           ON CONFLICT (practitioner_id, patient_id) DO UPDATE
             SET assigned_by = EXCLUDED.assigned_by,
                 assigned_at = now()
           RETURNING id, practitioner_id, patient_id, assigned_at""",
        body.practitioner_id, body.patient_id, str(user["id"]),
    )
    await log_audit(
        db, str(user["id"]), user["role"],
        "ASSIGN_PATIENT_PRACTITIONER", "PractitionerAssignment",
        str(row["id"]), request.client.host if request.client else None,
        detail={"patient_id": body.patient_id, "practitioner_id": body.practitioner_id},
    )
    return {
        "id": str(row["id"]),
        "practitioner_id": str(row["practitioner_id"]),
        "patient_id": str(row["patient_id"]),
        "assigned_at": row["assigned_at"].isoformat(),
    }


@router.delete("/practitioner-assignments/{aid}", status_code=204)
async def delete_practitioner_assignment(
    aid: str,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    result = await db.execute(
        "DELETE FROM practitioner_assignments WHERE id = $1::uuid", aid
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Asignación no encontrada")
    await log_audit(
        db, str(user["id"]), user["role"],
        "REMOVE_PRACTITIONER_ASSIGNMENT", "PractitionerAssignment",
        None, request.client.host if request.client else None,
    )


# ── helpers ───────────────────────────────────────────────────────────────────
def _assignment_row(row) -> dict:
    return {
        "id": str(row["id"]),
        "patient_id": str(row["patient_id"]),
        "patient_name": row["patient_name"],
        "doctor_id": str(row["doctor_id"]),
        "doctor_username": row["doctor_username"],
        "assigned_by": row["assigned_by_username"],
        "assigned_at": row["assigned_at"].isoformat(),
    }


def _pract_assignment_row(row) -> dict:
    return {
        "id": str(row["id"]),
        "patient_id": str(row["patient_id"]),
        "patient_name": row["patient_name"],
        "practitioner_id": str(row["practitioner_id"]),
        "practitioner_name": row["practitioner_name"],
        "license_number": row["license_number"],
        "assigned_by": row["assigned_by_username"],
        "assigned_at": row["assigned_at"].isoformat(),
    }


def _audit_row(row) -> dict:
    return {
        "id": row["id"],
        "ts": row["ts"].isoformat(),
        "user_id": str(row["user_id"]) if row["user_id"] else None,
        "role": row["role"],
        "action": row["action"],
        "resource_type": row["resource_type"],
        "resource_id": str(row["resource_id"]) if row["resource_id"] else None,
        "ip_address": str(row["ip_address"]) if row["ip_address"] else None,
        "result": row["result"],
        "detail": row["detail"],
    }


# ──────────────────────────────────────────────────────────────────────────────
# ARCO REQUESTS (Ley 1581/2012 — Acceso, Rectificación, Cancelación, Oposición)
# ──────────────────────────────────────────────────────────────────────────────
from core.auth import require_authenticated   # ya importado arriba, redeclaración segura

class ArcoCreate(BaseModel):
    type: str        # ACCESO | RECTIFICACION | CANCELACION | OPOSICION
    message: str

class ArcoResolve(BaseModel):
    status: str      # RESOLVED | REJECTED
    resolution: str  # nota del admin


@router.post("/arco-request", status_code=201)
async def submit_arco(
    body: ArcoCreate,
    request: Request,
    user: dict = Depends(require_authenticated),
    db: asyncpg.Connection = Depends(get_db),
):
    """Paciente (o cualquier usuario autenticado) envía solicitud ARCO."""
    if body.type not in ("ACCESO", "RECTIFICACION", "CANCELACION", "OPOSICION"):
        raise HTTPException(400, "Tipo de solicitud inválido")
    if len(body.message) < 20:
        raise HTTPException(400, "La descripción debe tener al menos 20 caracteres")

    # Buscar patient_id vinculado si es PACIENTE
    patient_id = None
    if user["role"] == "PACIENTE":
        row = await db.fetchrow(
            "SELECT id FROM patients WHERE patient_user_id = $1::uuid AND deleted_at IS NULL",
            str(user["id"]),
        )
        if row:
            patient_id = str(row["id"])

    result = await db.fetchrow(
        """INSERT INTO arco_requests (user_id, patient_id, type, message)
           VALUES ($1::uuid, $2::uuid, $3, $4)
           RETURNING id, created_at""",
        str(user["id"]),
        patient_id,
        body.type,
        body.message,
    )
    await log_audit(db, str(user["id"]), user["role"], "ARCO_REQUEST", "ArcoRequest",
                    str(result["id"]), request.client.host if request.client else None,
                    detail={"type": body.type})
    return {"id": str(result["id"]), "created_at": result["created_at"]}


@router.get("/arco-requests")
async def list_arco_requests(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    """Admin: listar todas las solicitudes ARCO."""
    filters, params = [], []
    if status:
        params.append(status); filters.append(f"a.status = ${len(params)}")
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    params += [limit, offset]

    rows = await db.fetch(
        f"""SELECT a.id, a.type, a.message, a.status, a.resolution, a.created_at, a.resolved_at,
                   u.username, u.role AS user_role,
                   p.name AS patient_name
            FROM arco_requests a
            JOIN users u ON u.id = a.user_id
            LEFT JOIN patients p ON p.id = a.patient_id
            {where}
            ORDER BY a.created_at DESC
            LIMIT ${len(params)-1} OFFSET ${len(params)}""",
        *params,
    )
    total = await db.fetchval(
        f"SELECT COUNT(*) FROM arco_requests a {where}", *params[:-2]
    )
    return {
        "total": total, "limit": limit, "offset": offset,
        "entry": [_arco_row(r) for r in rows],
    }


@router.patch("/arco-requests/{rid}/resolve")
async def resolve_arco(
    rid: str,
    body: ArcoResolve,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    """Admin: marcar solicitud ARCO como resuelta o rechazada."""
    if body.status not in ("RESOLVED", "REJECTED"):
        raise HTTPException(400, "Estado inválido")
    row = await db.fetchrow("SELECT id FROM arco_requests WHERE id = $1::uuid", rid)
    if not row:
        raise HTTPException(404, "Solicitud no encontrada")
    await db.execute(
        """UPDATE arco_requests
           SET status = $1, resolution = $2, resolved_by = $3::uuid, resolved_at = NOW()
           WHERE id = $4::uuid""",
        body.status, body.resolution, str(user["id"]), rid,
    )
    await log_audit(db, str(user["id"]), user["role"], "ARCO_RESOLVE", "ArcoRequest",
                    rid, request.client.host if request.client else None,
                    detail={"status": body.status})
    return {"resolved": rid, "status": body.status}


def _arco_row(row) -> dict:
    return {
        "id": str(row["id"]),
        "type": row["type"],
        "message": row["message"],
        "status": row["status"],
        "resolution": row["resolution"],
        "username": row["username"],
        "user_role": row["user_role"],
        "patient_name": row["patient_name"],
        "created_at": row["created_at"].isoformat(),
        "resolved_at": row["resolved_at"].isoformat() if row["resolved_at"] else None,
    }


def _validate_password(password: str):
    if len(password) < 10:
        raise HTTPException(400, "Contraseña debe tener al menos 10 caracteres")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(400, "Contraseña debe tener al menos una mayúscula")
    if not re.search(r"\d", password):
        raise HTTPException(400, "Contraseña debe tener al menos un número")
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        raise HTTPException(400, "Contraseña debe tener al menos un símbolo")


# ── Médicos Externos (Practitioners / SuperUser) ──────────────────────────────

class CreatePractitionerAdminRequest(BaseModel):
    email: str
    password: str
    license_number: str
    full_name: str
    specialty: Optional[str] = None


@router.get("/practitioners")
async def list_practitioners(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    """Lista todos los médicos externos (practitioners) registrados."""
    from core.config import settings as _s
    rows = await db.fetch(
        """SELECT id,
                  pgp_sym_decrypt(email_enc,          $3) AS email,
                  pgp_sym_decrypt(license_number_enc, $3) AS license_number,
                  pgp_sym_decrypt(full_name_enc,      $3) AS full_name,
                  specialty, is_active, created_at
           FROM practitioners
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2""",
        limit, offset, _s.AES_KEY,
    )
    total = await db.fetchval("SELECT COUNT(*) FROM practitioners")
    return {
        "total": total,
        "entry": [
            {
                "id": str(r["id"]),
                "email": r["email"],
                "license_number": r["license_number"],
                "full_name": r["full_name"],
                "specialty": r["specialty"],
                "is_active": r["is_active"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
    }


@router.post("/practitioners", status_code=201)
async def create_practitioner(
    body: CreatePractitionerAdminRequest,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    """Crea un nuevo médico externo (SuperUser). Solo accesible para administradores."""
    from core.config import settings as _s
    from core.crypto import encrypt_value
    import bcrypt
    existing = await db.fetchrow(
        """SELECT id FROM practitioners
           WHERE pgp_sym_decrypt(email_enc,          $3) = $1
              OR pgp_sym_decrypt(license_number_enc, $3) = $2""",
        body.email, body.license_number, _s.AES_KEY,
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email o número de licencia ya registrado")

    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt(rounds=12)).decode()
    enc_email   = await encrypt_value(db, body.email)
    enc_name    = await encrypt_value(db, body.full_name)
    enc_license = await encrypt_value(db, body.license_number)
    row = await db.fetchrow(
        """INSERT INTO practitioners (email_enc, password_hash, license_number_enc, full_name_enc, specialty)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, created_at""",
        enc_email, pw_hash, enc_license, enc_name, body.specialty,
    )
    await log_audit(db, str(user["id"]), user["role"], "CREATE_PRACTITIONER", "Practitioner",
                    row["id"], request.client.host if request.client else None,
                    detail={"license": body.license_number})
    return {
        "id": str(row["id"]),
        "email": body.email,
        "full_name": body.full_name,
        "license_number": body.license_number,
        "created_at": row["created_at"].isoformat(),
    }


@router.patch("/practitioners/{pid}/password")
async def reset_practitioner_password(
    pid: str,
    body: dict,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    """Resetea la contraseña de un médico externo."""
    import bcrypt as _bcrypt
    password = body.get("password", "")
    if len(password) < 6:
        raise HTTPException(status_code=422, detail="La contraseña debe tener al menos 6 caracteres")
    row = await db.fetchrow("SELECT id FROM practitioners WHERE id = $1::uuid", pid)
    if not row:
        raise HTTPException(status_code=404, detail="Practitioner no encontrado")
    pw_hash = _bcrypt.hashpw(password.encode(), _bcrypt.gensalt(rounds=12)).decode()
    await db.execute("UPDATE practitioners SET password_hash = $1 WHERE id = $2::uuid", pw_hash, pid)
    await log_audit(db, str(user["id"]), user["role"], "RESET_PRACTITIONER_PASSWORD",
                    "Practitioner", row["id"], request.client.host if request.client else None)
    return {"status": "updated"}


@router.patch("/practitioners/{pid}")
async def toggle_practitioner(
    pid: str,
    request: Request,
    user: dict = Depends(require_admin),
    db: asyncpg.Connection = Depends(get_db),
):
    """Activa o desactiva un médico externo."""
    row = await db.fetchrow(
        "SELECT id, is_active FROM practitioners WHERE id = $1::uuid", pid,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Practitioner no encontrado")
    new_status = not row["is_active"]
    await db.execute(
        "UPDATE practitioners SET is_active = $1 WHERE id = $2::uuid", new_status, pid,
    )
    await log_audit(db, str(user["id"]), user["role"],
                    "ACTIVATE_PRACTITIONER" if new_status else "DEACTIVATE_PRACTITIONER",
                    "Practitioner", row["id"],
                    request.client.host if request.client else None)
    return {"id": pid, "is_active": new_status}


# ──────────────────────────────────────────────────────────────────────────────
# Model metrics proxy — agrega ML y DL sin reentrenar
# ──────────────────────────────────────────────────────────────────────────────
import httpx
from core.config import settings as _cfg

@router.get("/model-metrics")
async def get_model_metrics(user: dict = Depends(require_admin)):
    """Proxy a /ml/metrics y /dl/metrics. Agrega y retorna las métricas de ambos modelos."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r_ml = await client.get(f"{_cfg.ML_SERVICE_URL}/ml/metrics")
            ml_data = r_ml.json() if r_ml.status_code == 200 else {"error": "ML service no disponible"}
        except Exception:
            ml_data = {"error": "ML service no disponible"}

        try:
            r_dl = await client.get(f"{_cfg.DL_SERVICE_URL}/dl/metrics")
            dl_data = r_dl.json() if r_dl.status_code == 200 else {"error": "DL service no disponible"}
        except Exception:
            dl_data = {"error": "DL service no disponible"}

    return {"ml": ml_data, "dl": dl_data}