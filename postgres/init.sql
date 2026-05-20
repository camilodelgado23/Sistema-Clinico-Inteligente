-- Crear bases de datos adicionales para HAPI FHIR y MLflow
CREATE DATABASE hapi_fhir;
CREATE DATABASE mlflow_db;
GRANT ALL PRIVILEGES ON DATABASE hapi_fhir TO clinai;
GRANT ALL PRIVILEGES ON DATABASE mlflow_db TO clinai;
