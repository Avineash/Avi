"""Shared state between the robot loop and the web page (thread-safe)."""
import threading
import time
from collections import deque


class State:
    def __init__(self, suggestion_ttl: float = 3600):
        self._lock = threading.Lock()
        self._events: deque = deque(maxlen=100)
        self._suggestions: list[dict] = []
        self._seq = 0
        self._ttl = suggestion_ttl
        self.cabin: list[dict] = []
        self.unknown_faces = 0
        self.camera_ok: bool | None = None
        self.prompt: dict | None = None  # {"name":..., "address":...} while waiting for the driver

    def _next(self) -> int:
        self._seq += 1
        return self._seq

    def add_event(self, kind: str, text: str) -> None:
        with self._lock:
            self._events.append({"id": self._next(), "ts": time.time(), "kind": kind, "text": text})

    def set_cabin(self, cabin: list[dict], unknown: int) -> None:
        with self._lock:
            self.cabin, self.unknown_faces = cabin, unknown

    def set_prompt(self, name: str, address: str) -> None:
        with self._lock:
            self.prompt = {"name": name, "address": address, "ts": time.time()}

    def clear_prompt(self) -> None:
        with self._lock:
            self.prompt = None

    def add_suggestion(self, name: str, address: str, url: str) -> int:
        with self._lock:
            sid = self._next()
            self._suggestions.append({"id": sid, "ts": time.time(), "name": name,
                                      "address": address, "url": url, "status": "new"})
            return sid

    def update_suggestion(self, sid: int, status: str) -> bool:
        with self._lock:
            for s in self._suggestions:
                if s["id"] == sid:
                    s["status"] = status
                    return True
            return False

    def snapshot(self) -> dict:
        now = time.time()
        with self._lock:
            live = [dict(s) for s in self._suggestions
                    if s["status"] == "new" and now - s["ts"] <= self._ttl]
            return {
                "now": now,
                "camera_ok": self.camera_ok,
                "cabin": list(self.cabin),
                "unknown_faces": self.unknown_faces,
                "prompt": dict(self.prompt) if self.prompt else None,
                "suggestions": live,
                "events": list(self._events)[-30:][::-1],
            }
