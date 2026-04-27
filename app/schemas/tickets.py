from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.constants.enums import ApprovalStatus, TicketPriority, TicketStatus, TicketType


class TicketCreate(BaseModel):
    title: str
    description: str | None = None
    type: TicketType
    priority: TicketPriority = TicketPriority.MEDIUM
    project_id: UUID
    assigned_to: list[UUID] = Field(default_factory=list)
    customer_id: UUID | None = None
    due_date: date | None = None
    sprint_id: UUID | None = None


class TicketUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = None
    type: TicketType | None = None
    priority: TicketPriority | None = None
    project_id: UUID | None = None
    assigned_to: list[UUID] | None = None
    customer_id: UUID | None = None
    due_date: date | None = None
    sprint_id: UUID | None = None


class TicketAssign(BaseModel):
    assignee_ids: list[UUID] = Field(default_factory=list)


class TicketStatusUpdate(BaseModel):
    status: TicketStatus
    comment: str | None = Field(None, max_length=2000)


class TicketReopenRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=4000)
    sprint_id: UUID | None = None

    @field_validator("sprint_id", mode="before")
    @classmethod
    def normalize_empty_sprint_id(cls, value):
        if value in ("", "null", "None"):
            return None
        return value


class TicketDeleteConfirm(BaseModel):
    password: str = Field(..., min_length=1, max_length=500)


class TicketResponse(BaseModel):
    id: UUID
    ticket_number: int
    public_reference: str | None = None
    title: str
    description: str | None
    type: TicketType
    priority: TicketPriority
    status: TicketStatus
    project_id: UUID
    created_by: UUID
    created_by_name: str | None = None
    created_by_avatar_url: str | None = None
    assignee_ids: list[UUID] = Field(default_factory=list)
    assignee_names: list[str] = Field(default_factory=list)
    customer_id: UUID | None
    due_date: date | None = None
    is_overdue: bool = False
    closed_at: datetime | None = None
    resolved_by: UUID | None = None
    resolved_by_name: str | None = None
    closed_by: UUID | None = None
    closed_by_name: str | None = None
    close_approval_requested_by: UUID | None = None
    close_approval_requested_by_name: str | None = None
    sprint_id: UUID | None = None
    sprint_title: str | None = None
    carried_from_sprint_id: UUID | None = None
    carried_over_at: datetime | None = None
    carryover_count: int = 0
    current_cycle_id: UUID | None = None
    current_cycle_version: int | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ResolutionCreate(BaseModel):
    summary: str
    root_cause: str | None = None
    steps_taken: str | None = None
    kb_article_id: UUID | None = None


class ApprovalDecision(BaseModel):
    status: ApprovalStatus
    notes: str | None = None


class TicketCommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=8000)
    is_internal: bool = False


class TicketCommentUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=8000)


class TicketCommentReactionToggle(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=16)


class TicketCommentReactionSummary(BaseModel):
    emoji: str
    count: int
    reacted_by_me: bool = False
    reacted_by_names: list[str] = Field(default_factory=list)


class TicketCommentResponse(BaseModel):
    id: UUID
    ticket_id: UUID
    author_id: UUID
    author_name: str
    author_avatar_url: str | None = None
    body: str
    is_internal: bool
    reactions: list[TicketCommentReactionSummary] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TicketHistoryResponse(BaseModel):
    id: UUID
    changed_by: UUID
    changer_name: str
    changer_avatar_url: str | None = None
    field_name: str
    old_value: str | None
    new_value: str | None
    change_note: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ResolutionResponse(BaseModel):
    id: UUID
    ticket_id: UUID
    ticket_cycle_id: UUID | None = None
    resolved_by: UUID
    resolver_name: str
    resolver_avatar_url: str | None = None
    summary: str
    root_cause: str | None
    steps_taken: str | None
    kb_article_id: UUID | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TicketAttachmentResponse(BaseModel):
    id: UUID
    comment_id: UUID | None = None
    ticket_cycle_id: UUID | None = None
    filename: str
    file_size_bytes: int
    mime_type: str
    uploaded_by: UUID
    uploader_name: str
    uploader_avatar_url: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class TicketApprovalRequestResponse(BaseModel):
    id: UUID
    ticket_id: UUID
    ticket_reference: str | None = None
    ticket_title: str
    ticket_status: TicketStatus
    requested_by: UUID
    requested_by_name: str
    requested_at: datetime
    status: str

    class Config:
        from_attributes = True


class TicketApprovalNotificationResponse(BaseModel):
    notification_id: UUID
    notification_type: str | None = None
    title: str | None = None
    request_id: UUID | None = None
    ticket_id: UUID
    ticket_reference: str | None = None
    ticket_title: str
    ticket_status: str
    approval_request_status: str | None = None
    requested_by_name: str | None = None
    requested_at: datetime
    is_read: bool


class TicketCycleResponse(BaseModel):
    id: UUID
    ticket_id: UUID
    version_no: int
    sprint_id: UUID | None = None
    status: TicketStatus
    reopen_reason: str | None = None
    reopened_by: UUID | None = None
    reopened_by_name: str | None = None
    reopened_at: datetime | None = None
    previous_cycle_id: UUID | None = None
    closed_at: datetime | None = None
    closed_by: UUID | None = None
    closed_by_name: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
