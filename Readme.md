# Sistema Clínico Digital Interoperable — Despliegue

## Conectarse al servidor

```bash
ssh root@147.182.131.232
```

```bash
cd /var/projects/Sistema-Clinico-Inteligente
```

---

## Levantar el sistema

```bash
make up
```

Otros comandos útiles:

```bash
make build    # Reconstruir imágenes y relanzar
make restart  # Reinicio rápido sin rebuild
make logs     # Ver logs en tiempo real
make health   # Verificar estado de servicios
make migrate  # Aplicar migraciones de BD
make backup   # Backup de PostgreSQL
```

---

## URLs del sistema

| Servicio | URL | Para qué sirve |
|---|---|---|
| Frontend | https://clinai.me | Interfaz clínica completa |
| Backend API | https://clinai.me/api/v1/docs | Swagger — probar endpoints |
| MinIO Console | `ssh -L 9001:localhost:9001 root@147.182.131.232 -N` | Consola MinIO (tunel SSH) |

---

## Credenciales — Staff (API)

| Usuario | Rol | Access Key | Permission Key | Activo |
| --- | --- | --- | --- | --- |
| admin | ADMIN | `d13e4618e587c3d42ece96cadcc30b37` | `d7146f286875d1e9c3018e18cff4750d` | true |
| admin2 | ADMIN | `0ce68b1afd244ec3448abc352570e2f8` | `58bff4427edfa9fb6a74bada13d69c9d` | true |
| medico1 | MEDICO | `a1b2c3d4e5f6789012345678901234ab` | `b2c3d4e5f678901234567890abcdef12` | true |
| medico2 | MEDICO | `436ea7af88920ca465c23864a75103e2` | `7add1bf58fa18692b35c0f45bddf3cbf` | true |

---

## Credenciales — SuperUser (médicos externos)

| Nombre | Correo | Contraseña | Licencia Médica |
| --- | --- | --- | --- |
| Juan Garcia | medico2@hospital.com | juan1234 | REG-123456 |
| Dr. Camilo Test | medico@clinai.com | password123 | REG-12345 |

---

## Credenciales — Pacientes

| Paciente | Usuario | X-Access-Key | X-Permission-Key |
| --- | --- | --- | --- |
| Álvaro Arnulfo Rojas Ortiz | alvaroarnulforojasor | `e3f8a2118e66c6e331ab3d2fd2b01f44` | `f6959864fe27e9dd9688d146100d3d99` |
| Antonio Luis Daza Ortiz | antonioluisdazaortiz | `201898cc32ac0e51d7122e30f46f27d4` | `8dcf4896232fddb218fd14391135985a` |
| Edilma Diana Torres Velásquez | edilmadianatorresvel | `d5879f72d7af6ab5ac129a6f4d532342` | `7a7f4ba52977950b2dbfe2179dc90d2a` |
| María López | marialopez | `af0c9b27155d99bc747f5df9f1b6b338` | `09dc62dbc763cd91997a3c32262d2e01` |
| Ocampo Ramírez Guzmán | ocamporamirezguzman | `5511dc0d3b79e7235c187fea384fbd14` | `7483f6703a7d442b711e7ddfd06e544a` |

# Estructura del Proyecto — Sistema Clínico Digital Interoperable

```
Sistema-Clinico-Inteligente/
│
├── docker-compose.yml          # Orquesta todos los servicios
├── Makefile                    # Comandos de despliegue (up, build, health, backup…)
├── .env                        # Variables de entorno (AES_KEY, JWT_SECRET, MinIO, etc.)
├── env.example                 # Plantilla de variables de entorno
├── Readme.md                   # Documentación principal
├── Readme_datasets.md          # Documentación de datasets de entrenamiento
│
├── nginx/                      # Proxy inverso + TLS
│   ├── nginx.conf              # Rutas, rate-limiting por CF-Connecting-IP, CORS
│   ├── Dockerfile
│   └── certs/
│       ├── cert.pem            # Certificado Cloudflare Origin (válido hasta 2041)
│       └── key.pem             # Clave privada SSL
│
├── backend/                    # API principal (FastAPI + asyncpg)
│   ├── main.py                 # App: CORS, middlewares, registro de routers
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── core/
│   │   ├── config.py           # Settings globales (DATABASE_URL, AES_KEY, MinIO, etc.)
│   │   ├── auth.py             # JWT, RBAC — roles ADMIN / MEDICO / PACIENTE
│   │   ├── crypto.py           # AES-256 (pgp_sym_encrypt/decrypt) para campos sensibles
│   │   ├── migrations.py       # Migraciones SQL automáticas al arrancar
│   │   └── audit.py            # Log de auditoría de acciones clínicas
│   └── routers/
│       ├── auth.py             # Login/logout, /auth/me, username en LoginResponse
│       ├── fhir.py             # FHIR R4: Patient, Media, RiskAssessment, Observation
│       ├── admin.py            # Gestión de usuarios, auditoría, ARCO (solo ADMIN)
│       └── superuser.py        # Portal médico externo: JWT propio, practitioner_assignments,
│                               # proxy /api/v1/superuser/agent/chat → rag-agent
│
├── Frontend/                   # Interfaz clínica (React + Vite)
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── nginx-spa.conf          # Nginx SPA — Cache-Control no-store en index.html,
│   │                           # immutable en assets con hash
│   ├── Dockerfile
│   └── src/
│       ├── main.jsx            # Punto de entrada React
│       ├── App.jsx             # Rutas principales por rol
│       ├── index.css
│       ├── components/
│       │   ├── InferencePanel.jsx      # Panel IA (ML/DL/Multimodal) con polling
│       │   ├── ImageViewer.jsx         # Visor imágenes médicas + Grad-CAM
│       │   ├── PatientImagenes.jsx     # Grid imágenes del paciente + subida a MinIO
│       │   ├── ObservationsChart.jsx   # Gráfica observaciones clínicas (LOINC)
│       │   ├── RiskReportForm.jsx      # Formulario firma médica del reporte de riesgo
│       │   ├── CreatePatientModal.jsx  # Modal crear nuevo paciente
│       │   ├── HabeasModal.jsx         # Modal consentimiento Habeas Data (Ley 1581/2012)
│       │   ├── Migrationpanel.jsx      # Panel migración FHIR
│       │   ├── layout.jsx              # Layout con sidebar y navbar
│       │   └── layout.css
│       ├── hooks/
│       │   └── useInferenceSocket.js   # Hook WebSocket inferencia en tiempo real
│       ├── services/
│       │   └── api.js                  # Cliente axios con interceptores de auth;
│       │                               # authAPI, fhirAPI, inferAPI, adminAPI,
│       │                               # assignmentAPI, arcoAPI, ragAPI, superuserAPI
│       ├── store/
│       │   └── auth.js                 # Estado global Zustand — token, role, userId,
│       │                               # username (persiste en sessionStorage)
│       └── views/
│           ├── login.jsx / login.css           # Pantalla de login
│           ├── dashboard.jsx / dashboard.css   # Dashboard — lista de pacientes
│           ├── PatientDetail.jsx / PatientDetail.css  # Detalle paciente (tabs)
│           ├── PatientView.jsx                 # Vista rol PACIENTE
│           ├── AdminPanel.jsx / AdminPanel.css # Panel administración de usuarios
│           ├── AgentView.jsx / AgentView.css   # Agente Clínico:
│           │                                   #   MEDICO → chat + ID paciente + export PDF
│           │                                   #   ADMIN  → RAGAS dashboard (solo lectura)
│           │                                   #            + config colapsable (modo RAG,
│           │                                   #              estado del índice)
│           ├── SuperUserView.jsx / SuperUserView.css  # Portal médico externo:
│           │                                          # búsqueda/creación de pacientes,
│           │                                          # observaciones, inferencia ML/DL,
│           │                                          # chat con agente clínico
│           └── index.css
│
├── rag-agent/                  # Agente RAG clínico (FastAPI + FAISS + BM25 + LLM)
│   ├── main.py                 # Endpoints: /agent/chat, /agent/ragas/*, /health
│   │                           # _fetch_patient_context: datos LOINC + risk_reports
│   │                           #   descifrados (pgp_sym_decrypt)
│   │                           # _patient_report_response: informe estructurado
│   │                           #   determinístico (sin tool-calling) cuando hay paciente
│   │                           # _agentic_response: ReAct + tools para consultas generales
│   │                           # _is_trusted_proxy_request + X-Granted-Patient-Id:
│   │                           #   autorización interna SuperUser → rag-agent
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── ragas_eval.py           # Evaluación RAGAS (faithfulness, relevance, context recall)
│   ├── ragas_report.json       # Resultados de la última evaluación RAGAS
│   ├── core/
│   │   ├── injection.py        # Anti prompt-injection: 20+ patrones, MAX_MESSAGE_LENGTH=2000,
│   │   │                       # detección JSON payloads, UUIDs múltiples, SQL injection,
│   │   │                       # listado masivo de pacientes; PII masking
│   │   ├── retriever.py        # Retriever híbrido FAISS + BM25
│   │   ├── memory.py           # Memoria conversacional por sesión (Redis) y largo plazo (PG)
│   │   └── tools.py            # Herramientas del agente:
│   │                           #   query_fhir, query_risk_reports (descifra prediction_enc),
│   │                           #   invoke_ml_model, invoke_dl_model,
│   │                           #   create_fhir_report, search_clinical_docs
│   ├── knowledge/              # Base de conocimiento clínico (20 documentos .txt)
│   │   ├── 01_diabetes_diagnostico.txt
│   │   ├── 02_retinopatia_diabetica.txt
│   │   └── … (guías ADA/OPS, FHIR R4, regulación colombiana, modelos ML/DL)
│   └── tests/
│       └── test_adversarial.py # 36 pruebas: injection attacks, falsos positivos, PII masking
│
├── ml-service/                 # Inferencia tabular — diabetes (FastAPI + ONNX)
│   ├── main.py                 # /ml/predict → XGBoost ONNX + SHAP values
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── models/
│   │   ├── ml_model.onnx       # Modelo XGBoost exportado a ONNX
│   │   └── ml_metadata.json    # Features, clases, risk_map
│   └── training/
│       └── train_and_export.py # Entrenamiento y exportación a ONNX
│
├── dl-service/                 # Inferencia por imagen — retinopatía (FastAPI + ONNX)
│   ├── main.py                 # /dl/predict → EfficientNet-B0 ONNX + Grad-CAM
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── models/
│   │   ├── dl_model.onnx       # EfficientNet-B0 exportado a ONNX
│   │   ├── dl_q8.pth           # Versión INT8 cuantizada (fallback)
│   │   └── dl_metadata.json    # Clases, risk_map, num_classes
│   └── training/
│       ├── train_and_export.py # Entrenamiento EfficientNet + exportación ONNX/INT8
│       ├── compute_auc.py      # Cálculo de AUC por clase
│       └── metrics.json        # Métricas del último entrenamiento
│
├── orchestrator/               # Cola de inferencias async (FastAPI)
│   ├── main.py                 # Recibe /infer, delega a ml-service o dl-service, guarda cifrado
│   ├── Dockerfile
│   └── requirements.txt
│
├── postgres/
│   └── init.sql                # Schema inicial + extensión pgcrypto
│
├── scripts/
│   └── seed_patients.py        # Poblar BD con pacientes y observaciones de prueba
│
└── datasets/                   # Datasets de entrenamiento (no incluidos en repo)
    ├── diabetes.csv            # Pima Indians Diabetes Dataset
    └── aptos/                  # APTOS 2019 — retinopatía diabética
```

---

## Flujo resumido

```
Browser (HTTPS) → Cloudflare → nginx:443
                                ├── /api/v1/*      → backend:8000
                                ├── /agent/*       → rag-agent:8004
                                ├── /minio/*       → minio:9000
                                └── /*             → frontend:80

backend → orchestrator:8003 → ml-service:8001
                             → dl-service:8002
backend → PostgreSQL:5432
rag-agent → PostgreSQL:5432 (pacientes, observaciones, risk_reports cifrados)
rag-agent → Redis (memoria conversacional por sesión)

SuperUser → backend /api/v1/superuser/* → rag-agent (proxy con X-Granted-Patient-Id)
```

## 🎬 Demo del sistema

> Haz clic en la imagen para ver el video de funcionamiento completo.

[![Demo del Sistema Clínico Digital Interoperable](https://drive.google.com/thumbnail?id=1X6uRLiFU0J6djXTPMCcJfaDo_pIcHVQ1&sz=w1280)](https://drive.google.com/file/d/1X6uRLiFU0J6djXTPMCcJfaDo_pIcHVQ1/view?usp=sharing)
