"""
dl-service/training/train_and_export.py
Fine-tunes EfficientNet-B0 on APTOS 2019 retinopathy dataset.
Exports INT8 quantized model + ONNX alternative.
Dataset: APTOS 2019 Blindness Detection (Kaggle)
  https://www.kaggle.com/competitions/aptos2019-blindness-detection
  Place images in: datasets/aptos/train_images/
  Place labels in: datasets/aptos/train.csv  (columns: id_code, diagnosis)
"""
import json, pathlib, warnings, time
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from PIL import Image
from tqdm import tqdm

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models
from sklearn.model_selection import train_test_split
from sklearn.metrics import f1_score, roc_auc_score, accuracy_score
import mlflow
import mlflow.pytorch

MODELS_DIR   = pathlib.Path(__file__).parent.parent / "models"
DATASET_DIR  = pathlib.Path(__file__).parent.parent.parent / "datasets" / "aptos"
IMG_DIR      = DATASET_DIR / "train_images"
LABELS_CSV   = DATASET_DIR / "train.csv"
MODELS_DIR.mkdir(exist_ok=True)

NUM_CLASSES  = 5
IMG_SIZE     = 224
BATCH_SIZE   = 32
EPOCHS       = 10
LR           = 1e-4
DEVICE       = "cpu"   # enforce CPU — no CUDA allowed on VPS

CLASS_NAMES  = ["No DR", "Mild", "Moderate", "Severe", "Proliferative DR"]

# Risk mapping: class → risk_category
RISK_MAP = {
    0: "LOW",
    1: "LOW",
    2: "MEDIUM",
    3: "HIGH",
    4: "CRITICAL",
}


# ── Dataset ───────────────────────────────────────────────────────────────────
class APTOSDataset(Dataset):
    def __init__(self, df: pd.DataFrame, img_dir: pathlib.Path, transform):
        self.df       = df.reset_index(drop=True)
        self.img_dir  = img_dir
        self.transform = transform

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row   = self.df.iloc[idx]
        path  = self.img_dir / f"{row['id_code']}.png"
        img   = Image.open(path).convert("RGB")
        label = int(row["diagnosis"])
        return self.transform(img), label


def get_transforms(train: bool):
    if train:
        return transforms.Compose([
            transforms.Resize((IMG_SIZE + 32, IMG_SIZE + 32)),
            transforms.RandomCrop(IMG_SIZE),
            transforms.RandomHorizontalFlip(),
            transforms.RandomVerticalFlip(),
            transforms.ColorJitter(brightness=0.2, contrast=0.2),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
    return transforms.Compose([
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])


# ── Model ─────────────────────────────────────────────────────────────────────
def build_model() -> nn.Module:
    model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
    # Replace classifier head for 5 classes
    in_features = model.classifier[1].in_features
    model.classifier[1] = nn.Linear(in_features, NUM_CLASSES)
    return model.to(DEVICE)


# ── Training ──────────────────────────────────────────────────────────────────
def train_epoch(model, loader, optimizer, criterion):
    model.train()
    total_loss, correct, total = 0.0, 0, 0
    for imgs, labels in tqdm(loader, desc="  train", leave=False):
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        optimizer.zero_grad()
        logits = model(imgs)
        loss   = criterion(logits, labels)
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * len(imgs)
        correct    += (logits.argmax(1) == labels).sum().item()
        total      += len(imgs)
    return total_loss / total, correct / total


@torch.no_grad()
def eval_epoch(model, loader, criterion):
    model.eval()
    total_loss, all_preds, all_labels = 0.0, [], []
    for imgs, labels in tqdm(loader, desc="  eval ", leave=False):
        imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
        logits = model(imgs)
        loss   = criterion(logits, labels)
        total_loss += loss.item() * len(imgs)
        all_preds.extend(logits.argmax(1).cpu().numpy())
        all_labels.extend(labels.cpu().numpy())
    n = len(all_labels)
    acc = accuracy_score(all_labels, all_preds)
    f1  = f1_score(all_labels, all_preds, average="weighted", zero_division=0)
    return total_loss / n, acc, f1


# ── Quantization ──────────────────────────────────────────────────────────────
def quantize_int8(model: nn.Module, save_path: pathlib.Path) -> nn.Module:
    model.eval()
    model_q8 = torch.quantization.quantize_dynamic(
        model,
        {nn.Linear, nn.Conv2d},
        dtype=torch.qint8,
    )
    torch.save(model_q8.state_dict(), save_path)
    size_mb = save_path.stat().st_size / 1e6
    print(f"✅ INT8 model saved → {save_path}  ({size_mb:.1f} MB)")
    return model_q8


def export_onnx(model: nn.Module, save_path: pathlib.Path):
    model.eval()
    dummy = torch.randn(1, 3, IMG_SIZE, IMG_SIZE)
    torch.onnx.export(
        model, dummy, str(save_path),
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}},
        opset_version=17,
    )
    size_mb = save_path.stat().st_size / 1e6
    print(f"✅ ONNX model saved → {save_path}  ({size_mb:.1f} MB)")

    # Smoke-test
    import onnxruntime as ort
    sess = ort.InferenceSession(str(save_path), providers=["CPUExecutionProvider"])
    out  = sess.run(None, {"image": dummy.numpy()})
    print(f"   ONNX smoke-test OK — logits shape: {out[0].shape}")


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not LABELS_CSV.exists():
        raise FileNotFoundError(
            f"Labels not found at {LABELS_CSV}\n"
            "Download APTOS 2019 from:\n"
            "  https://www.kaggle.com/competitions/aptos2019-blindness-detection\n"
            "Place files at:\n"
            "  datasets/aptos/train.csv\n"
            "  datasets/aptos/train_images/*.png"
        )

    df = pd.read_csv(LABELS_CSV)
    df_train, df_val = train_test_split(df, test_size=0.15,
                                        stratify=df["diagnosis"], random_state=42)
    print(f"Train: {len(df_train)} | Val: {len(df_val)}")

    train_ds = APTOSDataset(df_train, IMG_DIR, get_transforms(train=True))
    val_ds   = APTOSDataset(df_val,   IMG_DIR, get_transforms(train=False))
    train_dl = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,  num_workers=2)
    val_dl   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False, num_workers=2)

    model     = build_model()
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)

    best_f1, best_state = 0.0, None
    metrics_log = []

    with mlflow.start_run(run_name="efficientnet_b0_aptos2019"):
        for epoch in range(1, EPOCHS + 1):
            t0 = time.time()
            tr_loss, tr_acc = train_epoch(model, train_dl, optimizer, criterion)
            vl_loss, vl_acc, vl_f1 = eval_epoch(model, val_dl, criterion)
            scheduler.step()
            elapsed = time.time() - t0

            print(f"Epoch {epoch:2d}/{EPOCHS} | "
                  f"loss {tr_loss:.4f}/{vl_loss:.4f} | "
                  f"acc {tr_acc:.3f}/{vl_acc:.3f} | "
                  f"f1 {vl_f1:.3f} | {elapsed:.0f}s")
            mlflow.log_metrics({"val_loss": vl_loss, "val_acc": vl_acc,
                                 "val_f1": vl_f1}, step=epoch)

            if vl_f1 > best_f1:
                best_f1    = vl_f1
                best_state = {k: v.clone() for k, v in model.state_dict().items()}

            metrics_log.append({"epoch": epoch, "val_f1": vl_f1, "val_acc": vl_acc})

    # Restore best checkpoint
    model.load_state_dict(best_state)
    model.eval()

    # Quantize INT8
    q8_path = MODELS_DIR / "dl_q8.pth"
    model_q8 = quantize_int8(model, q8_path)

    # Export ONNX (from unquantized model — better ONNX compatibility)
    onnx_path = MODELS_DIR / "dl_model.onnx"
    export_onnx(model, onnx_path)

    # Save metadata
    meta = {
        "dataset":     "APTOS 2019 Blindness Detection",
        "architecture": "EfficientNet-B0 fine-tuned",
        "num_classes":  NUM_CLASSES,
        "class_names":  CLASS_NAMES,
        "risk_map":     RISK_MAP,
        "img_size":     IMG_SIZE,
        "best_val_f1":  round(best_f1, 4),
        "epochs":       EPOCHS,
        "normalize":    {"mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
        "clinical_note": (
            "Retinopatía diabética detectada mediante fondos de ojo. "
            "Clases 3-4 corresponden a riesgo HIGH/CRITICAL. "
            "Complementa el modelo tabular PIMA de riesgo de diabetes."
        ),
    }
    meta_path = MODELS_DIR / "dl_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"✅ Metadata → {meta_path}")

    # Metrics for README
    metrics_path = pathlib.Path(__file__).parent / "metrics.json"
    with open(metrics_path, "w") as f:
        json.dump({"best_val_f1": best_f1, "epochs": metrics_log}, f, indent=2)

    print(f"\n🎉 Done! Best val F1: {best_f1:.4f}")
    print("Run: docker compose build dl-service")