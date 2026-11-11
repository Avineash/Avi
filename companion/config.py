import os
from dataclasses import dataclass


def _f(name: str, default: str) -> str:
    return os.getenv(name, default)


@dataclass(frozen=True)
class Config:
    model: str = _f("CLAUDE_MODEL", "claude-opus-5-5")
    # Web page served by the Pi. A long random token is required (openssl rand -hex 16).
    page_token: str = _f("PAGE_TOKEN", "")
    host: str = _f("HOST", "0.0.0.0")
    port: int = int(_f("PORT", "8080"))
    maps_app: str = _f("MAPS_APP", "google")  # google | apple | waze
    home_address: str = _f("HOME_ADDRESS", "")
    work_address: str = _f("WORK_ADDRESS", "")
    sounds_dir: str = _f("SOUNDS_DIR", "sounds")  # optional WAV overrides
    volume: float = float(_f("VOLUME", "0.8"))
    suggestion_ttl: float = float(_f("SUGGESTION_TTL", "3600"))  # seconds an unanswered suggestion stays visible
    # Optional extra: lock-screen push for passengers via the Pushcut app (needs a "CarPassenger" notification)
    pushcut_api_key: str = _f("PUSHCUT_API_KEY", "")
    pushcut_notification: str = _f("PUSHCUT_NOTIFICATION", "CarPassenger")
    # Faces
    people_file: str = _f("PEOPLE_FILE", "data/people.json")
    face_threshold: float = float(_f("FACE_THRESHOLD", "0.40"))  # cosine similarity; higher = stricter
    confirm_frames: int = int(_f("CONFIRM_FRAMES", "3"))  # consecutive sightings before acting
    frame_interval: float = float(_f("FRAME_INTERVAL", "1.0"))
    absent_reset: float = float(_f("ABSENT_RESET", "300"))  # seconds away before reacting to them again
    driver_side: str = _f("DRIVER_SIDE", "left")  # which half of the camera image the driver sits in
    camera_backend: str = _f("CAMERA_BACKEND", "auto")  # auto | picamera2 | usb
    camera_index: int = int(_f("CAMERA_INDEX", "0"))
