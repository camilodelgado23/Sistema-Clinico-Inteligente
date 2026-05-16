"""
core/audit.py — Audit log INSERT-ONLY
Acciones mínimas auditadas según rubrica del Proyecto 2.
"""
import json
from typing import Optional
import asyncpg

ACTIONS = {
    "LOGIN", "LOGOUT", "LIST_PATIENTS", "VIEW_PATIENT",
    "UPLOAD_IMAGE", "RUN_INFERENCE", "INFERENCE_COMPLETED",
    "SIGN_REPORT", "CRITICAL_ALERT_TRIGGERED", "CRITICAL_ALERT_RESOLVED",
    "CREATE_USER", "DELETE_USER", "HABEAS_DATA_ACCEPTED", "CLOSE_PATIENT",
    "UPDATE_USER", "RESTORE_ENTITY", "EXPORT_AUDIT",
}

async def log_audit(
    db: asyncpg.Connection,
    user_id: Optional[str],
    role: Optional[str],
    action: str,
    resource_type: str,
    resource_id: Optional[str],
    ip_address: Optional[str],
    result: str = "SUCCESS",
    detail: Optional[dict] = None,
):
    """
    INSERT-ONLY audit log entry. Never call UPDATE or DELETE on audit_log.
    """
    await db.execute(
        """INSERT INTO audit_log
           (user_id, role, action, resource_type, resource_id, ip_address, result, detail)
           VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::inet, $7, $8)""",
        user_id,
        role,
        action,
        resource_type,
        resource_id,
        ip_address,
        result,
        json.dumps(detail) if detail else None,
    )