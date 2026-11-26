"""Small helpers that keep the published data safe when a build step goes wrong.

write_text / write_json write to a temporary file first and then swap it in, so a step that is stopped
part way (a time limit, a crash) never leaves a half-written file for the site to choke on.
read_json returns the file's data, or a fallback when it is missing or unreadable.
"""
from __future__ import annotations

import json
import os
from pathlib import Path


def write_text(path: Path, text: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def write_json(path: Path, data, **kw) -> None:
    kw.setdefault("separators", (",", ":"))
    write_text(path, json.dumps(data, **kw))


def read_json(path: Path, fallback=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return fallback
