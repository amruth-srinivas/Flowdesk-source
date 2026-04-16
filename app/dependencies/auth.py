from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants.enums import UserRole
from app.core.database import get_db
from app.core.security import decode_token
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token")
    employee_id = payload.get("sub")
    if not employee_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    user = db.execute(select(User).where(User.employee_id == str(employee_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive or missing")
    return user


def _require_role(user: User, roles: set[UserRole]) -> User:
    if user.role not in roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    return _require_role(user, {UserRole.ADMIN})


def get_current_lead(user: User = Depends(get_current_user)) -> User:
    return _require_role(user, {UserRole.ADMIN, UserRole.LEAD})


def get_current_member(user: User = Depends(get_current_user)) -> User:
    return _require_role(user, {UserRole.ADMIN, UserRole.LEAD, UserRole.MEMBER})
