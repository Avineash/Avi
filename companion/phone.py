"""Trigger the navigation shortcut on the iPhone."""
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


def notify_trip(name: str, address: str, cfg: Config) -> None:
    """Push a notification; tapping it opens Google Maps navigation to `address`.

    Ignored notifications just sit there: nothing else happens. The notification
    named PUSHCUT_NOTIFICATION must exist in the Pushcut app.
    """
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
