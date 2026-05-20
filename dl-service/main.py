"""
dl-service/main.py
FastAPI — Inferencia EfficientNet-B0 ONNX/INT8 + Grad-CAM → MinIO
Tiempo máximo CPU: < 15 segundos
"""
import io, json, os, time, pathlib
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import asyncpg
import numpy as np
import onnxruntime as ort
from PIL import Image
import torch
import torch.nn as nn
from torchvision import models, transforms
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from minio import Minio

# ✅ boto3 para presigned URLs sin conexión HTTP (mismo fix que backend)
import boto3
from botocore.config import Config

# ── Config ────────────────────────────────────────────────────────────────────
MODELS_DIR    = pathlib.Path(__file__).parent / "models"
ONNX_PATH     = MODELS_DIR / "dl_model.onnx"
Q8_PATH       = MODELS_DIR / "dl_q8.pth"
META_PATH     = MODELS_DIR / "dl_metadata.json"
DATABASE_URL  = os.getenv("DATABASE_URL")
MINIO_ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY",  "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY",  "minioadmin")
MINIO_BUCKET     = os.getenv("MINIO_BUCKET",       "clinical-images")
PRESIGN_EXPIRY   = int(os.getenv("PRESIGN_EXPIRY_SECONDS", "3600"))

# ── Globals ───────────────────────────────────────────────────────────────────
_ort_sess:    ort.InferenceSession | None = None
_torch_model: nn.Module | None = None
_meta:        dict = {}
_pool:        asyncpg.Pool | None = None
_mc:          Minio | None = None
_use_onnx:    bool = True

# ── Image preprocessing ───────────────────────────────────────────────────────
_preprocess = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _ort_sess, _torch_model, _meta, _pool, _mc, _use_onnx

    # Load metadata
    if META_PATH.exists():
        with open(META_PATH) as f:
            _meta = json.load(f)

    # Try ONNX first
    if ONNX_PATH.exists():
        _ort_sess = ort.InferenceSession(
            str(ONNX_PATH),
            providers=["CPUExecutionProvider"],
        )
        _use_onnx = True
        print(f"✅ ONNX model loaded: {ONNX_PATH}")
    elif Q8_PATH.exists():
        _torch_model = _load_torch_q8(Q8_PATH)
        _use_onnx = False
        print(f"✅ INT8 PyTorch model loaded: {Q8_PATH}")
    else:
        raise RuntimeError(
            "No model found. Run: python training/train_and_export.py"
        )

    # MinIO client (interno — solo para subir y leer objetos)
    _mc = Minio(MINIO_ENDPOINT, access_key=MINIO_ACCESS_KEY,
                secret_key=MINIO_SECRET_KEY, secure=False)
    _ensure_bucket()

    # DB pool
    if DATABASE_URL:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)

    yield

    if _pool:
        await _pool.close()


def _load_torch_q8(path: pathlib.Path) -> nn.Module:
    model = models.efficientnet_b0(weights=None)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features,
                                     _meta.get("num_classes", 5))
    model_q8 = torch.quantization.quantize_dynamic(
        model, {nn.Linear, nn.Conv2d}, dtype=torch.qint8
    )
    model_q8.load_state_dict(
        torch.load(str(path), map_location="cpu"), strict=False
    )
    model_q8.eval()
    return model_q8


def _ensure_bucket():
    try:
        if not _mc.bucket_exists(MINIO_BUCKET):
            _mc.make_bucket(MINIO_BUCKET)
    except Exception as e:
        print(f"⚠️  MinIO bucket check failed: {e}")


app = FastAPI(title="DL Image Service", lifespan=lifespan)


# ── Inference helpers ─────────────────────────────────────────────────────────
def preprocess_image(img_bytes: bytes) -> tuple[np.ndarray, torch.Tensor]:
    img    = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    tensor = _preprocess(img)
    arr    = tensor.unsqueeze(0).numpy()
    return arr, tensor.unsqueeze(0)


def run_onnx_inference(arr: np.ndarray) -> np.ndarray:
    logits = _ort_sess.run(None, {"image": arr})[0]
    return logits


def run_torch_inference(tensor: torch.Tensor) -> np.ndarray:
    with torch.no_grad():
        logits = _torch_model(tensor).numpy()
    return logits


def softmax(logits: np.ndarray) -> np.ndarray:
    e = np.exp(logits - logits.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


# ── Presigned URL (boto3 — sin conexión HTTP al firmar) ───────────────────────
def _make_presigned_url(key: str) -> str:
    """
    Genera presigned URL firmada con localhost:9000 usando boto3.
    boto3.generate_presigned_url() es cálculo HMAC puro — no hace ninguna
    conexión HTTP, por lo que funciona perfectamente dentro del contenedor
    aunque localhost:9000 no sea alcanzable desde él.

    MinIO verifica la firma con MINIO_SERVER_URL=http://localhost:9000 → ✅
    """
    s3 = boto3.client(
        "s3",
        endpoint_url="http://minio:9000",
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": MINIO_BUCKET, "Key": key},
        ExpiresIn=PRESIGN_EXPIRY,
    )


def upload_to_minio(key: str, data: bytes, content_type: str = "image/png") -> str:
    """
    Sube bytes a MinIO con el cliente interno (minio:9000 — siempre alcanzable)
    y devuelve presigned URL firmada con boto3 (localhost:9000 — accesible por el browser).
    """
    _mc.put_object(
        MINIO_BUCKET, key,
        io.BytesIO(data), length=len(data),
        content_type=content_type,
    )
    return _make_presigned_url(key)


# ── Grad-CAM ──────────────────────────────────────────────────────────────────
class GradCAMHook:
    """
    Hooks into the last conv block of EfficientNet-B0 to extract
    Grad-CAM activation maps. Requires non-quantized PyTorch model.
    """
    def __init__(self, model: nn.Module):
        self.gradients   = None
        self.activations = None
        target_layer = model.features[-1]
        target_layer.register_forward_hook(self._save_activations)
        target_layer.register_full_backward_hook(self._save_gradients)

    def _save_activations(self, module, input, output):
        self.activations = output.detach()

    def _save_gradients(self, module, grad_input, grad_output):
        self.gradients = grad_output[0].detach()

    def compute(self, logits: torch.Tensor, class_idx: int,
                orig_size: tuple[int, int]) -> np.ndarray:
        logits[0, class_idx].backward()
        weights = self.gradients.mean(dim=(2, 3), keepdim=True)
        cam     = (weights * self.activations).sum(dim=1).squeeze(0)
        cam     = torch.relu(cam).numpy()
        cam     = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)
        cam_pil = Image.fromarray((cam * 255).astype(np.uint8)).resize(
            orig_size, Image.BILINEAR
        )
        return np.array(cam_pil)


def _render_heatmap_overlay(img: Image.Image, cam: np.ndarray) -> bytes:
    """Aplica colormap 'hot' sobre cam [0,1] y hace blend con img. Retorna PNG bytes."""
    import matplotlib
    matplotlib.use("Agg")
    try:
        colormap = matplotlib.colormaps["hot"]
    except AttributeError:
        import matplotlib.cm as cm
        colormap = cm.get_cmap("hot")
    cam_rgb = (colormap(cam)[:, :, :3] * 255).astype(np.uint8)
    cam_pil = Image.fromarray(cam_rgb).resize(img.size, Image.BILINEAR)
    overlay = Image.blend(img.convert("RGBA"), cam_pil.convert("RGBA"), alpha=0.4)
    out = io.BytesIO()
    overlay.convert("RGB").save(out, format="PNG")
    return out.getvalue()


def _generate_occlusion_map(img_bytes: bytes, pred_class: int) -> Optional[bytes]:
    """
    Occlusion sensitivity map (gradient-free) usando ONNX.
    Desliza una máscara gris sobre la imagen; las regiones cuya oclusión
    produce mayor caída en la probabilidad predicha se colorean con más intensidad.
    ~169 inferencias ONNX ≈ 3-5 s en CPU.
    """
    try:
        img     = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img_224 = img.resize((224, 224))
        img_arr = np.array(img_224, dtype=np.float32)   # (224, 224, 3) en [0,255]

        PATCH  = 32   # tamaño del parche de oclusión en píxeles
        STRIDE = 16   # paso del parche
        H, W   = 224, 224

        # Relleno gris = media ImageNet en espacio [0, 255]
        gray = np.array([0.485 * 255, 0.456 * 255, 0.406 * 255], dtype=np.float32)

        # Probabilidad base (sin oclusión)
        baseline_arr, _ = preprocess_image(img_bytes)
        baseline_prob = float(softmax(run_onnx_inference(baseline_arr))[0][pred_class])

        sensitivity = np.zeros((H, W), dtype=np.float32)
        count       = np.zeros((H, W), dtype=np.float32)

        for y in range(0, H - PATCH + 1, STRIDE):
            for x in range(0, W - PATCH + 1, STRIDE):
                occluded = img_arr.copy()
                occluded[y:y + PATCH, x:x + PATCH] = gray

                inp  = _preprocess(Image.fromarray(occluded.astype(np.uint8))).unsqueeze(0).numpy()
                prob = float(softmax(run_onnx_inference(inp))[0][pred_class])

                drop = baseline_prob - prob   # positivo = región importante
                sensitivity[y:y + PATCH, x:x + PATCH] += drop
                count[y:y + PATCH, x:x + PATCH] += 1

        valid = count > 0
        sensitivity[valid] /= count[valid]

        lo, hi = sensitivity.min(), sensitivity.max()
        if hi > lo:
            sensitivity = (sensitivity - lo) / (hi - lo)

        print(f"✅ Occlusion sensitivity map generado (baseline_prob={baseline_prob:.3f})")
        return _render_heatmap_overlay(img, sensitivity)

    except Exception as e:
        print(f"⚠️  Occlusion sensitivity map failed: {e}")
        return None


def generate_gradcam(img_bytes: bytes, pred_class: int) -> Optional[bytes]:
    """
    Genera heatmap y lo superpone a la imagen original. Retorna PNG bytes.
    - Con pesos PyTorch disponibles: Grad-CAM verdadero (backprop).
    - Solo ONNX: occlusion sensitivity map (gradient-free).
    """
    has_weights = Q8_PATH.exists() or (not _use_onnx and _torch_model is not None)
    if not has_weights:
        print("ℹ️  Grad-CAM: sin pesos PyTorch — usando occlusion sensitivity map")
        return _generate_occlusion_map(img_bytes, pred_class)

    try:
        img    = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        tensor = _preprocess(img).unsqueeze(0).requires_grad_(True)

        gcam_model = models.efficientnet_b0(weights=None)
        gcam_model.classifier[1] = nn.Linear(
            gcam_model.classifier[1].in_features, _meta.get("num_classes", 5)
        )
        if Q8_PATH.exists():
            gcam_model.load_state_dict(
                torch.load(str(Q8_PATH), map_location="cpu"), strict=False
            )
        elif not _use_onnx and _torch_model is not None:
            gcam_model.load_state_dict(_torch_model.state_dict(), strict=False)

        gcam_model.eval()
        hook    = GradCAMHook(gcam_model)
        logits  = gcam_model(tensor)
        cam_arr = hook.compute(logits, pred_class, img.size)   # [0, 255] uint8

        return _render_heatmap_overlay(img, cam_arr / 255.0)
    except Exception as e:
        print(f"⚠️  Grad-CAM failed: {e}")
        return None


# ── Fetch imagen desde MinIO ──────────────────────────────────────────────────
async def fetch_patient_image(patient_id: str) -> Optional[tuple[bytes, str]]:
    """
    Retorna (img_bytes, minio_key) o None si no hay imagen.
    """
    aes_key = os.getenv("AES_KEY")
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT pgp_sym_decrypt(minio_key, $2) AS plain_key
               FROM images
               WHERE patient_id = $1::uuid AND deleted_at IS NULL
               ORDER BY created_at DESC LIMIT 1""",
            patient_id, aes_key,
        )
    if not row:
        return None
    key = row["plain_key"]
    response = _mc.get_object(MINIO_BUCKET, key)
    try:
        return response.read(), key
    finally:
        response.close()
        response.release_conn()


# ── Endpoints ─────────────────────────────────────────────────────────────────
class PredictByPatientRequest(BaseModel):
    patient_id: str


@app.post("/dl/predict")
async def predict(
    patient_id: Optional[str] = None,
    file: Optional[UploadFile] = File(default=None),
):
    """
    Acepta:
      - multipart/form-data con imagen (file=)
      - query param patient_id=<uuid>  (busca imagen en MinIO)
    """
    t0 = time.perf_counter()

    # 1. Obtener bytes de imagen
    original_key = None
    if file is not None:
        img_bytes = await file.read()
    elif patient_id:
        result_fetch = await fetch_patient_image(patient_id)
        if not result_fetch:
            raise HTTPException(
                404,
                f"No image found for patient {patient_id}. "
                "Upload an image first via POST /fhir/Media/upload"
            )
        img_bytes, original_key = result_fetch
    else:
        raise HTTPException(400, "Provide either file or patient_id")

    # 2. Preprocesamiento
    arr, tensor = preprocess_image(img_bytes)

    # 3. Inferencia
    if _use_onnx:
        logits = run_onnx_inference(arr)
    else:
        logits = run_torch_inference(tensor)

    probs    = softmax(logits)[0]
    pred_cls = int(probs.argmax())
    risk_map = _meta.get("risk_map", {str(i): "UNKNOWN" for i in range(5)})
    risk_cat = risk_map.get(str(pred_cls), risk_map.get(pred_cls, "UNKNOWN"))

    class_names = _meta.get("class_names",
                             ["No DR", "Mild", "Moderate", "Severe", "Proliferative DR"])

    # 4. Grad-CAM + upload
    ts  = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    pid = patient_id or "upload"
    gradcam_url  = None
    original_url = None

    cam_bytes = generate_gradcam(img_bytes, pred_cls)
    if cam_bytes:
        cam_key     = f"gradcam/{pid}_{ts}.png"
        gradcam_url = upload_to_minio(cam_key, cam_bytes)   # ✅ presigned con boto3

    # Presigned URL de la imagen original (para mostrar lado a lado en el frontend)
    if original_key:
        original_url = _make_presigned_url(original_key)    # ✅ presigned con boto3

    elapsed = (time.perf_counter() - t0) * 1000
    if elapsed > 15000:
        print(f"⚠️  DL inference took {elapsed:.0f}ms — exceeds 15s target")

    # 5. FHIR DiagnosticReport
    snomed_map = {
        "LOW":      "193349004",
        "MEDIUM":   "193350004",
        "HIGH":     "193351000",
        "CRITICAL": "59276001",
    }
    diagnostic_report = {
        "resourceType":   "DiagnosticReport",
        "status":         "final",
        "subject":        {"reference": f"Patient/{patient_id}"} if patient_id else None,
        "conclusion":     class_names[pred_cls],
        "conclusionCode": [{
            "coding": [{
                "system":  "http://snomed.info/sct",
                "code":    snomed_map.get(risk_cat, "193349004"),
                "display": class_names[pred_cls],
            }]
        }],
        "imagingStudy":   [{"display": f"Retinal fundus image — {pid}"}],
        "media":          [{"link": {"url": gradcam_url}}] if gradcam_url else [],
    }

    return {
        "patient_id":      patient_id,
        "predicted_class": pred_cls,
        "class_name":      class_names[pred_cls],
        "probabilities":   {class_names[i]: round(float(p), 4)
                            for i, p in enumerate(probs)},
        "risk_score":      round(float(probs[pred_cls]), 4),
        "risk_category":   risk_cat,
        "is_critical":     risk_cat == "CRITICAL",
        "gradcam_url":     gradcam_url,      # ✅ presigned con localhost:9000
        "original_url":    original_url,     # ✅ nuevo — imagen original presignada
        "fhir_diagnostic": diagnostic_report,
        "model":           "EfficientNet-B0 ONNX" if _use_onnx else "EfficientNet-B0 INT8",
        "elapsed_ms":      round(elapsed, 1),
        "disclaimer":      (
            "Resultado generado por IA de apoyo diagnóstico. "
            "No reemplaza criterio médico. Sujeto a revisión clínica."
        ),
    }


class FeedbackRequest(BaseModel):
    risk_report_id: str
    feedback:       str
    notes:          Optional[str] = None


@app.post("/dl/feedback", status_code=201)
async def save_feedback(body: FeedbackRequest):
    if not _pool:
        raise HTTPException(500, "DB not available")
    async with _pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO model_feedback (risk_report_id, feedback, notes)
               VALUES ($1::uuid, $2, $3)
               ON CONFLICT DO NOTHING""",
            body.risk_report_id, body.feedback, body.notes,
        )
    return {"status": "saved"}


@app.get("/dl/version")
async def version():
    return {
        "model":       "EfficientNet-B0",
        "format":      "ONNX CPUExecutionProvider" if _use_onnx else "INT8 PyTorch",
        "dataset":     _meta.get("dataset", "APTOS 2019"),
        "num_classes": _meta.get("num_classes", 5),
        "class_names": _meta.get("class_names", []),
        "risk_map":    _meta.get("risk_map", {}),
        "best_val_f1": _meta.get("best_val_f1", "N/A"),
        "clinical_note": _meta.get("clinical_note", ""),
    }


@app.get("/dl/metrics")
async def metrics():
    import json, pathlib
    metrics_path = pathlib.Path(__file__).parent / "training" / "metrics.json"
    raw = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    return {
        "model":         "EfficientNet-B0 fine-tuned",
        "task":          "retinopathy",
        "dataset":       _meta.get("dataset", "APTOS 2019 Blindness Detection"),
        "architecture":  _meta.get("architecture", "EfficientNet-B0"),
        "num_classes":   _meta.get("num_classes", 5),
        "class_names":   _meta.get("class_names", []),
        "risk_map":      _meta.get("risk_map", {}),
        "clinical_note": _meta.get("clinical_note", ""),
        "best_val_f1":      raw.get("best_val_f1", _meta.get("best_val_f1")),
        "auc_roc_macro":    raw.get("auc_roc_macro"),
        "auc_roc_weighted": raw.get("auc_roc_weighted"),
        "n_val":            raw.get("n_val"),
        "epochs":           raw.get("epochs", []),
    }


@app.get("/health")
async def health():
    return {
        "status":       "ok",
        "service":      "dl-service",
        "model_loaded": _ort_sess is not None or _torch_model is not None,
        "backend":      "ONNX" if _use_onnx else "INT8-PyTorch",
    }