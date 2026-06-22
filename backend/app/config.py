from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    # CORS_ORIGINS env var is a comma-separated string. We keep the raw
    # field as str so pydantic-settings doesn't try to JSON-parse it as
    # a list; the .cors_origins_list property does the split on demand.
    # A single origin (no comma) still works unchanged.
    cors_origins: str = "http://localhost:5173"
    telegram_bot_token: Optional[str] = None
    max_api_base_url: str = "https://platform-api.max.ru"
    max_posts_sample: int = 20

    # reCAPTCHA Enterprise. Server-side assessment is enabled only when
    # all three are set; otherwise login skips verification with a
    # warning, so the app stays usable before GCP creds are provisioned.
    recaptcha_project_id: Optional[str] = None
    recaptcha_api_key: Optional[str] = None
    recaptcha_site_key: Optional[str] = None
    recaptcha_min_score: float = 0.5

    model_config = {"env_file": ".env"}

    @property
    def cors_origins_list(self) -> list[str]:
        return [s.strip() for s in self.cors_origins.split(",") if s.strip()]


settings = Settings()
