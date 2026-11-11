"""Trigger the navigation shortcut on the iPhone."""
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
    """Run the iPhone Shortcut via Pushcut, passing the maps URL as its input.

    Needs the Pushcut app with its Automation Server enabled on the phone.
    """
    if not cfg.pushcut_api_key:
        raise RuntimeError("PUSHCUT_API_KEY is not set")
    r = requests.post(
        "https://api.pushcut.io/v1/execute",
        params={"shortcut": cfg.pushcut_shortcut, "input": maps_url(query, cfg.maps_app, mode)},
        headers={"API-Key": cfg.pushcut_api_key},
        timeout=10,
    )
    r.raise_for_status()
