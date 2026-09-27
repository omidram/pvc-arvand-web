"""Replay transcript edits up to the Access UI rewrite into frontend-modern/."""
from __future__ import annotations

import json
from pathlib import Path

TRANSCRIPT = Path(
    r"C:\Users\Omid\.cursor\projects\c-Users-Omid-Downloads-pvc-arvand-web\agent-transcripts"
    r"\0a8a9147-e712-4e37-aa02-d695d6a98de5\0a8a9147-e712-4e37-aa02-d695d6a98de5.jsonl"
)
ROOT = Path(r"C:\Users\Omid\Downloads\pvc_arvand_web")
DEST = ROOT / "frontend-modern"
CUTOFF = 1340  # last line before Access chrome rewrite


def is_frontend(path: str) -> bool:
    norm = path.replace("\\", "/").lower()
    return "/pvc_arvand_web/frontend/" in norm and "node_modules" not in norm


def rel_from_frontend(path: str) -> Path:
    norm = path.replace("\\", "/")
    marker = "/pvc_arvand_web/frontend/"
    idx = norm.lower().find(marker)
    rel = norm[idx + len(marker) :]
    return Path(rel)


def main() -> None:
    writes = 0
    replaces = 0
    failed = 0
    with TRANSCRIPT.open(encoding="utf-8") as handle:
        for i, line in enumerate(handle, 1):
            if i > CUTOFF:
                break
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            content = event.get("message", {}).get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict) or part.get("type") != "tool_use":
                    continue
                name = part.get("name")
                payload = part.get("input") or {}
                path = payload.get("path") or ""
                if name not in ("Write", "StrReplace") or not is_frontend(path):
                    continue
                target = DEST / rel_from_frontend(path)
                if name == "Write":
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(payload.get("contents") or "", encoding="utf-8")
                    writes += 1
                    continue
                old = payload.get("old_string") or ""
                new = payload.get("new_string") or ""
                if not target.is_file():
                    failed += 1
                    print(f"MISSING {i} {target}")
                    continue
                text = target.read_text(encoding="utf-8")
                count = text.count(old)
                if count == 0:
                    failed += 1
                    print(f"NOMATCH {i} {target.name}")
                    continue
                if payload.get("replace_all"):
                    text = text.replace(old, new)
                else:
                    text = text.replace(old, new, 1)
                target.write_text(text, encoding="utf-8")
                replaces += 1
    print(f"writes={writes} replaces={replaces} failed={failed}")
    print("files", sum(1 for _ in DEST.rglob('*') if _.is_file()))


if __name__ == "__main__":
    main()
