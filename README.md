# FlowDesk Backend

Production-focused FastAPI backend scaffold for FlowDesk with PostgreSQL, SQLAlchemy, Alembic, JWT auth, and role-based access control.

## Run

1. Create and activate a virtual environment
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Copy `.env.example` to `.env` and update values
4. Start server:
   - `uvicorn app.main:app --reload`

On startup, the app:
- creates DB tables (`Base.metadata.create_all`)
- ensures the hardcoded admin account exists:
  - `employee_id: 1111`
  - `password: admin`
  - `role: ADMIN`

## Main API Areas

- Auth: `/auth/login`
- Users: `/users` (admin only creation/list/role assignment)
- Projects: `/projects`
- Tickets: `/tickets` plus assignment/status/resolution/approval
- Customers: `/customers`
- Knowledge Base: `/kb/articles`
- Events/Tasks: `/work/events`, `/work/tasks`
