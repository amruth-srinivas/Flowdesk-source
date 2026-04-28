import uuid
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.dependencies.auth import get_current_lead_or_member
from app.models import (
    ChatAttachment,
    ChatConversation,
    ChatConversationMemberPreference,
    ChatMessage,
    ChatMessageRead,
    ChatReaction,
    ChatRequest,
    User,
)
from app.schemas.chat import (
    ChatAttachmentResponse,
    ChatConversationPreferencesResponse,
    ChatConversationPreferencesUpdate,
    ChatConversationResponse,
    ChatForwardPayload,
    ChatMessageCreateResponse,
    ChatMessagePreview,
    ChatMessageResponse,
    ChatMessageUpdate,
    ChatReactionResponse,
    ChatReactionToggle,
    ChatRequestAction,
    ChatRequestCreate,
    ChatRequestResponse,
    ChatUserSearchResult,
)

router = APIRouter(prefix="/chat", tags=["chat"])


def _pair_ids(a: UUID, b: UUID) -> tuple[UUID, UUID]:
    return (a, b) if str(a) < str(b) else (b, a)


def _user_name_map(db: Session, user_ids: list[UUID]) -> dict[UUID, str]:
    if not user_ids:
        return {}
    users = db.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all()
    return {uid: name for uid, name in users}


def _conversation_or_404(db: Session, conversation_id: UUID, current_user_id: UUID) -> ChatConversation:
    convo = db.get(ChatConversation, conversation_id)
    if not convo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    if current_user_id not in {convo.participant_low_id, convo.participant_high_id}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this conversation")
    return convo


def _message_preview(db: Session, message: ChatMessage | None, user_map: dict[UUID, str]) -> ChatMessagePreview | None:
    if not message:
        return None
    return ChatMessagePreview(
        id=message.id,
        sender_id=message.sender_id,
        sender_name=user_map.get(message.sender_id, "Unknown"),
        body=None if message.deleted_at else message.body,
        created_at=message.created_at,
        edited_at=message.edited_at,
        deleted_at=message.deleted_at,
    )


def _message_to_response(
    db: Session,
    message: ChatMessage,
    current_user_id: UUID,
    user_map: dict[UUID, str],
    avatar_map: dict[UUID, str | None],
) -> ChatMessageResponse:
    attachments = db.execute(
        select(ChatAttachment).where(ChatAttachment.message_id == message.id).order_by(ChatAttachment.created_at.asc())
    ).scalars().all()

    reactions = db.execute(select(ChatReaction).where(ChatReaction.message_id == message.id)).scalars().all()
    grouped: dict[str, list[ChatReaction]] = {}
    for reaction in reactions:
        grouped.setdefault(reaction.emoji, []).append(reaction)
    reaction_rows: list[ChatReactionResponse] = []
    for emoji, rows in grouped.items():
        reaction_rows.append(
            ChatReactionResponse(
                emoji=emoji,
                count=len(rows),
                reacted_by_me=any(row.user_id == current_user_id for row in rows),
                reacted_by_names=[user_map.get(row.user_id, "Unknown") for row in rows],
            )
        )
    reaction_rows.sort(key=lambda row: row.emoji)

    reply_to = db.get(ChatMessage, message.reply_to_message_id) if message.reply_to_message_id else None
    forwarded_from = db.get(ChatMessage, message.forwarded_from_message_id) if message.forwarded_from_message_id else None

    convo = db.get(ChatConversation, message.conversation_id)
    other_user_id = convo.participant_low_id if convo.participant_high_id == message.sender_id else convo.participant_high_id
    if message.sender_id != current_user_id:
        other_user_id = message.sender_id
    read_by_other = db.execute(
        select(ChatMessageRead).where(
            ChatMessageRead.message_id == message.id,
            ChatMessageRead.user_id == other_user_id,
        )
    ).scalar_one_or_none()

    return ChatMessageResponse(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        sender_name=user_map.get(message.sender_id, "Unknown"),
        sender_avatar_url=avatar_map.get(message.sender_id),
        body=None if message.deleted_at else message.body,
        reply_to=_message_preview(db, reply_to, user_map),
        forwarded_from=_message_preview(db, forwarded_from, user_map),
        attachments=[
            ChatAttachmentResponse(
                id=att.id,
                filename=att.filename,
                file_size_bytes=att.file_size_bytes,
                mime_type=att.mime_type,
                uploaded_by=att.uploaded_by,
                uploaded_by_name=user_map.get(att.uploaded_by, "Unknown"),
                created_at=att.created_at,
            )
            for att in attachments
        ],
        reactions=reaction_rows,
        is_read_by_other=read_by_other is not None,
        created_at=message.created_at,
        updated_at=message.updated_at,
        edited_at=message.edited_at,
        deleted_at=message.deleted_at,
    )


def _remove_attachment_files(attachments: list[ChatAttachment]) -> None:
    base = Path(settings.chat_upload_dir).resolve()
    for att in attachments:
        try:
            full = (base / att.file_path).resolve()
            if str(full).startswith(str(base)) and full.is_file():
                full.unlink(missing_ok=True)
            parent = full.parent
            if parent != base and parent.exists():
                try:
                    parent.rmdir()
                except OSError:
                    pass
        except Exception:
            # keep DB operation resilient if file cleanup fails
            continue


@router.get("/notifications/count")
def get_chat_notification_count(
    since: datetime | None = Query(None),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    conversation_ids = db.execute(
        select(ChatConversation.id).where(
            or_(
                ChatConversation.participant_low_id == current.id,
                ChatConversation.participant_high_id == current.id,
            )
        )
    ).scalars().all()

    if not conversation_ids:
        now = datetime.now(timezone.utc)
        return {
            "unread_messages_count": 0,
            "reaction_updates_count": 0,
            "total_count": 0,
            "server_now": now,
        }

    unread_messages_count = db.execute(
        select(func.count(ChatMessage.id))
        .select_from(ChatMessage)
        .outerjoin(
            ChatMessageRead,
            and_(
                ChatMessageRead.message_id == ChatMessage.id,
                ChatMessageRead.user_id == current.id,
            ),
        )
        .where(
            ChatMessage.conversation_id.in_(conversation_ids),
            ChatMessage.sender_id != current.id,
            ChatMessage.deleted_at.is_(None),
            ChatMessageRead.id.is_(None),
        )
    ).scalar_one()

    reaction_stmt = (
        select(func.count(ChatReaction.id))
        .select_from(ChatReaction)
        .join(ChatMessage, ChatMessage.id == ChatReaction.message_id)
        .where(
            ChatMessage.conversation_id.in_(conversation_ids),
            ChatMessage.sender_id == current.id,
            ChatReaction.user_id != current.id,
        )
    )
    if since is not None:
        reaction_stmt = reaction_stmt.where(ChatReaction.created_at > since)
    reaction_updates_count = db.execute(reaction_stmt).scalar_one()

    now = datetime.now(timezone.utc)
    return {
        "unread_messages_count": int(unread_messages_count or 0),
        "reaction_updates_count": int(reaction_updates_count or 0),
        "total_count": int((unread_messages_count or 0) + (reaction_updates_count or 0)),
        "server_now": now,
    }


@router.get("/users/search", response_model=list[ChatUserSearchResult])
def search_chat_users(
    query: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    q = query.strip()
    rows = (
        db.execute(
            select(User)
            .where(
                User.is_active.is_(True),
                User.id != current.id,
                or_(User.name.ilike(f"%{q}%"), User.employee_id.ilike(f"%{q}%")),
            )
            .order_by(User.name.asc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [ChatUserSearchResult(id=u.id, employee_id=u.employee_id, name=u.name, designation=u.designation, avatar_url=u.avatar_url) for u in rows]


@router.post("/requests", response_model=ChatRequestResponse, status_code=status.HTTP_201_CREATED)
def create_chat_request(
    payload: ChatRequestCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    if payload.recipient_id == current.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot request chat with yourself")
    recipient = db.get(User, payload.recipient_id)
    if not recipient or not recipient.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    low_id, high_id = _pair_ids(current.id, payload.recipient_id)
    existing_conversation = db.execute(
        select(ChatConversation).where(
            ChatConversation.participant_low_id == low_id,
            ChatConversation.participant_high_id == high_id,
        )
    ).scalar_one_or_none()
    if existing_conversation:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Conversation already exists")

    existing_request = db.execute(
        select(ChatRequest).where(
            or_(
                and_(ChatRequest.requester_id == current.id, ChatRequest.recipient_id == payload.recipient_id),
                and_(ChatRequest.requester_id == payload.recipient_id, ChatRequest.recipient_id == current.id),
            ),
        )
        .order_by(ChatRequest.updated_at.desc())
    ).scalar_one_or_none()
    if existing_request:
        if existing_request.status == "pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A pending chat request already exists")
        if existing_request.status == "approved":
            convo = db.execute(
                select(ChatConversation).where(
                    ChatConversation.participant_low_id == low_id,
                    ChatConversation.participant_high_id == high_id,
                )
            ).scalar_one_or_none()
            if not convo:
                approved_by = existing_request.recipient_id if existing_request.recipient_id == current.id else existing_request.requester_id
                db.add(
                    ChatConversation(
                        participant_low_id=low_id,
                        participant_high_id=high_id,
                        approved_by=approved_by,
                        approved_at=existing_request.responded_at or datetime.now(timezone.utc),
                    )
                )
                db.commit()
            requester = db.get(User, existing_request.requester_id)
            existing_recipient = db.get(User, existing_request.recipient_id)
            return ChatRequestResponse(
                id=existing_request.id,
                requester_id=existing_request.requester_id,
                requester_name=requester.name if requester else "Unknown",
                requester_employee_id=requester.employee_id if requester else None,
                requester_avatar_url=requester.avatar_url if requester else None,
                recipient_id=existing_request.recipient_id,
                recipient_name=existing_recipient.name if existing_recipient else "Unknown",
                recipient_employee_id=existing_recipient.employee_id if existing_recipient else None,
                recipient_avatar_url=existing_recipient.avatar_url if existing_recipient else None,
                status=existing_request.status,
                created_at=existing_request.created_at,
                updated_at=existing_request.updated_at,
                responded_at=existing_request.responded_at,
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A previous chat request already exists")

    req = ChatRequest(requester_id=current.id, recipient_id=payload.recipient_id, status="pending")
    db.add(req)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chat request already exists")
    db.refresh(req)
    return ChatRequestResponse(
        id=req.id,
        requester_id=req.requester_id,
        requester_name=current.name,
        requester_employee_id=current.employee_id,
        requester_avatar_url=current.avatar_url,
        recipient_id=req.recipient_id,
        recipient_name=recipient.name,
        recipient_employee_id=recipient.employee_id,
        recipient_avatar_url=recipient.avatar_url,
        status=req.status,
        created_at=req.created_at,
        updated_at=req.updated_at,
        responded_at=req.responded_at,
    )


@router.get("/requests", response_model=list[ChatRequestResponse])
def list_chat_requests(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    rows = (
        db.execute(
            select(ChatRequest)
            .where(or_(ChatRequest.requester_id == current.id, ChatRequest.recipient_id == current.id))
            .order_by(ChatRequest.updated_at.desc())
        )
        .scalars()
        .all()
    )
    user_ids = list({row.requester_id for row in rows} | {row.recipient_id for row in rows})
    users = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
    by_id = {u.id: u for u in users}
    return [
        ChatRequestResponse(
            id=row.id,
            requester_id=row.requester_id,
            requester_name=by_id.get(row.requester_id).name if by_id.get(row.requester_id) else "Unknown",
            requester_employee_id=by_id.get(row.requester_id).employee_id if by_id.get(row.requester_id) else None,
            requester_avatar_url=by_id.get(row.requester_id).avatar_url if by_id.get(row.requester_id) else None,
            recipient_id=row.recipient_id,
            recipient_name=by_id.get(row.recipient_id).name if by_id.get(row.recipient_id) else "Unknown",
            recipient_employee_id=by_id.get(row.recipient_id).employee_id if by_id.get(row.recipient_id) else None,
            recipient_avatar_url=by_id.get(row.recipient_id).avatar_url if by_id.get(row.recipient_id) else None,
            status=row.status,
            created_at=row.created_at,
            updated_at=row.updated_at,
            responded_at=row.responded_at,
        )
        for row in rows
    ]


@router.patch("/requests/{request_id}", response_model=ChatRequestResponse)
def act_on_chat_request(
    request_id: UUID,
    payload: ChatRequestAction,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    req = db.get(ChatRequest, request_id)
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat request not found")
    if req.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is no longer pending")

    if payload.action == "cancel":
        if req.requester_id != current.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only requester can cancel")
        req.status = "cancelled"
        req.responded_at = datetime.now(timezone.utc)
    elif payload.action == "reject":
        if req.recipient_id != current.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only recipient can reject")
        req.status = "rejected"
        req.responded_at = datetime.now(timezone.utc)
    else:
        if req.recipient_id != current.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only recipient can approve")
        req.status = "approved"
        req.responded_at = datetime.now(timezone.utc)
        low_id, high_id = _pair_ids(req.requester_id, req.recipient_id)
        existing = db.execute(
            select(ChatConversation).where(
                ChatConversation.participant_low_id == low_id,
                ChatConversation.participant_high_id == high_id,
            )
        ).scalar_one_or_none()
        if not existing:
            db.add(
                ChatConversation(
                    participant_low_id=low_id,
                    participant_high_id=high_id,
                    approved_by=current.id,
                    approved_at=datetime.now(timezone.utc),
                )
            )
    db.commit()
    requester = db.get(User, req.requester_id)
    recipient = db.get(User, req.recipient_id)
    return ChatRequestResponse(
        id=req.id,
        requester_id=req.requester_id,
        requester_name=requester.name if requester else "Unknown",
        requester_employee_id=requester.employee_id if requester else None,
        requester_avatar_url=requester.avatar_url if requester else None,
        recipient_id=req.recipient_id,
        recipient_name=recipient.name if recipient else "Unknown",
        recipient_employee_id=recipient.employee_id if recipient else None,
        recipient_avatar_url=recipient.avatar_url if recipient else None,
        status=req.status,
        created_at=req.created_at,
        updated_at=req.updated_at,
        responded_at=req.responded_at,
    )


@router.get("/conversations", response_model=list[ChatConversationResponse])
def list_conversations(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    conversations = (
        db.execute(
            select(ChatConversation)
            .where(or_(ChatConversation.participant_low_id == current.id, ChatConversation.participant_high_id == current.id))
            .order_by(ChatConversation.last_message_at.desc().nullslast(), ChatConversation.updated_at.desc())
        )
        .scalars()
        .all()
    )
    other_ids = []
    for c in conversations:
        other_ids.append(c.participant_high_id if c.participant_low_id == current.id else c.participant_low_id)
    others = db.execute(select(User).where(User.id.in_(other_ids))).scalars().all() if other_ids else []
    other_map = {u.id: u for u in others}

    unread_counts = dict(
        db.execute(
            select(ChatMessage.conversation_id, func.count(ChatMessage.id))
            .select_from(ChatMessage)
            .outerjoin(
                ChatMessageRead,
                and_(
                    ChatMessageRead.message_id == ChatMessage.id,
                    ChatMessageRead.user_id == current.id,
                ),
            )
            .where(
                ChatMessage.conversation_id.in_([c.id for c in conversations]) if conversations else False,
                ChatMessage.sender_id != current.id,
                ChatMessage.deleted_at.is_(None),
                ChatMessageRead.id.is_(None),
            )
            .group_by(ChatMessage.conversation_id)
        ).all()
    )

    conv_ids = [c.id for c in conversations]
    prefs_by_convo: dict[UUID, ChatConversationMemberPreference] = {}
    if conv_ids:
        pref_rows = db.execute(
            select(ChatConversationMemberPreference).where(
                ChatConversationMemberPreference.user_id == current.id,
                ChatConversationMemberPreference.conversation_id.in_(conv_ids),
            )
        ).scalars().all()
        prefs_by_convo = {row.conversation_id: row for row in pref_rows}

    user_ids = [current.id] + other_ids
    user_rows = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
    name_map = {u.id: u.name for u in user_rows}
    avatar_map = {u.id: u.avatar_url for u in user_rows}

    out: list[ChatConversationResponse] = []
    for convo in conversations:
        last_msg = db.execute(
            select(ChatMessage).where(ChatMessage.conversation_id == convo.id).order_by(ChatMessage.created_at.desc()).limit(1)
        ).scalar_one_or_none()
        other_id = convo.participant_high_id if convo.participant_low_id == current.id else convo.participant_low_id
        other = other_map.get(other_id)
        pref = prefs_by_convo.get(convo.id)
        is_pinned = pref.is_pinned if pref else False
        is_muted = pref.is_muted if pref else False
        out.append(
            ChatConversationResponse(
                id=convo.id,
                other_user_id=other_id,
                other_user_name=other.name if other else "Unknown",
                other_user_employee_id=other.employee_id if other else "-",
                other_user_avatar_url=other.avatar_url if other else None,
                other_user_designation=other.designation if other else None,
                last_message=_message_to_response(db, last_msg, current.id, name_map, avatar_map) if last_msg else None,
                unread_count=int(unread_counts.get(convo.id, 0)),
                last_message_at=convo.last_message_at,
                approved_at=convo.approved_at,
                is_pinned=is_pinned,
                is_muted=is_muted,
            )
        )

    def _convo_sort_key(row: ChatConversationResponse) -> tuple[bool, float]:
        ts = row.last_message_at.timestamp() if row.last_message_at else 0.0
        return (not row.is_pinned, -ts)

    out.sort(key=_convo_sort_key)
    return out


@router.patch(
    "/conversations/{conversation_id}/preferences",
    response_model=ChatConversationPreferencesResponse,
)
def update_conversation_preferences(
    conversation_id: UUID,
    body: ChatConversationPreferencesUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    convo = _conversation_or_404(db, conversation_id, current.id)
    pref = db.execute(
        select(ChatConversationMemberPreference).where(
            ChatConversationMemberPreference.conversation_id == convo.id,
            ChatConversationMemberPreference.user_id == current.id,
        )
    ).scalar_one_or_none()
    if pref is None:
        pref = ChatConversationMemberPreference(
            conversation_id=convo.id,
            user_id=current.id,
            is_pinned=body.is_pinned if body.is_pinned is not None else False,
            is_muted=body.is_muted if body.is_muted is not None else False,
        )
        db.add(pref)
    else:
        if body.is_pinned is not None:
            pref.is_pinned = body.is_pinned
        if body.is_muted is not None:
            pref.is_muted = body.is_muted
    db.commit()
    db.refresh(pref)
    return ChatConversationPreferencesResponse(id=convo.id, is_pinned=pref.is_pinned, is_muted=pref.is_muted)


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessageResponse])
def get_messages(
    conversation_id: UUID,
    before: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    convo = _conversation_or_404(db, conversation_id, current.id)
    stmt = select(ChatMessage).where(ChatMessage.conversation_id == convo.id)
    if before:
        stmt = stmt.where(ChatMessage.created_at < before)
    rows = db.execute(stmt.order_by(ChatMessage.created_at.desc()).limit(limit)).scalars().all()
    rows.reverse()
    user_ids = list({m.sender_id for m in rows} | {convo.participant_low_id, convo.participant_high_id})
    users = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
    name_map = {u.id: u.name for u in users}
    avatar_map = {u.id: u.avatar_url for u in users}
    return [_message_to_response(db, m, current.id, name_map, avatar_map) for m in rows]


@router.post("/conversations/{conversation_id}/messages", response_model=ChatMessageCreateResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    conversation_id: UUID,
    body: str | None = Form(None),
    reply_to_message_id: UUID | None = Form(None),
    forwarded_from_message_id: UUID | None = Form(None),
    attachments: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    convo = _conversation_or_404(db, conversation_id, current.id)
    trimmed = (body or "").strip()
    if not trimmed and not attachments and not forwarded_from_message_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message body or attachment required")

    if reply_to_message_id:
        parent = db.get(ChatMessage, reply_to_message_id)
        if not parent or parent.conversation_id != convo.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reply target")

    if forwarded_from_message_id:
        fwd = db.get(ChatMessage, forwarded_from_message_id)
        if not fwd:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid forwarded message")

    message = ChatMessage(
        conversation_id=convo.id,
        sender_id=current.id,
        body=trimmed or None,
        reply_to_message_id=reply_to_message_id,
        forwarded_from_message_id=forwarded_from_message_id,
    )
    db.add(message)
    db.flush()

    upload_root = Path(settings.chat_upload_dir)
    for file in attachments:
        if not file.filename:
            continue
        content = await file.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment exceeds 20MB")
        safe_name = Path(file.filename).name
        ext = Path(safe_name).suffix[:20]
        disk_name = f"{uuid.uuid4().hex}{ext}"
        rel_path = f"{message.id}/{disk_name}"
        dest_dir = upload_root / str(message.id)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / disk_name
        dest.write_bytes(content)
        db.add(
            ChatAttachment(
                message_id=message.id,
                uploaded_by=current.id,
                filename=safe_name[:300],
                file_path=rel_path,
                file_size_bytes=len(content),
                mime_type=(file.content_type or "application/octet-stream")[:100],
            )
        )

    convo.last_message_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    users = db.execute(select(User).where(User.id.in_([convo.participant_low_id, convo.participant_high_id]))).scalars().all()
    name_map = {u.id: u.name for u in users}
    avatar_map = {u.id: u.avatar_url for u in users}
    return ChatMessageCreateResponse(message=_message_to_response(db, message, current.id, name_map, avatar_map))


@router.patch("/messages/{message_id}", response_model=ChatMessageResponse)
def edit_message(
    message_id: UUID,
    payload: ChatMessageUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    message = db.get(ChatMessage, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    _conversation_or_404(db, message.conversation_id, current.id)
    if message.sender_id != current.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only sender can edit message")
    if message.deleted_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit deleted message")
    message.body = payload.body.strip()
    message.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    convo = db.get(ChatConversation, message.conversation_id)
    users = db.execute(select(User).where(User.id.in_([convo.participant_low_id, convo.participant_high_id]))).scalars().all()
    name_map = {u.id: u.name for u in users}
    avatar_map = {u.id: u.avatar_url for u in users}
    return _message_to_response(db, message, current.id, name_map, avatar_map)


@router.delete("/messages/{message_id}", response_model=ChatMessageResponse)
def delete_message(
    message_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    message = db.get(ChatMessage, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    _conversation_or_404(db, message.conversation_id, current.id)
    if message.sender_id != current.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only sender can delete message")
    message.body = None
    message.deleted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    convo = db.get(ChatConversation, message.conversation_id)
    users = db.execute(select(User).where(User.id.in_([convo.participant_low_id, convo.participant_high_id]))).scalars().all()
    name_map = {u.id: u.name for u in users}
    avatar_map = {u.id: u.avatar_url for u in users}
    return _message_to_response(db, message, current.id, name_map, avatar_map)


@router.post("/messages/{message_id}/reactions", response_model=list[ChatReactionResponse])
def toggle_reaction(
    message_id: UUID,
    payload: ChatReactionToggle,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    message = db.get(ChatMessage, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    _conversation_or_404(db, message.conversation_id, current.id)
    emoji = payload.emoji.strip()
    existing = db.execute(
        select(ChatReaction).where(
            ChatReaction.message_id == message.id,
            ChatReaction.user_id == current.id,
            ChatReaction.emoji == emoji,
        )
    ).scalar_one_or_none()
    if existing:
        db.delete(existing)
    else:
        db.add(ChatReaction(message_id=message.id, user_id=current.id, emoji=emoji))
    db.commit()
    all_reactions = db.execute(select(ChatReaction).where(ChatReaction.message_id == message.id)).scalars().all()
    user_map = _user_name_map(db, list({r.user_id for r in all_reactions}))
    grouped: dict[str, list[ChatReaction]] = {}
    for row in all_reactions:
        grouped.setdefault(row.emoji, []).append(row)
    out = []
    for row_emoji, rows in grouped.items():
        out.append(
            ChatReactionResponse(
                emoji=row_emoji,
                count=len(rows),
                reacted_by_me=any(r.user_id == current.id for r in rows),
                reacted_by_names=[user_map.get(r.user_id, "Unknown") for r in rows],
            )
        )
    out.sort(key=lambda x: x.emoji)
    return out


@router.post("/messages/{message_id}/forward", response_model=ChatMessageCreateResponse)
def forward_message(
    message_id: UUID,
    payload: ChatForwardPayload,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    source = db.get(ChatMessage, message_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source message not found")
    _conversation_or_404(db, source.conversation_id, current.id)
    target_convo = _conversation_or_404(db, payload.target_conversation_id, current.id)
    cloned = ChatMessage(
        conversation_id=target_convo.id,
        sender_id=current.id,
        body=source.body,
        forwarded_from_message_id=source.id,
    )
    db.add(cloned)
    db.flush()
    source_attachments = db.execute(
        select(ChatAttachment).where(ChatAttachment.message_id == source.id).order_by(ChatAttachment.created_at.asc())
    ).scalars().all()
    for att in source_attachments:
        db.add(
            ChatAttachment(
                message_id=cloned.id,
                uploaded_by=current.id,
                filename=att.filename,
                file_path=att.file_path,
                file_size_bytes=att.file_size_bytes,
                mime_type=att.mime_type,
            )
        )
    target_convo.last_message_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cloned)
    users = db.execute(select(User).where(User.id.in_([target_convo.participant_low_id, target_convo.participant_high_id]))).scalars().all()
    name_map = {u.id: u.name for u in users}
    avatar_map = {u.id: u.avatar_url for u in users}
    return ChatMessageCreateResponse(message=_message_to_response(db, cloned, current.id, name_map, avatar_map))


@router.post("/conversations/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_conversation_read(
    conversation_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    convo = _conversation_or_404(db, conversation_id, current.id)
    message_ids = db.execute(
        select(ChatMessage.id).where(
            ChatMessage.conversation_id == convo.id,
            ChatMessage.sender_id != current.id,
        )
    ).scalars().all()
    if not message_ids:
        return None
    existing_ids = set(
        db.execute(
            select(ChatMessageRead.message_id).where(
                ChatMessageRead.user_id == current.id,
                ChatMessageRead.message_id.in_(message_ids),
            )
        ).scalars().all()
    )
    now = datetime.now(timezone.utc)
    for message_id in message_ids:
        if message_id in existing_ids:
            continue
        db.add(ChatMessageRead(message_id=message_id, user_id=current.id, read_at=now))
    db.commit()
    return None


@router.delete("/conversations/{conversation_id}/messages", status_code=status.HTTP_204_NO_CONTENT)
def clear_conversation_messages(
    conversation_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    convo = _conversation_or_404(db, conversation_id, current.id)
    message_ids = db.execute(select(ChatMessage.id).where(ChatMessage.conversation_id == convo.id)).scalars().all()
    if not message_ids:
        convo.last_message_at = None
        db.commit()
        return None

    attachments = db.execute(select(ChatAttachment).where(ChatAttachment.message_id.in_(message_ids))).scalars().all()
    _remove_attachment_files(attachments)

    db.execute(delete(ChatMessageRead).where(ChatMessageRead.message_id.in_(message_ids)))
    db.execute(delete(ChatReaction).where(ChatReaction.message_id.in_(message_ids)))
    db.execute(delete(ChatAttachment).where(ChatAttachment.message_id.in_(message_ids)))
    db.execute(delete(ChatMessage).where(ChatMessage.id.in_(message_ids)))
    convo.last_message_at = None
    db.commit()
    return None


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    convo = _conversation_or_404(db, conversation_id, current.id)
    message_ids = db.execute(select(ChatMessage.id).where(ChatMessage.conversation_id == convo.id)).scalars().all()
    if message_ids:
        attachments = db.execute(select(ChatAttachment).where(ChatAttachment.message_id.in_(message_ids))).scalars().all()
        _remove_attachment_files(attachments)
        db.execute(delete(ChatMessageRead).where(ChatMessageRead.message_id.in_(message_ids)))
        db.execute(delete(ChatReaction).where(ChatReaction.message_id.in_(message_ids)))
        db.execute(delete(ChatAttachment).where(ChatAttachment.message_id.in_(message_ids)))
        db.execute(delete(ChatMessage).where(ChatMessage.id.in_(message_ids)))

    db.delete(convo)
    db.commit()
    return None


@router.get("/attachments/{attachment_id}/file")
def download_attachment(
    attachment_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    att = db.get(ChatAttachment, attachment_id)
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    message = db.get(ChatMessage, att.message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    _conversation_or_404(db, message.conversation_id, current.id)
    base = Path(settings.chat_upload_dir).resolve()
    full = (base / att.file_path).resolve()
    if not str(full).startswith(str(base)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return FileResponse(str(full), filename=att.filename, media_type=att.mime_type)
