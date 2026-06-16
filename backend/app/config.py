from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    cors_origin: str = "http://localhost:5173"
    telegram_bot_token: Optional[str] = None

    model_config = {"env_file": ".env"}


settings = Settings()
