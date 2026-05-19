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
    ChatGroup,
    ChatGroupMember,
    ChatGroupAttachment,
    ChatGroupMessage,
    ChatGroupReaction,
    ChatMessage,
    ChatMessageRead,
    ChatReaction,
    ChatRequest,
    User,
)
from app.schemas.chat import (
    ChatActivityNotificationResponse,
    ChatAttachmentResponse,
    ChatConversationPreferencesResponse,
    ChatConversationPreferencesUpdate,
    ChatConversationResponse,
    ChatForwardPayload,
    ChatGroupCreate,
    ChatGroupForwardPayload,
    ChatGroupMessageCreateResponse,
    ChatGroupMessageCreate,
    ChatGroupMessageResponse,
    ChatGroupResponse,
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

    group_unread_count = 0
    if since is not None:
        group_ids = db.execute(
            select(ChatGroupMember.group_id).where(ChatGroupMember.user_id == current.id)
        ).scalars().all()
        if group_ids:
            group_unread_count = int(
                db.execute(
                    select(func.count(ChatGroupMessage.id)).where(
                        ChatGroupMessage.group_id.in_(group_ids),
                        ChatGroupMessage.sender_id != current.id,
                        ChatGroupMessage.created_at > since,
                    )
                ).scalar_one()
                or 0
            )

    now = datetime.now(timezone.utc)
    return {
        "unread_messages_count": int((unread_messages_count or 0) + group_unread_count),
        "reaction_updates_count": int(reaction_updates_count or 0),
        "total_count": int((unread_messages_count or 0) + group_unread_count + (reaction_updates_count or 0)),
        "server_now": now,
    }


@router.get("/notifications/activity", response_model=list[ChatActivityNotificationResponse])
def get_chat_notification_activity(
    since: datetime | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    conversation_rows = db.execute(
        select(ChatConversation.id, ChatConversation.participant_low_id, ChatConversation.participant_high_id).where(
            or_(
                ChatConversation.participant_low_id == current.id,
                ChatConversation.participant_high_id == current.id,
            )
        )
    ).all()
    if not conversation_rows:
        return []

    conversation_ids = [row.id for row in conversation_rows]
    other_user_ids = [
        row.participant_high_id if row.participant_low_id == current.id else row.participant_low_id for row in conversation_rows
    ]
    user_rows = db.execute(select(User.id, User.name, User.avatar_url).where(User.id.in_(other_user_ids))).all()
    user_map = {row.id: {"name": row.name, "avatar_url": row.avatar_url} for row in user_rows}
    convo_other_map = {
        row.id: row.participant_high_id if row.participant_low_id == current.id else row.participant_low_id for row in conversation_rows
    }

    unread_stmt = (
        select(ChatMessage)
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
    )
    if since is not None:
        unread_stmt = unread_stmt.where(ChatMessage.created_at > since)
    unread_rows = db.execute(unread_stmt.order_by(ChatMessage.created_at.desc()).limit(limit)).scalars().all()

    reaction_stmt = (
        select(ChatReaction, ChatMessage)
        .join(ChatMessage, ChatMessage.id == ChatReaction.message_id)
        .where(
            ChatMessage.conversation_id.in_(conversation_ids),
            ChatMessage.sender_id == current.id,
            ChatReaction.user_id != current.id,
        )
    )
    if since is not None:
        reaction_stmt = reaction_stmt.where(ChatReaction.created_at > since)
    reaction_rows = db.execute(reaction_stmt.order_by(ChatReaction.created_at.desc()).limit(limit)).all()

    mention_stmt = (
        select(ChatMessage)
        .where(
            ChatMessage.conversation_id.in_(conversation_ids),
            ChatMessage.sender_id != current.id,
            ChatMessage.deleted_at.is_(None),
            ChatMessage.body.is_not(None),
            ChatMessage.body.ilike(f"%@{current.name}%"),
        )
    )
    if since is not None:
        mention_stmt = mention_stmt.where(ChatMessage.created_at > since)
    mention_rows = db.execute(mention_stmt.order_by(ChatMessage.created_at.desc()).limit(limit)).scalars().all()

    group_ids = db.execute(
        select(ChatGroupMember.group_id).where(ChatGroupMember.user_id == current.id)
    ).scalars().all()
    group_rows = (
        db.execute(select(ChatGroup.id, ChatGroup.name).where(ChatGroup.id.in_(group_ids))).all()
        if group_ids
        else []
    )
    group_name_map = {row.id: row.name for row in group_rows}
    group_msg_stmt = select(ChatGroupMessage).where(
        ChatGroupMessage.group_id.in_(group_ids) if group_ids else False,
        ChatGroupMessage.sender_id != current.id,
    )
    if since is not None:
        group_msg_stmt = group_msg_stmt.where(ChatGroupMessage.created_at > since)
    group_msg_rows = db.execute(group_msg_stmt.order_by(ChatGroupMessage.created_at.desc()).limit(limit)).scalars().all()

    activity: list[ChatActivityNotificationResponse] = []

    for msg in unread_rows:
        actor = user_map.get(msg.sender_id, {"name": "Unknown", "avatar_url": None})
        other_user_id = convo_other_map.get(msg.conversation_id)
        other_user = user_map.get(other_user_id, {"name": "Unknown"})
        activity.append(
            ChatActivityNotificationResponse(
                id=f"msg-{msg.id}",
                activity_type="new_message",
                conversation_id=msg.conversation_id,
                message_id=msg.id,
                actor_id=msg.sender_id,
                actor_name=actor["name"],
                actor_avatar_url=actor["avatar_url"],
                conversation_user_name=other_user["name"],
                body_preview=(msg.body or "").strip()[:140] or "Sent an attachment",
                created_at=msg.created_at,
            )
        )

    for reaction, msg in reaction_rows:
        actor = user_map.get(reaction.user_id, {"name": "Unknown", "avatar_url": None})
        other_user_id = convo_other_map.get(msg.conversation_id)
        other_user = user_map.get(other_user_id, {"name": "Unknown"})
        activity.append(
            ChatActivityNotificationResponse(
                id=f"react-{reaction.id}",
                activity_type="reaction",
                conversation_id=msg.conversation_id,
                message_id=msg.id,
                actor_id=reaction.user_id,
                actor_name=actor["name"],
                actor_avatar_url=actor["avatar_url"],
                conversation_user_name=other_user["name"],
                body_preview=(msg.body or "").strip()[:140] or "Reacted to your attachment",
                emoji=reaction.emoji,
                created_at=reaction.created_at,
            )
        )

    for msg in mention_rows:
        actor = user_map.get(msg.sender_id, {"name": "Unknown", "avatar_url": None})
        other_user_id = convo_other_map.get(msg.conversation_id)
        other_user = user_map.get(other_user_id, {"name": "Unknown"})
        activity.append(
            ChatActivityNotificationResponse(
                id=f"mention-{msg.id}",
                activity_type="mention",
                conversation_id=msg.conversation_id,
                message_id=msg.id,
                actor_id=msg.sender_id,
                actor_name=actor["name"],
                actor_avatar_url=actor["avatar_url"],
                conversation_user_name=other_user["name"],
                body_preview=(msg.body or "").strip()[:140],
                created_at=msg.created_at,
            )
        )

    for msg in group_msg_rows:
        actor = db.get(User, msg.sender_id)
        activity.append(
            ChatActivityNotificationResponse(
                id=f"group-msg-{msg.id}",
                activity_type="new_message",
                conversation_id=msg.group_id,
                message_id=msg.id,
                actor_id=msg.sender_id,
                actor_name=actor.name if actor else "Unknown",
                actor_avatar_url=actor.avatar_url if actor else None,
                conversation_user_name=group_name_map.get(msg.group_id, "Group chat"),
                body_preview=(msg.body or "").strip()[:140] or "Sent a message in group",
                created_at=msg.created_at,
            )
        )

    activity.sort(key=lambda row: row.created_at, reverse=True)
    dedup: list[ChatActivityNotificationResponse] = []
    seen_ids: set[str] = set()
    for row in activity:
        if row.id in seen_ids:
            continue
        seen_ids.add(row.id)
        dedup.append(row)
        if len(dedup) >= limit:
            break
    return dedup


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


def _group_or_404(db: Session, group_id: UUID, current_user_id: UUID) -> ChatGroup:
    group = db.get(ChatGroup, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    member = db.execute(
        select(ChatGroupMember).where(
            ChatGroupMember.group_id == group.id,
            ChatGroupMember.user_id == current_user_id,
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this group")
    return group


def _group_message_to_response(db: Session, row: ChatGroupMessage, current_user_id: UUID | None = None) -> ChatGroupMessageResponse:
    sender = db.get(User, row.sender_id)
    group_member_ids = db.execute(
        select(ChatGroupMember.user_id).where(ChatGroupMember.group_id == row.group_id)
    ).scalars().all()
    user_map = _user_name_map(db, group_member_ids)
    reply_to = db.get(ChatGroupMessage, row.reply_to_message_id) if row.reply_to_message_id else None
    forwarded_from = db.get(ChatGroupMessage, row.forwarded_from_message_id) if row.forwarded_from_message_id else None
    attachments = db.execute(
        select(ChatGroupAttachment)
        .where(ChatGroupAttachment.group_message_id == row.id)
        .order_by(ChatGroupAttachment.created_at.asc())
    ).scalars().all()
    reactions = db.execute(select(ChatGroupReaction).where(ChatGroupReaction.group_message_id == row.id)).scalars().all()
    grouped: dict[str, list[ChatGroupReaction]] = {}
    for reaction in reactions:
        grouped.setdefault(reaction.emoji, []).append(reaction)
    reaction_out: list[ChatReactionResponse] = []
    for emoji, rows in grouped.items():
        reaction_out.append(
            ChatReactionResponse(
                emoji=emoji,
                count=len(rows),
                reacted_by_me=any(r.user_id == current_user_id for r in rows) if current_user_id else False,
                reacted_by_names=[user_map.get(r.user_id, "Unknown") for r in rows],
            )
        )
    reaction_out.sort(key=lambda x: x.emoji)
    return ChatGroupMessageResponse(
        id=row.id,
        group_id=row.group_id,
        sender_id=row.sender_id,
        sender_name=sender.name if sender else "Unknown",
        sender_avatar_url=sender.avatar_url if sender else None,
        body=row.body,
        reply_to=(
            ChatMessagePreview(
                id=reply_to.id,
                sender_id=reply_to.sender_id,
                sender_name=user_map.get(reply_to.sender_id, "Unknown"),
                body=reply_to.body,
                created_at=reply_to.created_at,
                edited_at=reply_to.edited_at,
                deleted_at=reply_to.deleted_at,
            )
            if reply_to
            else None
        ),
        forwarded_from=(
            ChatMessagePreview(
                id=forwarded_from.id,
                sender_id=forwarded_from.sender_id,
                sender_name=user_map.get(forwarded_from.sender_id, "Unknown"),
                body=forwarded_from.body,
                created_at=forwarded_from.created_at,
                edited_at=forwarded_from.edited_at,
                deleted_at=forwarded_from.deleted_at,
            )
            if forwarded_from
            else None
        ),
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
        reactions=reaction_out,
        is_read_by_other=False,
        created_at=row.created_at,
        updated_at=row.updated_at,
        edited_at=row.edited_at,
        deleted_at=row.deleted_at,
    )


@router.post("/groups", response_model=ChatGroupResponse, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: ChatGroupCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    raw_name = payload.name.strip()
    if len(raw_name) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group name is required")
    member_ids = list({*payload.member_ids, current.id})
    users = db.execute(select(User).where(User.id.in_(member_ids), User.is_active.is_(True))).scalars().all()
    valid_member_ids = [user.id for user in users]
    if len(valid_member_ids) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one member")

    group = ChatGroup(name=raw_name, created_by=current.id)
    db.add(group)
    db.flush()
    db.add_all([ChatGroupMember(group_id=group.id, user_id=user_id) for user_id in valid_member_ids])
    db.commit()
    db.refresh(group)
    member_names = [user.name for user in users]
    member_avatars = [user.avatar_url for user in users]
    return ChatGroupResponse(
        id=group.id,
        name=group.name,
        created_by=group.created_by,
        member_ids=valid_member_ids,
        member_names=member_names,
        member_avatars=member_avatars,
        last_message_at=None,
        unread_count=0,
    )


@router.get("/groups", response_model=list[ChatGroupResponse])
def list_groups(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    group_ids = db.execute(
        select(ChatGroupMember.group_id).where(ChatGroupMember.user_id == current.id)
    ).scalars().all()
    if not group_ids:
        return []
    groups = db.execute(
        select(ChatGroup).where(ChatGroup.id.in_(group_ids)).order_by(ChatGroup.updated_at.desc())
    ).scalars().all()
    out: list[ChatGroupResponse] = []
    for group in groups:
        members = db.execute(
            select(ChatGroupMember.user_id).where(ChatGroupMember.group_id == group.id)
        ).scalars().all()
        users = db.execute(select(User).where(User.id.in_(members))).scalars().all() if members else []
        last_message = db.execute(
            select(ChatGroupMessage).where(ChatGroupMessage.group_id == group.id).order_by(ChatGroupMessage.created_at.desc()).limit(1)
        ).scalar_one_or_none()
        out.append(
            ChatGroupResponse(
                id=group.id,
                name=group.name,
                created_by=group.created_by,
                member_ids=[u.id for u in users],
                member_names=[u.name for u in users],
                member_avatars=[u.avatar_url for u in users],
                last_message_at=last_message.created_at if last_message else None,
                unread_count=0,
            )
        )
    out.sort(key=lambda row: row.last_message_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return out


@router.get("/groups/{group_id}/messages", response_model=list[ChatGroupMessageResponse])
def get_group_messages(
    group_id: UUID,
    before: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    group = _group_or_404(db, group_id, current.id)
    stmt = select(ChatGroupMessage).where(ChatGroupMessage.group_id == group.id)
    if before:
        stmt = stmt.where(ChatGroupMessage.created_at < before)
    rows = db.execute(stmt.order_by(ChatGroupMessage.created_at.desc()).limit(limit)).scalars().all()
    rows.reverse()
    return [_group_message_to_response(db, row, current.id) for row in rows]


@router.post("/groups/{group_id}/messages", response_model=ChatGroupMessageCreateResponse, status_code=status.HTTP_201_CREATED)
async def post_group_message(
    group_id: UUID,
    body: str | None = Form(None),
    reply_to_message_id: UUID | None = Form(None),
    forwarded_from_message_id: UUID | None = Form(None),
    attachments: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    group = _group_or_404(db, group_id, current.id)
    trimmed = (body or "").strip()
    if not trimmed and not attachments and not forwarded_from_message_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message body or attachment required")
    if reply_to_message_id:
        parent = db.get(ChatGroupMessage, reply_to_message_id)
        if not parent or parent.group_id != group.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reply target")
    if forwarded_from_message_id:
        fwd = db.get(ChatGroupMessage, forwarded_from_message_id)
        if not fwd or fwd.group_id != group.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid forwarded message")

    message = ChatGroupMessage(
        group_id=group.id,
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
        rel_path = f"group_{message.id}/{disk_name}"
        dest_dir = upload_root / f"group_{message.id}"
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / disk_name
        dest.write_bytes(content)
        db.add(
            ChatGroupAttachment(
                group_message_id=message.id,
                uploaded_by=current.id,
                filename=safe_name[:300],
                file_path=rel_path,
                file_size_bytes=len(content),
                mime_type=(file.content_type or "application/octet-stream")[:100],
            )
        )
    group.updated_at = datetime.now(timezone.utc)
    db.add(group)
    db.commit()
    db.refresh(message)
    return ChatGroupMessageCreateResponse(message=_group_message_to_response(db, message, current.id))


@router.patch("/groups/messages/{message_id}", response_model=ChatGroupMessageResponse)
def edit_group_message(
    message_id: UUID,
    payload: ChatGroupMessageCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    message = db.get(ChatGroupMessage, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    _group_or_404(db, message.group_id, current.id)
    if message.sender_id != current.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only sender can edit message")
    if message.deleted_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit deleted message")
    message.body = (payload.body or "").strip() or None
    message.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    return _group_message_to_response(db, message, current.id)


@router.delete("/groups/messages/{message_id}", response_model=ChatGroupMessageResponse)
def delete_group_message(
    message_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    message = db.get(ChatGroupMessage, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    _group_or_404(db, message.group_id, current.id)
    if message.sender_id != current.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only sender can delete message")
    message.body = None
    message.deleted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    return _group_message_to_response(db, message, current.id)


@router.post("/groups/messages/{message_id}/reactions", response_model=list[ChatReactionResponse])
def toggle_group_reaction(
    message_id: UUID,
    payload: ChatReactionToggle,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    message = db.get(ChatGroupMessage, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    _group_or_404(db, message.group_id, current.id)
    emoji = payload.emoji.strip()
    existing = db.execute(
        select(ChatGroupReaction).where(
            ChatGroupReaction.group_message_id == message.id,
            ChatGroupReaction.user_id == current.id,
            ChatGroupReaction.emoji == emoji,
        )
    ).scalar_one_or_none()
    if existing:
        db.delete(existing)
    else:
        db.add(ChatGroupReaction(group_message_id=message.id, user_id=current.id, emoji=emoji))
    db.commit()
    all_reactions = db.execute(
        select(ChatGroupReaction).where(ChatGroupReaction.group_message_id == message.id)
    ).scalars().all()
    user_map = _user_name_map(db, list({r.user_id for r in all_reactions}))
    grouped: dict[str, list[ChatGroupReaction]] = {}
    for row in all_reactions:
        grouped.setdefault(row.emoji, []).append(row)
    out: list[ChatReactionResponse] = []
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


@router.post("/groups/messages/{message_id}/forward", response_model=ChatGroupMessageCreateResponse)
def forward_group_message(
    message_id: UUID,
    payload: ChatGroupForwardPayload,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    source = db.get(ChatGroupMessage, message_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source message not found")
    _group_or_404(db, source.group_id, current.id)
    target_group = _group_or_404(db, payload.target_group_id, current.id)
    cloned = ChatGroupMessage(
        group_id=target_group.id,
        sender_id=current.id,
        body=source.body,
        forwarded_from_message_id=source.id,
    )
    db.add(cloned)
    db.flush()
    source_attachments = db.execute(
        select(ChatGroupAttachment)
        .where(ChatGroupAttachment.group_message_id == source.id)
        .order_by(ChatGroupAttachment.created_at.asc())
    ).scalars().all()
    for att in source_attachments:
        db.add(
            ChatGroupAttachment(
                group_message_id=cloned.id,
                uploaded_by=current.id,
                filename=att.filename,
                file_path=att.file_path,
                file_size_bytes=att.file_size_bytes,
                mime_type=att.mime_type,
            )
        )
    target_group.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cloned)
    return ChatGroupMessageCreateResponse(message=_group_message_to_response(db, cloned, current.id))


@router.get("/groups/attachments/{attachment_id}/download")
def download_group_attachment(
    attachment_id: UUID,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_lead_or_member),
):
    att = db.get(ChatGroupAttachment, attachment_id)
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    msg = db.get(ChatGroupMessage, att.group_message_id)
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    _group_or_404(db, msg.group_id, current.id)
    base = Path(settings.chat_upload_dir).resolve()
    file_path = (base / att.file_path).resolve()
    if not str(file_path).startswith(str(base)) or not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing")
    return FileResponse(path=file_path, filename=att.filename, media_type=att.mime_type)


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
