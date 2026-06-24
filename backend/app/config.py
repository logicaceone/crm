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

    # reCAPTCHA Enterprise. Verification runs only when project_id +
    # site_key are set AND GOOGLE_APPLICATION_CREDENTIALS points at a
    # valid service-account JSON (the google-cloud SDK reads ADC from
    # that env var). Otherwise login skips assessment with a warning,
    # so the app stays usable before GCP creds are provisioned.
    recaptcha_project_id: Optional[str] = None
    recaptcha_site_key: Optional[str] = None
    recaptcha_min_score: float = 0.5

    # Daily TG report. The scheduler fires at 23:55 in report_timezone.
    # If report_bot_token is empty we fall back to telegram_bot_token —
    # one bot can do both channel sync and reporting.
    report_bot_token: Optional[str] = None
    report_chat_id: Optional[str] = None
    report_timezone: str = "Europe/Moscow"

    # MaxDash competitors page — defaults for the daily cache refresh.
    # The actual API token is stored in system_settings (root only).
    # Region defaults to substring "Татарстан" — covers all MaxDash
    # variants (Казань, Татарстан, Республика Татарстан, районы…).
    # Filtering happens server-side after fetching the category.
    maxdash_default_region: str = "Татарстан"
    maxdash_default_category: str = "Новости и СМИ"
    # Drop channels under this subscriber count from the default cache
    # refresh — keeps the daily fetch from grabbing thousands of small
    # channels. Users can override via the UI filter.
    maxdash_default_participants_min: int = 500
    maxdash_cache_ttl_hours: int = 24

    # Google Sheets CSV import (СММ ВЫПЛАТЫ ЗА НОВОСТЬ). Per-sheet gid is
    # appended to sheets_base_url to fetch the CSV export. The hourly job
    # is gated on sheets_sync_enabled so we can disable it without code.
    sheets_base_url: Optional[str] = None
    sheets_sync_enabled: bool = True
    sales_sheets_base_url: Optional[str] = None
    sales_sheets_sync_enabled: bool = True

    model_config = {"env_file": ".env"}

    @property
    def cors_origins_list(self) -> list[str]:
        return [s.strip() for s in self.cors_origins.split(",") if s.strip()]


settings = Settings()
