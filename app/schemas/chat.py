from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class ChatUserSearchResult(BaseModel):
    id: UUID
    employee_id: str
    name: str
    designation: str | None = None
    avatar_url: str | None = None


class ChatRequestCreate(BaseModel):
    recipient_id: UUID


class ChatRequestAction(BaseModel):
    action: str = Field(pattern="^(approve|reject|cancel)$")


class ChatRequestResponse(BaseModel):
    id: UUID
    requester_id: UUID
    requester_name: str
    requester_employee_id: str | None = None
    requester_avatar_url: str | None = None
    recipient_id: UUID
    recipient_name: str
    recipient_employee_id: str | None = None
    recipient_avatar_url: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    responded_at: datetime | None = None


class ChatAttachmentResponse(BaseModel):
    id: UUID
    filename: str
    file_size_bytes: int
    mime_type: str
    uploaded_by: UUID
    uploaded_by_name: str
    created_at: datetime


class ChatMessagePreview(BaseModel):
    id: UUID
    sender_id: UUID
    sender_name: str
    body: str | None = None
    created_at: datetime
    edited_at: datetime | None = None
    deleted_at: datetime | None = None


class ChatReactionResponse(BaseModel):
    emoji: str
    count: int
    reacted_by_me: bool
    reacted_by_names: list[str]


class ChatMessageResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    sender_id: UUID
    sender_name: str
    sender_avatar_url: str | None = None
    body: str | None = None
    reply_to: ChatMessagePreview | None = None
    forwarded_from: ChatMessagePreview | None = None
    attachments: list[ChatAttachmentResponse]
    reactions: list[ChatReactionResponse]
    is_read_by_other: bool
    created_at: datetime
    updated_at: datetime
    edited_at: datetime | None = None
    deleted_at: datetime | None = None


class ChatConversationResponse(BaseModel):
    id: UUID
    other_user_id: UUID
    other_user_name: str
    other_user_employee_id: str
    other_user_avatar_url: str | None = None
    other_user_designation: str | None = None
    last_message: ChatMessageResponse | None = None
    unread_count: int
    last_message_at: datetime | None = None
    approved_at: datetime
    is_pinned: bool = False
    is_muted: bool = False


class ChatConversationPreferencesUpdate(BaseModel):
    is_pinned: bool | None = None
    is_muted: bool | None = None

    @model_validator(mode="after")
    def at_least_one_field(self) -> "ChatConversationPreferencesUpdate":
        if self.is_pinned is None and self.is_muted is None:
            raise ValueError("At least one of is_pinned or is_muted must be provided")
        return self


class ChatConversationPreferencesResponse(BaseModel):
    id: UUID
    is_pinned: bool
    is_muted: bool


class ChatMessageCreateResponse(BaseModel):
    message: ChatMessageResponse


class ChatMessageUpdate(BaseModel):
    body: str


class ChatReactionToggle(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


class ChatForwardPayload(BaseModel):
    target_conversation_id: UUID
