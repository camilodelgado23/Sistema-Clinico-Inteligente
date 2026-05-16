"""
scripts/seed_patients.py
Genera ≥ 30 pacientes sintéticos desde PIMA Diabetes + imágenes APTOS 2019.

Requisitos:
  pip install pandas faker minio requests

Uso (con el sistema levantado):
  python scripts/seed_patients.py
"""
import os, pathlib, time
import pandas as pd
from faker import Faker
import requests

# ── Config ────────────────────────────────────────────────────────────────────
API_URL    = os.getenv("API_URL",    "http://localhost:8000")
ACCESS_KEY = os.getenv("ACCESS_KEY", "d13e4618e587c3d42ece96cadcc30b37")
PERM_KEY   = os.getenv("PERM_KEY",   "d7146f286875d1e9c3018e18cff4750d")

DIABETES_CSV = pathlib.Path("datasets/diabetes.csv")
APTOS_DIR    = pathlib.Path("datasets/aptos/train_images")

MIN_PATIENTS  = 30
MIN_WITH_IMG  = 15

# ── LOINC mapping ─────────────────────────────────────────────────────────────
LOINC = {
    "Glucose":                  "2339-0",
    "BloodPressure":            "55284-4",
    "BMI":                      "39156-5",
    "Insulin":                  "14749-6",
    "Age":                      "21612-7",
    "Pregnancies":              "11996-6",
    "SkinThickness":            "39106-0",
    "DiabetesPedigreeFunction": "33914-3",
}

UNIT_MAP = {
    "Glucose":                  "mg/dL",
    "BloodPressure":            "mmHg",
    "BMI":                      "kg/m2",
    "Insulin":                  "uU/mL",
    "Age":                      "a",
    "Pregnancies":              "{count}",
    "SkinThickness":            "mm",
    "DiabetesPedigreeFunction": "{score}",
}

faker = Faker("es_CO")


def login() -> str:
    r = requests.post(
        f"{API_URL}/auth/login",
        headers={"X-Access-Key": ACCESS_KEY, "X-Permission-Key": PERM_KEY},
    )
    r.raise_for_status()
    return r.json()["access_token"]


def create_patient(token: str, name: str, birth_date: str,
                   id_doc: str, ground_truth: int) -> str:
    r = requests.post(
        f"{API_URL}/fhir/Patient",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={"name": name, "birth_date": birth_date,
              "identification_doc": id_doc, "ground_truth": ground_truth},
    )
    r.raise_for_status()
    return r.json()["id"]


def create_observation(token: str, patient_id: str,
                       loinc_code: str, value: float, unit: str):
    r = requests.post(
        f"{API_URL}/fhir/Observation",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json={"patient_id": patient_id, "loinc_code": loinc_code,
              "value": value, "unit": unit, "status": "final"},
    )
    r.raise_for_status()


def upload_image(token: str, patient_id: str, img_path: pathlib.Path):
    """
    ✅ Sube la imagen a través del backend (/fhir/Media/upload).
    El backend se encarga de subir a MinIO y encriptar la key,
    garantizando que la presigned URL use el host correcto (MINIO_PUBLIC_ENDPOINT).
    """
    with open(img_path, "rb") as f:
        r = requests.post(
            f"{API_URL}/fhir/Media/upload",
            headers={"Authorization": f"Bearer {token}"},
            data={"patient_id": patient_id, "modality": "FUNDUS"},
            files={"file": (img_path.name, f, "image/png")},
        )
    r.raise_for_status()
    return r.json()


def main():
    if not DIABETES_CSV.exists():
        raise FileNotFoundError(
            f"Missing {DIABETES_CSV}\n"
            "Download: https://www.kaggle.com/datasets/uciml/pima-indians-diabetes-database"
        )

    df = pd.read_csv(DIABETES_CSV)
    for col in ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]:
        df[col] = df[col].replace(0, df[col].median())
    df = df.head(max(MIN_PATIENTS, 50))

    aptos_imgs = []
    if APTOS_DIR.exists():
        aptos_imgs = sorted(APTOS_DIR.glob("*.png"))[:MIN_WITH_IMG + 5]
        print(f"📷 Found {len(aptos_imgs)} APTOS retina images")
    else:
        print(f"⚠️  APTOS images not found at {APTOS_DIR} — patients will have no images")

    print("🔐 Logging in...")
    token = login()
    print("✅ Authenticated")

    created  = 0
    with_img = 0
    errors   = 0

    for i, row in df.iterrows():
        try:
            name       = faker.name()
            birth_date = str(faker.date_of_birth(minimum_age=20, maximum_age=70))
            id_doc     = faker.numerify("##########")
            gt         = int(row["Outcome"])

            # 1. Crear paciente FHIR
            pid = create_patient(token, name, birth_date, id_doc, gt)

            # 2. Crear observaciones LOINC
            for col, loinc_code in LOINC.items():
                if col in row and pd.notna(row[col]):
                    create_observation(token, pid, loinc_code,
                                       float(row[col]), UNIT_MAP[col])

            # 3. ✅ Subir imagen VÍA BACKEND (no directo a MinIO)
            if with_img < len(aptos_imgs):
                img_path = aptos_imgs[with_img]
                upload_image(token, pid, img_path)
                with_img += 1

            created += 1
            print(f"  [{created:3d}] ✅ {name} (GT={gt})"
                  f"{' + retina' if with_img >= created else ''}")

            time.sleep(0.05)

        except Exception as e:
            errors += 1
            print(f"  [{i}] ❌ Error: {e}")

    print(f"\n🎉 Seed complete!")
    print(f"   Patients created : {created}")
    print(f"   With retina image: {with_img}")
    print(f"   Errors           : {errors}")

    if created < MIN_PATIENTS:
        print(f"\n⚠️  Only {created} patients created — need ≥ {MIN_PATIENTS}")
    if with_img < MIN_WITH_IMG:
        print(f"⚠️  Only {with_img} with images — need ≥ {MIN_WITH_IMG}")
        print("   Download APTOS images from Kaggle and re-run")


if __name__ == "__main__":
    main()