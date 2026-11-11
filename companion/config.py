import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    model: str = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")
    whisper_model: str = os.getenv("WHISPER_MODEL", "base.en")
    pushcut_api_key: str = os.getenv("PUSHCUT_API_KEY", "")
    pushcut_shortcut: str = os.getenv("PUSHCUT_SHORTCUT", "Navigate")
    maps_app: str = os.getenv("MAPS_APP", "apple")  # google | apple | waze
    home_address: str = os.getenv("HOME_ADDRESS", "")
    work_address: str = os.getenv("WORK_ADDRESS", "")
    max_listen_seconds: float = float(os.getenv("MAX_LISTEN_SECONDS", "8"))
    silence_seconds: float = float(os.getenv("SILENCE_SECONDS", "1.2"))
    energy_threshold: float = float(os.getenv("ENERGY_THRESHOLD", "0.01"))
    confirm: bool = os.getenv("CONFIRM_DESTINATION", "1") == "1"
