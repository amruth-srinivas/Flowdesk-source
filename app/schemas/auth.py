from pydantic import BaseModel

from app.constants.enums import UserRole


class LoginRequest(BaseModel):
    employee_id: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: UserRole
