"""
compute_auc.py — Calcula AUC-ROC para el modelo DL sin reentrenar.
Reconstruye el split de validación idéntico al de entrenamiento (random_state=42)
y corre inferencia con el modelo ONNX exportado.
"""
import json, pathlib, warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from PIL import Image
from tqdm import tqdm
import onnxruntime as ort
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
from torchvision import transforms

MODELS_DIR  = pathlib.Path(__file__).parent.parent / "models"
DATASET_DIR = pathlib.Path(__file__).parent.parent.parent / "datasets" / "aptos"
IMG_DIR     = DATASET_DIR / "train_images"
LABELS_CSV  = DATASET_DIR / "train.csv"
METRICS_PATH = pathlib.Path(__file__).parent / "metrics.json"

IMG_SIZE = 224
NUM_CLASSES = 5

val_transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

def softmax(x):
    e = np.exp(x - x.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)

def main():
    if not LABELS_CSV.exists():
        raise FileNotFoundError(f"CSV no encontrado: {LABELS_CSV}")

    df = pd.read_csv(LABELS_CSV)
    _, df_val = train_test_split(df, test_size=0.15, stratify=df["diagnosis"], random_state=42)
    df_val = df_val.reset_index(drop=True)
    print(f"Validación: {len(df_val)} imágenes")

    onnx_path = MODELS_DIR / "dl_model.onnx"
    if not onnx_path.exists():
        raise FileNotFoundError(f"Modelo ONNX no encontrado: {onnx_path}")

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name

    all_probs  = []
    all_labels = []
    errors = 0

    for _, row in tqdm(df_val.iterrows(), total=len(df_val), desc="Inferencia"):
        img_path = IMG_DIR / f"{row['id_code']}.png"
        if not img_path.exists():
            errors += 1
            continue
        img    = Image.open(img_path).convert("RGB")
        tensor = val_transform(img).unsqueeze(0).numpy()
        logits = sess.run(None, {input_name: tensor})[0]
        probs  = softmax(logits)[0]
        all_probs.append(probs)
        all_labels.append(int(row["diagnosis"]))

    if errors:
        print(f"⚠️  {errors} imágenes no encontradas — omitidas")

    if len(all_labels) < 10:
        raise RuntimeError("Muy pocas muestras para calcular AUC")

    y_true  = np.array(all_labels)
    y_probs = np.array(all_probs)

    # AUC macro one-vs-rest (OvR) — estándar para clasificación multiclase
    auc_macro = roc_auc_score(y_true, y_probs, multi_class="ovr", average="macro")
    # AUC weighted para clases desbalanceadas
    auc_weighted = roc_auc_score(y_true, y_probs, multi_class="ovr", average="weighted")

    print(f"\n✅ AUC-ROC macro (OvR):    {auc_macro:.4f}")
    print(f"   AUC-ROC weighted (OvR): {auc_weighted:.4f}")
    print(f"   Muestras evaluadas:     {len(all_labels)}")

    # Actualiza metrics.json manteniendo lo existente
    existing = {}
    if METRICS_PATH.exists():
        existing = json.loads(METRICS_PATH.read_text())

    existing["auc_roc_macro"]    = round(auc_macro, 4)
    existing["auc_roc_weighted"] = round(auc_weighted, 4)
    existing["n_val"]            = len(all_labels)

    METRICS_PATH.write_text(json.dumps(existing, indent=2))
    print(f"\n💾 metrics.json actualizado → {METRICS_PATH}")

if __name__ == "__main__":
    main()
