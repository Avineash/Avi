from companion.phone import maps_url


def test_google_url():
    assert maps_url("Bunnings Marrickville") == (
        "https://www.google.com/maps/dir/?api=1&destination=Bunnings+Marrickville&travelmode=driving&dir_action=navigate"
    )


def test_apple_walking():
    assert maps_url("Central Station", "apple", "walking") == (
        "https://maps.apple.com/?daddr=Central+Station&dirflg=w"
    )


def test_waze():
    assert maps_url("Home St", "waze").startswith("https://waze.com/ul?q=Home+St")


def test_notify_trip_payload(monkeypatch):
    from companion import phone
    from companion.config import Config

    sent = {}

    class R:
        def raise_for_status(self):
            pass

    def fake_post(url, json=None, headers=None, timeout=None):
        sent.update(url=url, json=json, headers=headers)
        return R()

    monkeypatch.setattr(phone.requests, "post", fake_post)
    cfg = Config(pushcut_api_key="k", pushcut_notification="CarPassenger", maps_app="google")
    phone.notify_trip("Sam", "12 Smith St", cfg)
    assert sent["url"].endswith("/notifications/CarPassenger")
    assert sent["headers"]["API-Key"] == "k"
    assert "destination=12+Smith+St" in sent["json"]["defaultAction"]["url"]
