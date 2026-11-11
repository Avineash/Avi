"""Map links, plus an optional Pushcut lock-screen notification."""
from urllib.parse import quote, quote_plus

import requests

from .config import Config


def maps_url(query: str, app: str = "google", mode: str = "driving") -> str:
    q = quote_plus(query)
    if app == "apple":
        flag = {"driving": "d", "walking": "w", "transit": "r"}[mode]
        return f"https://maps.apple.com/?daddr={q}&dirflg={flag}"
    if app == "waze":
        return f"https://waze.com/ul?q={q}&navigate=yes"
    return f"https://www.google.com/maps/dir/?api=1&destination={q}&travelmode={mode}&dir_action=navigate"


def notify_trip(name: str, address: str, cfg: Config) -> None:
    """Optional lock-screen push (Pushcut). Tapping it opens Google Maps navigation to `address`."""
    if not cfg.pushcut_api_key:
        raise RuntimeError("PUSHCUT_API_KEY is not set")
    url = maps_url(address, cfg.maps_app)
    r = requests.post(
        f"https://api.pushcut.io/v1/notifications/{quote(cfg.pushcut_notification)}",
        json={
            "title": f"{name} just got in",
            "text": f"Navigate to {address}?",
            "defaultAction": {"url": url},
            "actions": [{"name": "Navigate", "url": url}],
        },
        headers={"API-Key": cfg.pushcut_api_key},
        timeout=10,
    )
    r.raise_for_status()
