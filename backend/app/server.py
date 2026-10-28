"""Headless server entrypoint used by Docker and `python -m app.server`."""
from __future__ import annotations

import uvicorn

from .config import settings
from .main import app


def main() -> None:
    uvicorn.run(
        app,
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        log_level="info",
        access_log=True,
        timeout_keep_alive=300,
        timeout_graceful_shutdown=30,
        h11_max_incomplete_event_size=16 * 1024 * 1024,
        limit_max_requests=None,
    )


if __name__ == "__main__":
    main()
