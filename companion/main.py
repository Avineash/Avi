"""The robot: watches the cabin, greets the driver, notifies your phone about passengers."""
import logging
import time

from . import audio, phone, sounds
from .camera import Camera
from .config import Config
from .faces import FaceRecognizer, Person, load_people
from .intent import parse_destination
from .stt import Transcriber

log = logging.getLogger("companion")
YES = {"yes", "yeah", "yep", "correct", "go", "sure", "ok", "okay",
       "ஆமாம்", "ஆம்", "ஆமா", "சரி", "சரிதான்"}


def listen(cfg: Config, stt: Transcriber, language: str | None) -> str:
    clip = audio.record_until_silence(cfg.max_listen_seconds, cfg.silence_seconds, cfg.energy_threshold)
    text = stt(clip, language)
    log.info("heard: %r", text)
    return text


def beep(event: str, cfg: Config) -> None:
    sounds.play(event, cfg.sounds_dir, cfg.volume)


def handle_driver(person: Person, cfg: Config, stt: Transcriber) -> None:
    beep("greet", cfg)
    for _ in range(3):
        beep("listen", cfg)
        text = listen(cfg, stt, person.language)
        if not text:
            beep("huh", cfg)
            continue
        dest = parse_destination(text, cfg)
        if not dest.understood or not dest.query:
            beep("huh", cfg)
            continue
        if cfg.confirm:
            beep("ask", cfg)  # you can't hear the destination, so check the map that opens on your phone
            answer = listen(cfg, stt, person.language).lower().strip(" .!?")
            if not answer or answer.split(" ")[0].strip(".,!?") not in YES:
                beep("huh", cfg)
                continue
        try:
            phone.send_to_phone(dest.query, dest.mode, cfg)
        except Exception:
            log.exception("phone trigger failed")
            beep("error", cfg)
            return
        beep("ok", cfg)
        return
    beep("bye", cfg)


def handle_passenger(person: Person, cfg: Config) -> None:
    if not person.address:
        log.info("%s has no address on file; skipping", person.name)
        return
    try:
        phone.notify_trip(person.name, person.address, cfg)
        log.info("notified phone about %s", person.name)
    except Exception:
        log.exception("notification failed")


def run(cfg: Config) -> None:
    people = load_people(cfg.people_file)
    if not people:
        raise SystemExit(f"No one enrolled. Run: python -m companion.enroll add ... ({cfg.people_file})")
    cam = Camera(cfg)
    recognizer = FaceRecognizer(people, cfg.face_threshold, cfg.driver_side)
    stt = Transcriber(cfg.whisper_model)
    streak: dict[str, int] = {}  # consecutive frames each person has been seen
    handled: dict[str, float] = {}  # name -> last time they were seen after being handled
    log.info("watching with %d enrolled people", len(people))
    while True:
        frame = cam.read()
        sightings = recognizer.look(frame) if frame is not None else []
        now = time.monotonic()
        seen = {s.person.name: s for s in sightings if s.person}
        streak = {n: streak.get(n, 0) + 1 for n in seen}
        for name, s in seen.items():
            if name in handled:
                handled[name] = now
            elif streak[name] >= cfg.confirm_frames:
                handled[name] = now
                log.info("recognised %s (%s, score %.2f)", name, s.seat, s.score)
                if s.seat == "driver":
                    handle_driver(s.person, cfg, stt)
                else:
                    handle_passenger(s.person, cfg)
        for name in [n for n, t in handled.items() if now - t > cfg.absent_reset]:
            del handled[name]
        time.sleep(cfg.frame_interval)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run(Config())
