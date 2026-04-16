from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants.enums import UserRole
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.models import User

ADMIN_EMPLOYEE_ID = "1111"
ADMIN_PASSWORD = "admin"
ADMIN_EMAIL = "admin@flowdesk.app"


def ensure_default_admin(db: Session) -> User:
    admin = db.execute(select(User).where(User.employee_id == ADMIN_EMPLOYEE_ID)).scalar_one_or_none()
    if admin:
        # Repair legacy seed values that no longer satisfy EmailStr validation.
        if admin.email.endswith(".local"):
            admin.email = ADMIN_EMAIL
            db.commit()
            db.refresh(admin)
        return admin
    admin = User(
        employee_id=ADMIN_EMPLOYEE_ID,
        name="System Admin",
        email=ADMIN_EMAIL,
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def login(db: Session, employee_id: str, password: str) -> dict:
    user = db.execute(select(User).where(User.employee_id == str(employee_id))).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        return {}
    return {
        "access_token": create_access_token(subject=user.employee_id, role=user.role.value),
        "refresh_token": create_refresh_token(subject=user.employee_id, role=user.role.value),
        "role": user.role,
    }
