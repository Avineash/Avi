"""The robot loop: watch the cabin, make sounds, post to the web page."""
import logging
import threading
import time

from . import phone, sounds
from .camera import Camera
from .config import Config
from .faces import FaceRecognizer, PeopleStore
from .state import State

log = logging.getLogger("companion.robot")


def play_async(cfg: Config, event: str) -> None:
    def _go():
        try:
            sounds.play(event, cfg.sounds_dir, cfg.volume)
        except Exception:
            log.warning("could not play %r (no audio device?)", event)

    threading.Thread(target=_go, daemon=True).start()


def watch(cfg: Config, state: State, store: PeopleStore, recognizer: FaceRecognizer, cam: Camera) -> None:
    streak: dict[str, int] = {}
    handled: dict[str, float] = {}  # name -> last time seen after being handled
    while True:
        try:
            frame = cam.read()
            sightings = recognizer.look(frame) if frame is not None else []
            if state.camera_ok is not (frame is not None):
                state.camera_ok = frame is not None
                state.add_event("status", "Camera connected" if frame is not None else "Camera not responding")
        except Exception:
            log.exception("frame processing failed")
            state.camera_ok = False
            time.sleep(cfg.frame_interval)
            continue
        now = time.monotonic()
        seen = {s.person.name: s for s in sightings if s.person}
        streak = {n: streak.get(n, 0) + 1 for n in seen}
        state.set_cabin([{"name": n, "seat": s.seat} for n, s in seen.items()],
                        sum(1 for s in sightings if not s.person))
        for name, s in seen.items():
            if name in handled:
                handled[name] = now
            elif streak[name] >= cfg.confirm_frames:
                handled[name] = now
                log.info("recognised %s (%s, score %.2f)", name, s.seat, s.score)
                if s.seat == "driver":
                    play_async(cfg, "greet")
                    state.set_prompt(name, s.person.address)
                    state.add_event("driver", f"Hi {name}. Where to?")
                elif s.person.address:
                    url = phone.maps_url(s.person.address, cfg.maps_app)
                    state.add_suggestion(name, s.person.address, url)
                    state.add_event("passenger", f"{name} got in. Navigate to their home?")
                    play_async(cfg, "ask")
                    if cfg.pushcut_api_key:
                        try:
                            phone.notify_trip(name, s.person.address, cfg)
                        except Exception:
                            log.exception("pushcut notification failed")
        for name in [n for n, t in handled.items() if now - t > cfg.absent_reset]:
            del handled[name]
        time.sleep(cfg.frame_interval)
