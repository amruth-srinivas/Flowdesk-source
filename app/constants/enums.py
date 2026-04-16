import enum


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    LEAD = "LEAD"
    MEMBER = "MEMBER"


class ProjectStatus(str, enum.Enum):
    ACTIVE = "active"
    ON_HOLD = "on-hold"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class TicketType(str, enum.Enum):
    BUG_FIX = "bug_fix"
    FEATURE_REQUEST = "feature_request"
    SERVICE_REQUEST = "service_request"
    DESIGN_REWORK = "design_rework"
    PERFORMANCE_ISSUE = "performance_issue"
    SECURITY_VULNERABILITY = "security_vulnerability"
    DOCUMENTATION = "documentation"


class TicketPriority(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TicketStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    IN_REVIEW = "in_review"
    RESOLVED = "resolved"
    CLOSED = "closed"


class ApprovalStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
