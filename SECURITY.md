# Security Overview

**PVC Arvand — Electrolyzer Management System**

This document summarizes the security controls built into the Software, to
help plant IT staff and management evaluate and trust the system.

## 1. Authentication

- Every user must sign in with a **username + password**; there is no
  anonymous access to any form or API endpoint (aside from the login
  endpoint itself and static health checks).
- Passwords are **never stored in plain text**. They are hashed with
  **bcrypt** (via the `bcrypt` Python package), a purpose-built, salted,
  slow hashing algorithm designed to resist brute-force and rainbow-table
  attacks.
- On successful login, the server issues a signed **JSON Web Token (JWT)**
  (HS256, via `PyJWT`) with a limited expiry (`JWT_EXPIRE_MINUTES`,
  configurable in `backend/app/config.py`). The frontend stores this token
  and attaches it as a `Bearer` token on every API request.
- Expired or invalid tokens are rejected by the backend, and the frontend
  automatically redirects to the login screen when a `401 Unauthorized`
  response is received.

## 2. Authorization (Role-Based Access Control)

- Every user has a **role**: `admin`, `user`, or `visitor`.
- In addition to role, each user can be granted a **per-form permission
  level**: `none` (hidden), `view` (read-only), or `edit` (full CRUD).
- Permission checks are enforced **server-side**, as a FastAPI dependency
  applied to every router (see `backend/app/main.py` and
  `backend/app/auth.py`). The frontend also hides/disables UI elements the
  user cannot use, but the authoritative check always happens on the
  server — a user cannot gain access merely by manipulating the browser.
- Only `admin` users can create/edit/delete user accounts or change
  permissions (`backend/app/routers/users.py`).

## 3. Data Integrity

- All database writes go through typed Pydantic schemas
  (`backend/app/schemas.py`), which validate field types, required fields,
  and value ranges before anything is persisted.
- The relational schema (`backend/app/models.py`) uses foreign keys and
  unique constraints (e.g., one permission row per user/form pair) to
  prevent inconsistent state.
- Import operations (Access/Excel) run inside the FastAPI request/response
  cycle and report exactly how many rows were imported vs. skipped, so
  operators can verify the outcome of every import.

## 4. Transport & Deployment

- The system is designed to run on the plant's internal network. If exposed
  beyond a trusted LAN, it should be placed behind HTTPS (TLS) via a
  reverse proxy (e.g., nginx/IIS) — the application itself is
  protocol-agnostic and works correctly behind such a proxy.
- CORS is explicitly restricted to the configured frontend origin
  (`FRONTEND_ORIGIN` in `backend/app/config.py`), preventing arbitrary
  external websites from calling the API using a logged-in user's browser
  session.

## 5. No External Data Egress

- The Reports & Data Analysis module performs all statistics and outlier
  detection **locally, in-process** — it does not call any external AI
  service or transmit plant data off-premises.
- There is no third-party telemetry, analytics, or crash-reporting SDK
  embedded in the frontend or backend.

## 6. Secrets Management

- The JWT signing secret (`JWT_SECRET_KEY`) and default admin credentials
  are read from environment variables / `backend/.env` and **must** be
  changed from their placeholder defaults before production use. Do not
  commit real secrets to version control — `backend/.env` should be listed
  in `.gitignore` and excluded from any repository or backup shared outside
  the Company.
- The default administrator account's password should be changed
  immediately after first login (via the in-app "Change Password" flow).

## 7. Recommended Operational Practices

1. Change the default admin username/password immediately after
   deployment.
2. Rotate `JWT_SECRET_KEY` if it is ever suspected to have leaked (this
   invalidates all existing sessions).
3. Grant the minimum necessary role/permission level to each user
   (principle of least privilege).
4. Take regular backups of `backend/instance/pvc_arvand.db`, especially
   before running a "replace" mode data import.
5. Review the Users & Permissions page periodically and deactivate accounts
   that are no longer needed.

## 8. Reporting a Security Concern

If you discover a security issue in this Software, report it directly to
your plant's IT / systems administrator rather than discussing it in public
channels.
