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
    ticket_upload_dir: str = "uploads/tickets"
    event_upload_dir: str = "uploads/events"
    project_docs_upload_dir: str = "uploads/project_documents"
    chat_upload_dir: str = "uploads/chat"
    # Comma-separated browser origins for CORS (e.g. IIS frontend on another port).
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3006,http://127.0.0.1:3006,"
        "http://172.18.100.33:8080,http://172.18.100.33:3006"
    )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)


settings = Settings()
