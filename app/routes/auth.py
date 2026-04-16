from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.auth import LoginRequest, TokenResponse
from app.services.auth_service import login

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse, status_code=status.HTTP_200_OK)
def login_user(payload: LoginRequest, db: Session = Depends(get_db)):
    tokens = login(db, employee_id=payload.employee_id, password=payload.password)
    if not tokens:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return tokens
