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
    )


if __name__ == "__main__":
    main()
