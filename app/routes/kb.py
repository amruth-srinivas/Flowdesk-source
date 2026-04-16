from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants.enums import UserRole
from app.core.database import get_db
from app.dependencies.auth import get_current_member
from app.models import KbArticle
from app.schemas.kb import KbArticleCreate, KbArticleResponse, KbArticleUpdate

router = APIRouter(prefix="/kb/articles", tags=["knowledge-base"])


@router.post("", response_model=KbArticleResponse, status_code=status.HTTP_201_CREATED)
def create_article(payload: KbArticleCreate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Members have read-only access")
    article = KbArticle(**payload.model_dump(), author_id=user.id, published_at=datetime.utcnow() if payload.is_published else None)
    db.add(article)
    db.commit()
    db.refresh(article)
    return article


@router.get("", response_model=list[KbArticleResponse])
def list_articles(db: Session = Depends(get_db), _=Depends(get_current_member)):
    return db.execute(select(KbArticle)).scalars().all()


@router.patch("/{article_id}", response_model=KbArticleResponse)
def update_article(article_id: str, payload: KbArticleUpdate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    article = db.get(KbArticle, article_id)
    if not article:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    if user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Members have read-only access")
    if user.role == UserRole.LEAD and article.author_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lead can edit only own articles")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(article, k, v)
    if payload.is_published is True:
        article.published_at = datetime.utcnow()
    db.commit()
    db.refresh(article)
    return article


@router.delete("/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_article(article_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admin can delete articles")
    article = db.get(KbArticle, article_id)
    if not article:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    db.delete(article)
    db.commit()
