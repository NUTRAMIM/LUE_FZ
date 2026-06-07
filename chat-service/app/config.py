# app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    openai_api_key: str = ""
    webhook_secret: str = ""
    chat_model: str = "gpt-5-mini"
    embed_model: str = "text-embedding-3-small"
    buffer_wait_seconds: float = 7.0
    match_count: int = 6


settings = Settings()
