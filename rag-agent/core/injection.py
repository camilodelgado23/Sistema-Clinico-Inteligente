"""
core/injection.py — Anti prompt-injection middleware y output filtering.
"""
import re
from fastapi import HTTPException

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
    r"base64",
    r"###\s*(INSTRUCTION|SYSTEM|PROMPT)",
    r"<\s*/?system\s*>",
    r"\\u[0-9a-fA-F]{4}",
]

PII_PATTERNS = {
    "cedula": re.compile(r"\b\d{6,10}\b(?=\s*(CC|cédula|cedula|documento))", re.IGNORECASE),
    "email": re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"),
    "telefono": re.compile(r"\b(3\d{9}|60\d{8})\b"),
}

_compiled = [re.compile(p, re.IGNORECASE) for p in INJECTION_PATTERNS]


def sanitize_input(text: str) -> str:
    """Lanza HTTP 400 si detecta prompt injection."""
    for pattern in _compiled:
        if pattern.search(text):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "INPUT_REJECTED",
                    "message": "La consulta contiene patrones no permitidos.",
                    "code": "PROMPT_INJECTION_DETECTED",
                },
            )
    return text


def mask_pii(text: str) -> str:
    """Enmascara PII en respuestas antes de enviar al cliente."""
    text = PII_PATTERNS["email"].sub(lambda m: m.group()[:3] + "***@***.***", text)
    text = PII_PATTERNS["telefono"].sub(lambda m: m.group()[:3] + "****" + m.group()[-3:], text)
    return text
