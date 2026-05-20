from pydantic_settings import BaseSettings
import asyncpg


class Settings(BaseSettings):
    DATABASE_URL: str
    AES_KEY: str
    FERNET_KEY: str = ""
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 8

    SUPERUSER_JWT_SECRET: str = ""

    ALLOWED_ORIGINS: str

    MINIO_ENDPOINT: str = "minio:9000"
    MINIO_PUBLIC_ENDPOINT: str = "http://localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "clinical-images"

    ML_SERVICE_URL: str = "http://ml-service:8001"
    DL_SERVICE_URL: str = "http://dl-service:8002"
    ORCHESTRATOR_URL: str = "http://orchestrator:8003"
    RAG_AGENT_URL: str = "http://rag-agent:8004"
    FHIR_SERVER_URL: str = "http://fhir-server:8080/fhir"

    REDIS_URL: str = "redis://redis:6379/0"

    class Config:
        env_file = ".env"

    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]


settings = Settings()

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings.DATABASE_URL,
            min_size=2,
            max_size=10,
        )
    return _pool


async def get_db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
