# Avi: car companion

A small in-car device that wakes when the car powers its USB port, asks where you're going,
works out the destination with Claude, and triggers a shortcut on your phone that opens navigation.

```
car USB power -> Pi boots -> systemd starts companion
  mic -> faster-whisper (local STT) -> Claude (destination) -> confirm by voice
  -> Pushcut (iPhone Shortcut) or ntfy (Android Tasker) -> Maps app opens with directions
```

## Hardware
- **Raspberry Pi 5 + AI HAT** (the AI HAT needs the Pi 5's PCIe connector), a USB mic, and a small speaker or the car's AUX input.
- **Power:** a Pi 5 wants 5V/5A, which a normal car USB port can't supply. Use a 12V-to-5V buck converter rated for 5A (for example a hardwire kit), wired to an ignition-switched fuse-box tap. The Pi then boots when the car starts and the service starts with it.
- **Shutdown:** cutting power can corrupt the SD card. Use an NVMe or read-only root, or a power board that signals a clean shutdown when ignition goes off.
- **AI HAT:** the Hailo chip on the HAT is mainly for vision models. This prototype runs speech-to-text on the Pi 5 CPU with `faster-whisper` (set `WHISPER_MODEL=small.en` for better accuracy; `base.en` is faster). The HAT is not used yet. Running Whisper on it needs the Hailo toolchain and a supported model, which I haven't verified.

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
