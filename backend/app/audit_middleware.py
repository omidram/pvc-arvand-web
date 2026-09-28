"""HTTP middleware that stamps audit context and logs mutating API calls."""
from __future__ import annotations

import json
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from . import audit
from .auth import decode_access_token
from .database import SessionLocal
from . import models

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
SKIP_PREFIXES = (
    "/docs",
    "/redoc",
    "/openapi.json",
    "/health",
)
SKIP_EXACT = {"/api/logs"}  # avoid noise / recursion on log list polling


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        method = request.method.upper()

        if path.startswith(SKIP_PREFIXES) or method == "OPTIONS":
            return await call_next(request)

        ip = audit.parse_client_ip(request)
        ua = (request.headers.get("user-agent") or "")[:255]
        user_id = None
        username = None
        user_role = None

        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
            try:
                payload = decode_access_token(token)
                user_id = int(payload.get("sub"))
                username = payload.get("username")
                user_role = payload.get("role")
                # Prefer live role/username from DB when possible
                db = SessionLocal()
                try:
                    db.info["skip_audit"] = True
                    user = db.query(models.User).filter(models.User.id == user_id).first()
                    if user:
                        username = user.username
                        user_role = user.role
                finally:
                    db.close()
            except Exception:
                pass

        audit.set_audit_context(
            user_id=user_id,
            username=username,
            user_role=user_role,
            ip_address=ip,
            user_agent=ua,
            method=method,
            path=path,
        )

        body_obj = None
        body_bytes = b""
        if method in MUTATING and path.startswith("/api"):
            body_bytes = await request.body()
            if body_bytes:
                try:
                    body_obj = json.loads(body_bytes.decode("utf-8"))
                except Exception:
                    body_obj = {"_raw": body_bytes[:2000].decode("utf-8", errors="replace")}

            async def receive():
                return {"type": "http.request", "body": body_bytes, "more_body": False}

            request = Request(request.scope, receive)

        try:
            response = await call_next(request)
        except Exception:
            if method in MUTATING and path.startswith("/api") and path not in SKIP_EXACT:
                audit.write_audit(
                    action="api",
                    resource=_resource_from_path(path),
                    summary=f"{method} {path} failed",
                    request_body=body_obj,
                    success=False,
                    status_code=500,
                )
            audit.clear_audit_context()
            raise

        if (
            method in MUTATING
            and path.startswith("/api")
            and not path.startswith("/api/logs")
            and path not in {"/api/auth/login"}  # login logged explicitly with outcome
        ):
            # ORM hooks already store row-level create/update/delete.
            # Still record the HTTP operation for imports, actions, and non-ORM paths.
            audit.write_audit(
                action="api",
                resource=_resource_from_path(path),
                summary=f"{method} {path}",
                request_body=body_obj,
                success=200 <= response.status_code < 400,
                status_code=response.status_code,
            )

        audit.clear_audit_context()
        return response


def _resource_from_path(path: str) -> str:
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2 and parts[0] == "api":
        return parts[1]
    return parts[0] if parts else path
