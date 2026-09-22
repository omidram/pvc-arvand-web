"""Windows desktop launcher: starts the local server and a small control window."""
from __future__ import annotations

import socket
import threading
import time
import tkinter as tk
import webbrowser
from tkinter import ttk
import uvicorn

from .config import settings
from .main import app


def _port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((host, port)) != 0


def _pick_port(host: str, preferred: int) -> int:
    if _port_free(host, preferred):
        return preferred
    for port in range(preferred + 1, preferred + 20):
        if _port_free(host, port):
            return port
    return preferred


SIMPLE_LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "default": {
            "class": "logging.StreamHandler",
            "formatter": "default",
            "stream": "ext://sys.stderr",
        }
    },
    "root": {"handlers": ["default"], "level": "WARNING"},
}


class DesktopApp:
    def __init__(self) -> None:
        self.host = settings.APP_HOST if settings.APP_HOST != "0.0.0.0" else "127.0.0.1"
        bind_host = settings.APP_HOST
        self.port = _pick_port("127.0.0.1", settings.APP_PORT)
        self.url = f"http://127.0.0.1:{self.port}/"
        self._server = uvicorn.Server(
            uvicorn.Config(
                app,
                host=bind_host,
                port=self.port,
                log_level="warning",
                access_log=False,
                log_config=SIMPLE_LOG_CONFIG,
            )
        )
        self._thread = threading.Thread(target=self._server.run, daemon=True)
        self._thread.start()
        self._wait_until_up()

        self.root = tk.Tk()
        self.root.title("PVC Arvand")
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        try:
            self.root.iconbitmap(default="")
        except tk.TclError:
            pass

        frame = ttk.Frame(self.root, padding=16)
        frame.grid(sticky="nsew")

        ttk.Label(frame, text="PVC Arvand", font=("Segoe UI", 14, "bold")).grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(frame, text="Electrolyzer Management Program").grid(row=1, column=0, columnspan=2, sticky="w", pady=(0, 10))
        ttk.Label(frame, text="The application is running at:").grid(row=2, column=0, columnspan=2, sticky="w")
        ttk.Label(frame, text=self.url, font=("Consolas", 10)).grid(row=3, column=0, columnspan=2, sticky="w", pady=(0, 12))
        ttk.Label(
            frame,
            text="Keep this window open while you use the program.\nClose it to stop the server.",
        ).grid(row=4, column=0, columnspan=2, sticky="w", pady=(0, 12))

        ttk.Button(frame, text="Open in browser", command=self._open).grid(row=5, column=0, sticky="w", padx=(0, 8))
        ttk.Button(frame, text="Exit", command=self._on_close).grid(row=5, column=1, sticky="w")

        self.root.after(400, self._open)

    def _wait_until_up(self, timeout: float = 20.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not _port_free("127.0.0.1", self.port):
                return
            time.sleep(0.15)

    def _open(self) -> None:
        webbrowser.open(self.url)

    def _on_close(self) -> None:
        self._server.should_exit = True
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    from tkinter import messagebox

    from .ad_directory import enforce_startup_access

    denied = enforce_startup_access()
    if denied:
        root = tk.Tk()
        root.withdraw()
        try:
            root.iconbitmap(default="")
        except tk.TclError:
            pass
        messagebox.showerror("PVC Arvand", denied)
        root.destroy()
        return
    DesktopApp().run()


if __name__ == "__main__":
    main()
