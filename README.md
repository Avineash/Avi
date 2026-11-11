# Avi: car companion robot

A Raspberry Pi 5 robot that watches who gets into the car.

- **You (the driver) are recognised:** it greets you with a Bumblebee-style burst of radio static and beeps, then listens for where you want to go in English or Tamil, and opens Google Maps navigation on your iPhone. It never speaks: it answers with robot sounds.
- **A known passenger gets in:** it sends a notification to your phone, "Sam just got in. Navigate to <their home>?". Tap it to start Google Maps navigation. Ignore it and nothing happens.
- **Unknown faces:** ignored. Nothing is stored about them.

```
camera -> InsightFace (face match, on the Pi) -> who + which seat
  driver    -> greet sound -> mic -> Whisper (en/ta) -> Claude (destination) -> Pushcut runs Shortcut -> Google Maps -> happy whirr
  passenger -> Pushcut notification -> you tap -> Google Maps
```

## Hardware
- Raspberry Pi 5 + AI HAT, camera facing the front seats (Pi Camera Module 3, or a USB webcam), USB mic, small speaker or AUX.
- Power: a 5V/5A converter wired to an ignition-switched fuse tap, so the Pi boots when the car starts. Protect the SD card from sudden power loss (NVMe, read-only root, or a clean-shutdown power board).
- The AI HAT is not used yet. Face matching and speech run on the Pi 5 CPU.

## Setup
```
sudo apt install libportaudio2 python3-picamera2
python3 -m venv --system-site-packages .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env     # fill in keys
```

**Enroll people** (only with their consent; 5 to 15 clear photos each, varied light and angles):
```
python -m companion.enroll add --name Avi --language en photos/avi/*.jpg
python -m companion.enroll add --name Sam --address "12 Smith St, Sydney" --language ta photos/sam/*.jpg
python -m companion.enroll list
python -m companion.enroll remove --name Sam
```
Only face fingerprints are saved, in `data/people.json` (git-ignored, mode 600). Delete the photos afterwards.

**iPhone (Pushcut):**
1. Shortcuts: create `Navigate` that takes its input (a URL) and runs "Open URLs".
2. Pushcut: enable the Automation Server, create a notification named `CarPassenger`, copy your API key into `.env`.

**Run at boot:** `sudo cp deploy/companion.service /etc/systemd/system/ && sudo systemctl enable --now companion`

## Tuning
- `DRIVER_SIDE`: which half of the camera image the driver sits in. If you get greeted as a passenger, flip it.
- `FACE_THRESHOLD`: raise it if the wrong person is matched, lower it if you aren't recognised.
- `WHISPER_MODEL=medium` improves Tamil at the cost of speed.
- `VOLUME` sets the sound level (0 to 1).
- `CONFIRM_DESTINATION=1` makes the robot play a question sound and wait for you to say yes before opening Maps. It is off by default because the robot can't read the destination back; the map that opens on your phone is the confirmation.

## Robot sounds
Sounds are synthesised in code (`companion/sounds.py`): `greet`, `listen` (go ahead), `ask`, `ok` (success), `huh` (didn't get it), `error` and `bye`.
To use real Bumblebee-style radio clips, put your own short WAV files named after those events in `sounds/` (for example `sounds/greet.wav`) and they replace the built-in ones. I haven't included any film audio because it is copyrighted.

## Status
Prototype. `pytest tests` covers face matching, seat logic, map links, the notification payload and sound generation (I haven't listened to the sounds, so tune them by ear). Camera, face model,
microphone, Whisper, Claude and Pushcut were written but not run end to end here (no hardware or keys). Pushcut's
notification fields (`defaultAction`, `actions`) and the Automation Server behaviour should be checked on a real phone.
