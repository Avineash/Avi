from companion.phone import maps_url


def test_google_url():
    assert maps_url("Bunnings Marrickville") == (
        "https://www.google.com/maps/dir/?api=1&destination=Bunnings+Marrickville&travelmode=driving"
    )


def test_apple_walking():
    assert maps_url("Central Station", "apple", "walking") == (
        "https://maps.apple.com/?daddr=Central+Station&dirflg=w"
    )


def test_waze():
    assert maps_url("Home St", "waze").startswith("https://waze.com/ul?q=Home+St")
