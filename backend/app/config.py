from typing import Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    # Comma-separated list in the env var (CORS_ORIGINS), parsed into a
    # list[str] at load time. Supports any number of origins; passing a
    # single origin still works unchanged.
    cors_origins: list[str] = ["http://localhost:5173"]
    telegram_bot_token: Optional[str] = None
    max_api_base_url: str = "https://platform-api.max.ru"
    max_posts_sample: int = 20

    model_config = {"env_file": ".env"}

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v: Union[str, list[str], None]) -> list[str]:
        if v is None or v == "":
            return []
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v


settings = Settings()
