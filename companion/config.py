import os
from dataclasses import dataclass


def _f(name: str, default: str) -> str:
    return os.getenv(name, default)


@dataclass(frozen=True)
class Config:
    model: str = _f("CLAUDE_MODEL", "claude-opus-5-5")
    # Multilingual model (no ".en") so Tamil works. "medium" is better for Tamil but slower on a Pi.
    whisper_model: str = _f("WHISPER_MODEL", "small")
    # Pushcut: runs your Shortcut (driver) and sends tap-to-navigate notifications (passengers).
    pushcut_api_key: str = _f("PUSHCUT_API_KEY", "")
    pushcut_shortcut: str = _f("PUSHCUT_SHORTCUT", "Navigate")
    pushcut_notification: str = _f("PUSHCUT_NOTIFICATION", "CarPassenger")
    maps_app: str = _f("MAPS_APP", "google")  # google | apple | waze
    home_address: str = _f("HOME_ADDRESS", "")
    work_address: str = _f("WORK_ADDRESS", "")
    # Voice capture
    max_listen_seconds: float = float(_f("MAX_LISTEN_SECONDS", "8"))
    silence_seconds: float = float(_f("SILENCE_SECONDS", "1.2"))
    energy_threshold: float = float(_f("ENERGY_THRESHOLD", "0.01"))
    confirm: bool = _f("CONFIRM_DESTINATION", "0") == "1"  # needs a spoken "yes"; off by default
    sounds_dir: str = _f("SOUNDS_DIR", "sounds")  # optional WAV overrides
    volume: float = float(_f("VOLUME", "0.8"))
    # Faces
    people_file: str = _f("PEOPLE_FILE", "data/people.json")
    face_threshold: float = float(_f("FACE_THRESHOLD", "0.40"))  # cosine similarity; higher = stricter
    confirm_frames: int = int(_f("CONFIRM_FRAMES", "3"))  # consecutive sightings before acting
    frame_interval: float = float(_f("FRAME_INTERVAL", "1.0"))
    absent_reset: float = float(_f("ABSENT_RESET", "300"))  # seconds away before greeting again
    # Which half of the camera image the driver sits in ("left" or "right")
    driver_side: str = _f("DRIVER_SIDE", "left")
    camera_backend: str = _f("CAMERA_BACKEND", "auto")  # auto | picamera2 | usb
    camera_index: int = int(_f("CAMERA_INDEX", "0"))
