"""
ml-service/training/train_and_export.py
Run ONCE locally (before docker build) to train + export ml_model.onnx.
"""

import json, pathlib, re, warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import train_test_split
from sklearn.metrics import f1_score, roc_auc_score, precision_score, recall_score
from xgboost import XGBClassifier
import shap
import mlflow
import mlflow.sklearn

# ONNX
from onnxmltools import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType
import onnxruntime as ort


# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────
MODELS_DIR   = pathlib.Path(__file__).parent.parent / "models"
DATASET_PATH = pathlib.Path(__file__).parent.parent.parent / "datasets" / "diabetes.csv"
MODELS_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────
FEATURE_COLS = [
    "Pregnancies", "Glucose", "BloodPressure", "SkinThickness",
    "Insulin", "BMI", "DiabetesPedigreeFunction", "Age",
]
TARGET_COL = "Outcome"

LOINC_MAP = {
    "Glucose": "2339-0",
    "BloodPressure": "55284-4",
    "BMI": "39156-5",
    "Insulin": "14749-6",
    "Age": "21612-7",
    "Pregnancies": "11996-6",
    "SkinThickness": "39106-0",
    "DiabetesPedigreeFunction": "33914-3",
}


# ─────────────────────────────────────────────────────────────
# Load data
# ─────────────────────────────────────────────────────────────
def load_data():
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Dataset not found at {DATASET_PATH}")

    df = pd.read_csv(DATASET_PATH)

    # imputación clínica
    for col in ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]:
        df[col] = df[col].replace(0, df[col].median())

    X = df[FEATURE_COLS].values.astype("float32")
    y = df[TARGET_COL].values
    return X, y, df


# ─────────────────────────────────────────────────────────────
# Train
# ─────────────────────────────────────────────────────────────
def train(X, y):
    # Split 60 / 20 / 20
    X_tv, X_test, y_tv, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_tv, y_tv, test_size=0.25, random_state=42, stratify=y_tv
    )

    neg, pos = (y_train == 0).sum(), (y_train == 1).sum()
    spw = neg / pos

    base = XGBClassifier(
        n_estimators=1000,
        max_depth=5,
        learning_rate=0.01,
        scale_pos_weight=spw,
        subsample=0.80,
        colsample_bytree=0.80,
        min_child_weight=2,
        gamma=0.05,
        reg_alpha=0.05,
        reg_lambda=1.5,
        tree_method="hist",
        eval_metric="logloss",
        early_stopping_rounds=50,
        random_state=42,
    )

    base.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
    print(f"  Mejor n_estimators: {base.best_iteration}")

    # Calibración isotónica sobre val (cv='prefit')
    model = CalibratedClassifierCV(base, method="isotonic", cv="prefit")
    model.fit(X_val, y_val)

    # Umbral óptimo sobre val (sin data leakage del test)
    y_val_proba = model.predict_proba(X_val)[:, 1]
    thresholds = np.arange(0.25, 0.70, 0.01)
    best_thresh = max(thresholds,
                      key=lambda t: f1_score(y_val, (y_val_proba >= t).astype(int)))
    print(f"  Umbral óptimo (val): {best_thresh:.2f}")

    # Evaluación final en test
    y_proba = model.predict_proba(X_test)[:, 1]
    y_pred  = (y_proba >= best_thresh).astype(int)

    metrics = {
        "f1":        round(float(f1_score(y_test, y_pred)), 4),
        "auc_roc":   round(float(roc_auc_score(y_test, y_proba)), 4),
        "precision": round(float(precision_score(y_test, y_pred)), 4),
        "recall":    round(float(recall_score(y_test, y_pred)), 4),
        "threshold": round(float(best_thresh), 2),
        "n_train":   len(X_train),
        "n_val":     len(X_val),
        "n_test":    len(X_test),
    }

    print("Metrics:", metrics)

    # SHAP sobre base (sin envoltorio de calibración)
    explainer = shap.TreeExplainer(base)
    shap_sample = X_train[:100]

    return model, base, explainer, metrics, shap_sample, X_test, y_test


# ─────────────────────────────────────────────────────────────
# Export ONNX
# ─────────────────────────────────────────────────────────────
def export_onnx(base_model, n_features: int):
    initial_type = [("float_input", FloatTensorType([None, n_features]))]

    onnx_model = convert_xgboost(base_model, initial_types=initial_type)

    out_path = MODELS_DIR / "ml_model.onnx"
    with open(out_path, "wb") as f:
        f.write(onnx_model.SerializeToString())
    print("Model exported:", out_path)

    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    dummy = np.zeros((2, n_features), dtype="float32")
    sess.run(None, {"float_input": dummy})
    print("ONNX test OK")

    return str(out_path)


# ─────────────────────────────────────────────────────────────
# Save metadata
# ─────────────────────────────────────────────────────────────
def save_metadata(metrics: dict, shap_sample, feature_cols: list):
    decision_threshold = metrics.get("threshold", 0.5)
    meta = {
        "feature_cols": feature_cols,
        "loinc_map": LOINC_MAP,
        "metrics": metrics,
        "decision_threshold": decision_threshold,
        "model_type": "xgboost",
        "thresholds": {
            "LOW":      [0.0,  0.30],
            "MEDIUM":   [0.30, 0.60],
            "HIGH":     [0.60, 0.85],
            "CRITICAL": [0.85, 1.0],
        },
    }

    meta_path = MODELS_DIR / "ml_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print("Metadata saved:", meta_path)

    metrics_path = pathlib.Path(__file__).parent / "metrics.json"
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)


# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Loading dataset...")
    X, y, df = load_data()

    print("Training model (XGBoost)...")
    with mlflow.start_run(run_name="xgboost_calibrated_pima"):
        model, base, explainer, metrics, shap_sample, X_test, y_test = train(X, y)
        mlflow.log_metrics(metrics)
        mlflow.sklearn.log_model(model, "calibrated_xgboost")

    print("Exporting to ONNX...")
    export_onnx(base, n_features=len(FEATURE_COLS))

    print("Saving metadata...")
    save_metadata(metrics, shap_sample, FEATURE_COLS)

    print("Done!")
    print(f"F1={metrics['f1']}  AUC-ROC={metrics['auc_roc']}")
