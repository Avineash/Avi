"""Trigger the navigation shortcut on the phone."""
from urllib.parse import quote_plus

import requests

from .config import Config


def maps_url(query: str, app: str = "google", mode: str = "driving") -> str:
    q = quote_plus(query)
    if app == "apple":
        flag = {"driving": "d", "walking": "w", "transit": "r"}[mode]
        return f"https://maps.apple.com/?daddr={q}&dirflg={flag}"
    if app == "waze":
        return f"https://waze.com/ul?q={q}&navigate=yes"
    return f"https://www.google.com/maps/dir/?api=1&destination={q}&travelmode={mode}"


def send_to_phone(query: str, mode: str, cfg: Config) -> None:
    url = maps_url(query, cfg.maps_app, mode)
    if cfg.phone_backend == "pushcut":
        # iPhone: Pushcut runs your Shortcut, passing the maps URL as its input.
        # Needs Pushcut's Automation Server enabled on the phone.
        r = requests.post(
            "https://api.pushcut.io/v1/execute",
            params={"shortcut": cfg.pushcut_shortcut, "input": url},
            headers={"API-Key": cfg.pushcut_api_key},
            timeout=10,
        )
    elif cfg.phone_backend == "ntfy":
        # Android: Tasker/MacroDroid reacts to the ntfy message and opens the URL.
        r = requests.post(
            f"{cfg.ntfy_server}/{cfg.ntfy_topic}",
            data=url.encode(),
            headers={"Title": "navigate"},
            timeout=10,
        )
    else:
        raise ValueError(f"unknown PHONE_BACKEND {cfg.phone_backend!r}")
    r.raise_for_status()
