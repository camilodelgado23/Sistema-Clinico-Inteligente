"""
core/injection.py — Anti prompt-injection middleware y output filtering.
"""
import json
import re
import logging
from datetime import datetime, timezone
from fastapi import HTTPException

logger = logging.getLogger("injection")

# Límite de longitud de mensaje (caracteres)
MAX_MESSAGE_LENGTH = 2000

INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions?",
    r"system\s*:",
    r"you\s+are\s+now",
    r"\bDAN\b",
    r"jailbreak",
    r"forget\s+(your|all)\s+(instructions?|rules?|constraints?)",
    r"act\s+as\s+(if\s+you\s+are|a)?",
    r"pretend\s+(you\s+are|to\s+be)",
    r"override\s+(safety|instructions?)",
    r"base64|[A-Za-z0-9+/]{35,}={0,2}",   # palabra "base64" o string base64 largo
    r"###\s*(INSTRUCTION|SYSTEM|PROMPT)",
    r"<\s*/?system\s*>",
    r"\\u[0-9a-fA-F]{4}",
    # Patrones de exfiltración / inyección de datos de pacientes
    r'"patient[s]?"\s*:\s*[\[\{]',                              # JSON con campo "patients"
    r'"(password|token|secret|api_key|auth)"\s*:',             # credenciales en JSON
    r'"(name|birthDate|document_number|cedula)"\s*:.*"(name|birthDate|document_number|cedula)"\s*:',  # múltiples campos PII
    r"dame\s+(todos?\s+los?\s+)?pacientes",                    # solicitud de listado masivo
    r"lista\s+(todos?\s+los?\s+)?pacientes",
    r"muéstrame\s+(todos?\s+los?\s+)?pacientes",
    r"show\s+all\s+patients",
    r"dump\s+(all\s+)?(patients?|data|records?|users?)",
    r"select\s+\*\s+from",                                     # SQL injection
    r";\s*(drop|delete|insert|update|create)\s+",
]

PII_PATTERNS = {
    "cedula": re.compile(
        r"\b\d{6,10}\b(?=\s*(?:CC|cédula|cedula|documento))"       # número seguido de label
        r"|(?:CC|cédula|cedula|documento)[:\s]+(\d{6,10})\b",      # label seguido de número
        re.IGNORECASE
    ),
    "email": re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"),
    "telefono": re.compile(r"\b(3\d{9}|60\d{8})\b"),
}

_compiled = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in INJECTION_PATTERNS]

# Regex para detectar múltiples UUIDs en un mismo mensaje (posible inyección de IDs de pacientes)
_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)


def _reject(reason: str, user_id: str, ip: str, snippet: str, code: str = "PROMPT_INJECTION_DETECTED") -> None:
    logger.warning(
        "INJECTION_BLOCKED | ts=%s | user=%s | ip=%s | reason=%s | snippet=%.80r",
        datetime.now(timezone.utc).isoformat(),
        user_id,
        ip,
        reason,
        snippet,
    )
    raise HTTPException(
        status_code=400,
        detail={
            "error": "INPUT_REJECTED",
            "message": "La consulta contiene patrones no permitidos.",
            "code": code,
        },
    )


def sanitize_input(text: str, user_id: str = "unknown", ip: str = "unknown") -> str:
    """
    Lanza HTTP 400 si detecta prompt injection, payload JSON estructurado,
    o intentos de exfiltración de datos de otros pacientes.
    """
    # 1. Límite de longitud
    if len(text) > MAX_MESSAGE_LENGTH:
        _reject("mensaje_demasiado_largo", user_id, ip, text[:80], "MESSAGE_TOO_LONG")

    stripped = text.strip()

    # 2. Rechazar payloads JSON estructurados como mensaje completo
    #    (el ejemplo del profesor: enviar un .json para extraer datos)
    if stripped.startswith(("{", "[")):
        try:
            json.loads(stripped)
            # Si parsea como JSON válido, es un payload estructurado, no una consulta clínica
            _reject("json_payload_como_mensaje", user_id, ip, stripped[:120], "JSON_PAYLOAD_REJECTED")
        except (json.JSONDecodeError, ValueError):
            pass  # No es JSON válido, continuar con las demás validaciones

    # 3. Múltiples UUIDs en el mensaje (inyección de IDs de pacientes ajenos)
    uuids_found = _UUID_RE.findall(stripped)
    if len(uuids_found) > 1:
        _reject("multiples_uuids", user_id, ip, stripped[:120], "PATIENT_ID_INJECTION")

    # 4. Patrones de inyección conocidos
    for i, pattern in enumerate(_compiled):
        match = pattern.search(stripped)
        if match:
            _reject(f"patron_{i}", user_id, ip, stripped[:120])

    return text


def mask_pii(text: str) -> str:
    """Enmascara PII en respuestas antes de enviar al cliente."""
    def _mask_cedula(m):
        num = m.group(1) if m.group(1) else m.group()
        return m.group().replace(num, num[:2] + "****" + num[-2:])
    text = PII_PATTERNS["cedula"].sub(_mask_cedula, text)
    text = PII_PATTERNS["email"].sub(lambda m: m.group()[:3] + "***@***.***", text)
    text = PII_PATTERNS["telefono"].sub(lambda m: m.group()[:3] + "****" + m.group()[-3:], text)
    return text
