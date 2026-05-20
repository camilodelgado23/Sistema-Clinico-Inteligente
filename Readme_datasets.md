# Datasets — Instrucciones de Descarga

Los datasets **NO están incluidos** en el repositorio (`.gitignore` los excluye).
Descárgalos manualmente y colócalos en las rutas indicadas.

---

## 1. PIMA Indians Diabetes (ML Tabular)

**Fuente:** UCI ML / Kaggle  
**Tamaño:** ~24 KB, 768 filas, 8 features  
**Uso:** entrenamiento del modelo XGBoost + seed de pacientes  

**Descarga:**
```bash
# Opción A — Kaggle CLI
kaggle datasets download -d uciml/pima-indians-diabetes-database
unzip pima-indians-diabetes-database.zip -d datasets/
mv datasets/diabetes.csv datasets/diabetes.csv   # ya viene con ese nombre

# Opción B — UCI ML directo
wget https://raw.githubusercontent.com/jbrownlee/Datasets/master/pima-indians-diabetes.data.csv \
     -O datasets/diabetes.csv
# Agregar header manualmente:
sed -i '1s/^/Pregnancies,Glucose,BloodPressure,SkinThickness,Insulin,BMI,DiabetesPedigreeFunction,Age,Outcome\n/' \
    datasets/diabetes.csv
```

**Ruta esperada:** `datasets/diabetes.csv`

**Columnas:**
| Columna | LOINC | Unidad | Descripción |
|---------|-------|--------|-------------|
| Pregnancies | 11996-6 | {count} | Número de embarazos |
| Glucose | 2339-0 | mg/dL | Glucosa plasmática (2h) |
| BloodPressure | 55284-4 | mmHg | Presión arterial diastólica |
| SkinThickness | 39106-0 | mm | Grosor pliegue cutáneo tríceps |
| Insulin | 14749-6 | uU/mL | Insulina sérica (2h) |
| BMI | 39156-5 | kg/m2 | Índice masa corporal |
| DiabetesPedigreeFunction | 33914-3 | {score} | Función pedigrí diabetes |
| Age | 21612-7 | a | Edad |
| Outcome | — | — | 1=diabético, 0=no diabético (ground truth) |

---

## 2. APTOS 2019 Blindness Detection (DL Imágenes)

**Fuente:** Kaggle Competition  
**Tamaño:** ~9 GB (3,662 imágenes JPG/PNG)  
**Uso:** entrenamiento EfficientNet-B0 + seed de imágenes de fondo de ojo  

**Descarga:**
```bash
# Requiere cuenta Kaggle + aceptar reglas de la competencia
kaggle competitions download -c aptos2019-blindness-detection
unzip aptos2019-blindness-detection.zip -d datasets/aptos/
```

**Estructura esperada:**
```
datasets/
└── aptos/
    ├── train.csv              # id_code, diagnosis (0-4)
    └── train_images/
        ├── 000c1434d8d7.png
        ├── 001639a390f0.png
        └── ...
```

**Clases (diagnosis):**
| Clase | Nombre | Risk Category |
|-------|--------|---------------|
| 0 | No DR | LOW |
| 1 | Mild | LOW |
| 2 | Moderate | MEDIUM |
| 3 | Severe | HIGH |
| 4 | Proliferative DR | CRITICAL |

**Justificación clínica:**  
La retinopatía diabética es una complicación directa de la diabetes. El modelo tabular PIMA predice riesgo de diabetes; el modelo APTOS analiza el daño retinal causado por esa misma enfermedad. Ambos modelos son complementarios y su fusión (análisis multimodal) produce una evaluación clínica más completa.

---

## Estructura final de datasets/

```
datasets/
├── README_datasets.md      ← este archivo
├── diabetes.csv            ← PIMA (768 filas)
└── aptos/
    ├── train.csv
    └── train_images/       ← 3,662 imágenes PNG
```

## Verificación

```bash
# Verificar PIMA
python -c "import pandas as pd; df = pd.read_csv('datasets/diabetes.csv'); print(f'PIMA: {len(df)} filas')"

# Verificar APTOS
python -c "
import pathlib, pandas as pd
imgs = list(pathlib.Path('datasets/aptos/train_images').glob('*.png'))
df   = pd.read_csv('datasets/aptos/train.csv')
print(f'APTOS: {len(imgs)} imágenes, {len(df)} etiquetas')
print(df.diagnosis.value_counts().sort_index())
"
```
