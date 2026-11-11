# Avi: car companion robot

A Raspberry Pi 5 robot that watches who gets into the car. **Everything you say or tap happens on a web page on your iPhone.** The robot itself only makes sounds.

- **You get in:** the robot greets you with radio-static-and-beeps. The page shows "Hi Avi. Where to?". Type or dictate the destination (English or Tamil), and Claude works out the place. Tap **Open Google Maps** to start navigation.
- **A known passenger gets in:** a card appears on the page: "Sam just got in. Navigate to <their home>?" with **Navigate** and **Ignore** buttons. If you do nothing, it expires (default 1 hour) and nothing happens.
- **Unknown faces:** shown only as a count. Nothing is stored about them.
- **People:** add, edit and remove people (with photos from your phone) on the same page.

```
camera -> InsightFace (on the Pi) -> who + which seat
  driver    -> greet sound + prompt on the page -> you type/dictate -> Claude -> Google Maps link
  passenger -> sound + card on the page        -> you tap Navigate  -> Google Maps
```

## Hardware
- Raspberry Pi 5 + AI HAT (not used yet; everything runs on the CPU), camera facing the front seats (Pi Camera Module 3 or USB webcam), small speaker or AUX for the sounds. No microphone is needed.
- Power: a 5V/5A converter on an ignition-switched fuse tap, so the Pi boots with the car. Protect the SD card from sudden power loss (NVMe, read-only root, or a clean-shutdown board).

## Connecting your phone
The Pi needs internet for Claude, and your phone needs to reach the Pi. Two ways:
1. **Recommended: Tailscale** on the Pi and the iPhone. Then run `sudo tailscale serve --bg 8080` on the Pi to get an `https://` address. HTTPS is needed for the page's 🎤 Speak button.
2. **iPhone Personal Hotspot:** join the Pi to your hotspot and open `http://<pi-ip>:8080`. Typing and the iPhone keyboard's dictation key work over plain http; the 🎤 button may not.

Bookmark the page (don't use "Add to Home Screen": iOS disables speech recognition in installed web apps).
The page is protected by `PAGE_TOKEN`, and the Pi refuses to start without a long one. Don't expose port 8080 to the public internet.

## Setup
```
sudo apt install libportaudio2 python3-picamera2
python3 -m venv --system-site-packages .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env     # set ANTHROPIC_API_KEY and PAGE_TOKEN (openssl rand -hex 16)
sudo cp deploy/companion.service /etc/systemd/system/ && sudo systemctl enable --now companion
```
Then open the page, enter the token, and add yourself and the others (5 to 15 clear photos each, only with their consent). Only face fingerprints are saved, in `data/people.json` (git-ignored, mode 600). There is also a command-line version: `python -m companion.enroll add --name Avi photos/*.jpg`.

## Tuning
- `DRIVER_SIDE`: which half of the camera image the driver sits in. If you are treated as a passenger, flip it.
- `FACE_THRESHOLD`: raise if the wrong person is matched, lower if you aren't recognised.
- `SUGGESTION_TTL`: seconds an unanswered passenger card stays visible.
- Optional: set `PUSHCUT_API_KEY` to also get a lock-screen notification for passengers through the Pushcut app (create a notification named `CarPassenger`). Without it, you only see the cards while the page is open.

## Robot sounds
Synthesised in `companion/sounds.py`: `greet`, `ask` (passenger suggestion), `ok`, `huh`, `error`, `listen`, `bye`. Put your own WAVs named after those events in `sounds/` to replace them.

## Status
Prototype. `pytest tests` (24 tests) covers face matching, seat logic, map links, sounds, and the web API (token check,
destination, suggestions, people editing). The page loads without errors in a phone-sized browser. The camera, face
model, Claude calls, speech button and a real iPhone have **not** been tested; web push to a locked phone is not
implemented (use Pushcut for that).
