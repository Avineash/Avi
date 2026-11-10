# Avi: car companion

A small in-car device that wakes when the car powers its USB port, asks where you're going,
works out the destination with Claude, and triggers a shortcut on your phone that opens navigation.

```
car USB power -> Pi boots -> systemd starts companion
  mic -> faster-whisper (local STT) -> Claude (destination) -> confirm by voice
  -> Pushcut (iPhone Shortcut) or ntfy (Android Tasker) -> Maps app opens with directions
```

## Hardware
- Raspberry Pi Zero 2 W (or any Pi) plus a USB mic and a small speaker or the car's AUX input.
- Plug it into a USB port that is only powered with the ignition, or use a switched 12V-to-USB adapter.
  Power on is the wake signal, so no extra sensing code is needed.
- Caveat: cutting power on a Pi can corrupt the SD card. Use a read-only root filesystem or a small UPS/supercap board.

## Setup
```
sudo apt install espeak-ng libportaudio2
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in keys
sudo cp deploy/companion.service /etc/systemd/system/ && sudo systemctl enable companion
```

### Phone side
- **iPhone:** make a Shortcut named `Navigate` that takes the text input (a maps URL) and runs "Open URLs".
  Install Pushcut, enable its Automation Server, and put your API key in `.env`.
- **Android:** set `PHONE_BACKEND=ntfy`, subscribe the ntfy app to your topic, and have Tasker or
  MacroDroid open the received URL when a message arrives.

## Status
Prototype. Unit tests cover the maps URL building only (`pytest tests`). The microphone, Whisper,
Claude call and Pushcut/ntfy calls were written but not run end to end, because this build environment has no
hardware or credentials. Expect to tune `ENERGY_THRESHOLD` for your car's noise level.
