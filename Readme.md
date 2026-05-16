# Sistema Clínico Digital Interoperable — Despliegue

## Conectarse al servidor

```bash
ssh root@24.144.105.184
```

```bash
cd ~/Sistema-Cl-nico-Digital-Interoperable
```

---

## Levantar el sistema

```bash
docker compose up -d
```

> ⚠️ MLflow está apagado por defecto (consume demasiados recursos).
> Si los necesitas: `docker compose start mlflow`

---

## URLs del sistema

| Servicio | URL | Para qué sirve |
|---|---|---|
| Frontend | http://24.144.105.184:3000 | Interfaz clínica completa |
| Backend Swagger | http://24.144.105.184:8000/docs | Probar endpoints directamente |
| ML Service | http://24.144.105.184:8001/docs | Endpoints del modelo tabular |
| DL Service | http://24.144.105.184:8002/docs | Endpoints del modelo de imágenes |
| Orchestrator | http://24.144.105.184:8003/docs | Cola de inferencias |
| MinIO Console | http://24.144.105.184:9001 | Ver imágenes almacenadas |

---

## Credenciales — Staff

| Usuario | Rol | Access Key | Permission Key |
|---|---|---|---|
| admin | ADMIN | admin-access-key-001 | admin-perm-key-001 |
| medico1 | MEDICO | 2aca485d4737d306c54855e7658e4676 | 32002b84b268b49ab1909fbca76323e0 |
| medico3 | MEDICO | b9beafe1f1fecec10ce8082a351b67ac | 427308ff69e8dcec9a4b7a177ba641b2 |

---

## Credenciales — Pacientes

| Paciente | Usuario | X-Access-Key | X-Permission-Key |
|---|---|---|---|
| Leidy Hurtado Tamayo | leidyhurtadotamayo | 4043ed12eb69b7832b40d1941109385e | e4609b9c8d7242530aa769b6a47551b3 |
| Eduardo Serna Peña | eduardosernapena | de08861d3425b680d8e081c0a56d3e4f | fc3afc1e8b8782088186f181282b96bf |
| Dahiana Beatriz Zambrano | dahianabeatrizzambra | eca70f80ad17580309b4801c923093f4 | 94227756e1a1ce11ddd8a5ad14d741ad |
| Juan Meza | juanmeza | 52ea50ab9fd9dc530d0a7e931bfd27e1 | 64ab8a8ffe9cf0b64e8719bcdc338fea |
| Alfonso Danilo Beltrán Molina | alfonsodanilobeltran | f0d5420d6bb4dbfb8dff4cf2953641fd | 7c5857c1e2818fd62e2ba968260e9a7f |
| Aida Zapata | aidazapata | bd600f492e588325240be1b5651ff0bc | c9882d7beb31ce6c90e5c31f7cb06934 |

# Estructura del Proyecto — Sistema Clínico Digital Interoperable

```
Sistema-Clínico-Digital-Interoperable/
│
├── docker-compose.yml          # Orquesta todos los servicios (nginx, backend, frontend, ml, dl, etc.)
├── env.example                 # Plantilla de variables de entorno
├── Readme.md                   # Documentación principal
├── Readme_datasets.md          # Documentación de los datasets usados para entrenar
│
├── nginx/                      # Proxy inverso
│   ├── nginx.conf              # Configuración de rutas, timeouts, rate-limiting y CORS
│   └── certs/
│       ├── cert.pem            # Certificado SSL
│       └── key.pem             # Clave privada SSL
│
├── backend/                    # API principal (FastAPI)
│   ├── main.py                 # App FastAPI: CORS, middlewares, routers, proxy a orquestador
│   ├── Dockerfile              # Imagen Docker del backend
│   ├── requirements.txt        # Dependencias Python
│   ├── .env                    # Variables de entorno (DB, MinIO, claves)
│   ├── core/
│   │   ├── config.py           # Settings globales (DATABASE_URL, MinIO, CORS, etc.)
│   │   ├── auth.py             # JWT, RBAC, validación de roles (ADMIN, MEDICO, PACIENTE)
│   │   ├── crypto.py           # Cifrado AES-256 para datos sensibles
│   │   ├── migrations.py       # SQL de migraciones automáticas al arrancar
│   │   └── audit.py            # Registro de auditoría de acciones
│   └── routers/
│       ├── auth.py             # Endpoints de login, registro, logout
│       ├── fhir.py             # Endpoints FHIR R4 (Patient, Media, RiskAssessment, etc.)
│       └── admin.py            # Endpoints de administración (gestión de usuarios)
│
├── frontend/                   # Interfaz clínica (React + Vite)
│   ├── index.html              # HTML base
│   ├── vite.config.js          # Configuración de Vite
│   ├── package.json            # Dependencias Node
│   ├── nginx-spa.conf          # Nginx para servir el SPA en producción
│   ├── Dockerfile              # Imagen Docker del frontend
│   ├── .env                    # VITE_API_URL y otras variables
│   └── src/
│       ├── main.jsx            # Punto de entrada React
│       ├── App.jsx             # Rutas principales
│       ├── index.css           # Estilos globales
│       ├── components/
│       │   ├── InferencePanel.jsx      # Panel de análisis IA (ML/DL/Multimodal) con polling
│       │   ├── ImageViewer.jsx         # Visor de imágenes médicas con zoom y Grad-CAM
│       │   ├── PatientImagenes.jsx     # Grid de imágenes del paciente + subida
│       │   ├── ObservationsChart.jsx   # Gráfica de observaciones clínicas (LOINC)
│       │   ├── RiskReportForm.jsx      # Formulario de firma médica del reporte de riesgo
│       │   ├── CreatePatientModal.jsx  # Modal para crear nuevo paciente
│       │   ├── HabeasModal.jsx         # Modal de consentimiento Habeas Data
│       │   ├── MigrationPanel.jsx      # Panel de migración FHIR
│       │   ├── Layout.jsx              # Layout general con sidebar y navbar
│       │   └── Layout.css             # Estilos del layout
│       ├── hooks/
│       │   └── useInferenceSocket.js   # Hook WebSocket para tiempo real en inferencia
│       ├── services/
│       │   └── api.js                  # Cliente axios con interceptores de auth
│       ├── store/
│       │   └── auth.js                 # Estado global de autenticación (Zustand)
│       └── views/
│           ├── Login.jsx / Login.css           # Pantalla de login
│           ├── Dashboard.jsx / Dashboard.css   # Dashboard principal con lista de pacientes
│           ├── PatientDetail.jsx / PatientDetail.css  # Vista detalle del paciente (tabs)
│           ├── PatientView.jsx                 # Vista de paciente desde rol PACIENTE
│           ├── AdminPanel.jsx / AdminPanel.css # Panel de administración de usuarios
│           └── index.css                       # Estilos de vistas
│
├── ml-service/                 # Servicio de inferencia tabular (FastAPI)
│   ├── main.py                 # Endpoints ML: /ml/predict con modelo ONNX tabular
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env                    # DATABASE_URL, MODEL_PATH, etc.
│   ├── models/
│   │   ├── ml_model.onnx       # Modelo XGBoost/RandomForest exportado a ONNX
│   │   └── ml_metadata.json    # Metadatos: features, clases, risk_map
│   └── training/
│       └── train_and_export.py # Script de entrenamiento y exportación a ONNX
│
├── dl-service/                 # Servicio de inferencia por imagen (FastAPI)
│   ├── main.py                 # Endpoints DL: /dl/predict con EfficientNet-B0 ONNX + Grad-CAM
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env                    # DATABASE_URL, MINIO_*, MODEL_PATH, etc.
│   ├── models/
│   │   ├── dl_model.onnx       # EfficientNet-B0 exportado a ONNX
│   │   ├── dl_q8.pth           # Versión INT8 cuantizada del modelo (fallback)
│   │   └── dl_metadata.json    # Metadatos: clases, risk_map, num_classes
│   └── training/
│       ├── train_and_export.py # Entrenamiento EfficientNet + exportación ONNX/INT8
│       └── metrics.json        # Métricas del último entrenamiento
│
├── orchestrator/               # Cola de inferencias (FastAPI)
│   ├── main.py                 # Gestiona tareas async: recibe /infer, llama ml-service o dl-service
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env                    # URLs de ml-service y dl-service
│
├── scripts/
│   └── seed_patients.py        # Script para poblar la BD con pacientes y observaciones de prueba
│
└── datasets/                   # Datasets para entrenamiento (no incluidos en repo)
```

---

## Flujo resumido

```
Browser → nginx:80 → backend:8000 → orchestrator:8003 → ml-service:8001
                                                        → dl-service:8002
                   → MinIO:9000 (imágenes)
                   → PostgreSQL/Render (datos clínicos)
```

## 🎬 Demo del sistema

> Haz clic en la imagen para ver el video de funcionamiento completo.

[![Demo del Sistema Clínico Digital Interoperable](https://drive.google.com/thumbnail?id=1X6uRLiFU0J6djXTPMCcJfaDo_pIcHVQ1&sz=w1280)](https://drive.google.com/file/d/1X6uRLiFU0J6djXTPMCcJfaDo_pIcHVQ1/view?usp=sharing)