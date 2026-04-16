from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "FlowDesk API"
    environment: str = "development"
    debug: bool = True
    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/flowdesk"
    jwt_secret_key: str = "change_me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)


settings = Settings()
