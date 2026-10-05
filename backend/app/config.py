import os
import secrets
import shutil
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from .db_connection import default_local_url, resolve_database_url
from .paths import backend_dir, data_root, is_production, seed_db_path

BASE_DIR = backend_dir()
DATA_DIR = data_root()


def _ensure_seed_database() -> None:
    """Copy the bundled seed DB only on first launch.

    Never overwrite an existing plant database — upgrades must keep live data
    under PVC_DATA_DIR / %LOCALAPPDATA%\\PVCArvand / Docker volume.
    """
    dest = DATA_DIR / "pvc_arvand.db"
    if dest.exists() and dest.stat().st_size > 0:
        return
    seed = seed_db_path()
    if not seed or not seed.is_file():
        return
    if seed.resolve() == dest.resolve():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    # If a zero-byte placeholder exists, replace it once from seed.
    shutil.copy2(seed, dest)


def _persist_jwt_secret(current: str) -> str:
    placeholder = "pvc-arvand-dev-secret-change-me-in-production"
    secret_file = DATA_DIR / "jwt_secret.txt"
    env_secret = os.environ.get("JWT_SECRET_KEY")
    if env_secret:
        return env_secret
    if secret_file.is_file():
        stored = secret_file.read_text(encoding="utf-8").strip()
        if stored:
            return stored
    if is_production() or current == placeholder:
        if is_production():
            generated = secrets.token_urlsafe(48)
            secret_file.write_text(generated, encoding="utf-8")
            return generated
    return current


_ensure_seed_database()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BASE_DIR / ".env"), extra="ignore")

    DATABASE_URL: str = default_local_url()
    ACCESS_DB_PATH: str = r"C:\Users\Omid\Downloads\New folder (4)\PVC_Arvand_kofigurierte Datenbank.mdb"
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    JWT_SECRET_KEY: str = "pvc-arvand-dev-secret-change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 12  # 12 hours

    DEFAULT_ADMIN_USERNAME: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str = "admin123"

    APP_HOST: str = "127.0.0.1"
    APP_PORT: int = 8080


settings = Settings()
if not os.environ.get("DATABASE_URL"):
    resolved = resolve_database_url(fallback=settings.DATABASE_URL)
    if resolved != settings.DATABASE_URL:
        settings = settings.model_copy(update={"DATABASE_URL": resolved})
if is_production():
    settings = settings.model_copy(update={"JWT_SECRET_KEY": _persist_jwt_secret(settings.JWT_SECRET_KEY)})

DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "backups").mkdir(parents=True, exist_ok=True)
(DATA_DIR / "ariaorms_exports").mkdir(parents=True, exist_ok=True)
