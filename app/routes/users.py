from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants.enums import UserRole
from app.core.database import get_db
from app.core.security import hash_password
from app.dependencies.auth import get_current_admin
from app.models import User
from app.schemas.users import UserCreate, UserPasswordUpdate, UserResponse, UserUpdate, UserUpdateRole

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    existing = db.execute(select(User).where(User.employee_id == payload.employee_id)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Employee ID already exists")
    existing_email = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if existing_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
    user = User(
        employee_id=payload.employee_id,
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role or UserRole.MEMBER,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("", response_model=list[UserResponse])
def get_users(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    return db.execute(select(User)).scalars().all()


@router.put("/{user_id}", response_model=UserResponse)
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    employee_owner = db.execute(select(User).where(User.employee_id == payload.employee_id)).scalar_one_or_none()
    if employee_owner and employee_owner.id != user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Employee ID already exists")

    email_owner = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if email_owner and email_owner.id != user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")

    user.employee_id = payload.employee_id
    user.name = payload.name
    user.email = payload.email
    user.role = payload.role or UserRole.MEMBER
    user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/role", response_model=UserResponse)
def assign_role(user_id: str, payload: UserUpdateRole, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.role = payload.role
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(user_id: str, payload: UserPasswordUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.password_hash = hash_password(payload.password)
    db.commit()
