"""
ml-service/training/train_and_export.py
Run ONCE locally (before docker build) to train + export ml_model.onnx.
"""

import json, os, pathlib, re, warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, StratifiedKFold
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

    # imputación clínica (ceros fisiológicamente imposibles → mediana)
    for col in ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]:
        df[col] = df[col].replace(0, df[col].median())

    X = df[FEATURE_COLS].values.astype("float32")
    y = df[TARGET_COL].values
    return X, y, df


# ─────────────────────────────────────────────────────────────
# Train
# ─────────────────────────────────────────────────────────────
PARAM_GRID = [
    # ── Ganadores confirmados (depth=5, lr=0.05, sin reg agresiva) ──
    # Variaciones de semilla: explorar distintos patrones de subsampling en Windows
    dict(learning_rate=0.05, max_depth=5, min_child_weight=7, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=42),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=7, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=0),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=7, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=7),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=7, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=13),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=7, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=100),
    # mcw=6 (runner-up) con semillas
    dict(learning_rate=0.05, max_depth=5, min_child_weight=6, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=42),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=6, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=0),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=6, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=7),
    # mcw=5 (tercer lugar) con semillas
    dict(learning_rate=0.05, max_depth=5, min_child_weight=5, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=42),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=5, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=0),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=5, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=7),
    # tree_method="exact" — algoritmo greedy exacto, determinista entre plataformas
    dict(learning_rate=0.05, max_depth=5, min_child_weight=7, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=42, _tree_method="exact"),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=6, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=42, _tree_method="exact"),
    dict(learning_rate=0.05, max_depth=5, min_child_weight=5, subsample=0.90, colsample_bytree=0.90, gamma=0.0, reg_alpha=0.0, reg_lambda=1.0, _seed=42, _tree_method="exact"),
]


def _best_threshold(model, X_val, y_val):
    y_val_proba = model.predict_proba(X_val)[:, 1]
    thresholds  = np.linspace(0.05, 0.95, 2000)
    best_t      = max(thresholds, key=lambda t: f1_score(y_val, (y_val_proba >= t).astype(int)))
    best_f1     = f1_score(y_val, (y_val_proba >= best_t).astype(int))
    return best_t, best_f1


def _make_clf(params, n_estimators, spw):
    p    = {k: v for k, v in params.items() if not k.startswith("_")}
    seed = params.get("_seed", 42)
    tm   = params.get("_tree_method", "hist")
    return XGBClassifier(
        n_estimators=n_estimators,
        scale_pos_weight=spw,
        objective="binary:logistic",
        tree_method=tm,
        eval_metric="logloss",
        random_state=seed,
        **p,
    )


def train(X, y):
    # Split: 85% train+val / 15% test, luego 75% train / 25% val
    X_tv, X_test, y_tv, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_tv, y_tv, test_size=0.25, random_state=42, stratify=y_tv
    )

    neg, pos = (y_train == 0).sum(), (y_train == 1).sum()
    spw_train = neg / pos

    # ── 1. Grid search — guardar TODOS los modelos ────────────────────────────
    print(f"  Grid search sobre {len(PARAM_GRID)} combinaciones...")
    all_results = []

    for i, params in enumerate(PARAM_GRID):
        clf = XGBClassifier(
            n_estimators=5000,
            scale_pos_weight=spw_train,
            objective="binary:logistic",
            tree_method="hist",
            eval_metric="logloss",
            early_stopping_rounds=150,
            random_state=42,
            **params,
        )
        clf.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

        t, vf1 = _best_threshold(clf, X_val, y_val)
        print(f"    [{i+1}/{len(PARAM_GRID)}] iter={clf.best_iteration:4d}  val_f1={vf1:.4f}  thresh={t:.2f}  lr={params['learning_rate']}  depth={params['max_depth']}")
        all_results.append({
            "val_f1": vf1, "val_thresh": t,
            "params": params, "n_est": clf.best_iteration + 1,
            "model": clf,
        })

    # ── 2. Ganador del grid search ────────────────────────────────────────────
    best = max(all_results, key=lambda r: r["val_f1"])
    print(f"\n  Ganador → val_f1={best['val_f1']:.4f}  n_est={best['n_est']}  seed={best['params'].get('_seed', 42)}  tm={best['params'].get('_tree_method','hist')}  thresh={best['val_thresh']:.2f}")

    # ── 3. Reentrenar en train+val completo ────────────────────────────────────
    spw_tv  = ((y_tv == 0).sum()) / ((y_tv == 1).sum())
    n_final = max(best["n_est"], int(best["n_est"] * len(X_tv) / len(X_train)))
    base    = _make_clf(best["params"], n_final, spw_tv)
    base.fit(X_tv, y_tv, verbose=False)

    # ── 4. Umbral OOF robusto con selección de plateau ────────────────────────
    print("  Estimando umbral via CV out-of-fold (5 folds)...")
    skf        = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    oof_probas = np.zeros(len(y_tv))

    for tr_idx, vl_idx in skf.split(X_tv, y_tv):
        spw_fold = ((y_tv[tr_idx] == 0).sum()) / ((y_tv[tr_idx] == 1).sum())
        fc = _make_clf(best["params"], n_final, spw_fold)
        fc.fit(X_tv[tr_idx], y_tv[tr_idx], verbose=False)
        oof_probas[vl_idx] = fc.predict_proba(X_tv[vl_idx])[:, 1]

    thresholds  = np.linspace(0.05, 0.95, 2000)
    oof_f1_vals = np.array([f1_score(y_tv, (oof_probas >= t).astype(int)) for t in thresholds])
    max_oof_f1  = oof_f1_vals.max()

    # Plateau: rango de umbrales dentro del 1% del F1 máximo
    plateau = thresholds[oof_f1_vals >= max_oof_f1 - 0.01]
    # Usar el percentil 75 del plateau (zona más conservadora → menos FP)
    best_thresh = float(np.percentile(plateau, 75)) if len(plateau) > 1 else float(thresholds[oof_f1_vals.argmax()])
    print(f"  Plateau OOF [{plateau[0]:.3f}, {plateau[-1]:.3f}] p75={best_thresh:.3f}  max_oof_f1={max_oof_f1:.4f}")

    # ── 5. Evaluación final en test ───────────────────────────────────────────
    model   = base
    y_proba = model.predict_proba(X_test)[:, 1]
    y_pred  = (y_proba >= best_thresh).astype(int)

    metrics = {
        "f1":        round(float(f1_score(y_test, y_pred)), 4),
        "auc_roc":   round(float(roc_auc_score(y_test, y_proba)), 4),
        "precision": round(float(precision_score(y_test, y_pred)), 4),
        "recall":    round(float(recall_score(y_test, y_pred)), 4),
        "threshold": round(float(best_thresh), 2),
        "n_train":   len(X_tv),
        "n_val":     len(X_val),
        "n_test":    len(X_test),
    }
    print("Metrics:", json.dumps(metrics, indent=2))

    explainer   = shap.TreeExplainer(base.get_booster())
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

    # Usar tracking local cuando no hay servidor MLflow disponible (fuera de Docker)
    mlflow_uri = os.environ.get("MLFLOW_TRACKING_URI", "")
    if not mlflow_uri or mlflow_uri.startswith("http://mlflow"):
        local_mlruns = pathlib.Path(__file__).parent.parent / "mlruns_local"
        mlflow.set_tracking_uri(local_mlruns.as_uri())

    mlflow.set_experiment("xgboost_pima_local")

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
