"""Entry point. Runs once per power-up: greet, listen, resolve destination, trigger phone."""
import logging
import sys

from . import audio, phone
from .config import Config
from .intent import parse_destination
from .stt import Transcriber

log = logging.getLogger("companion")
YES = {"yes", "yeah", "yep", "correct", "go", "sure", "ok", "okay"}


def listen(cfg: Config, stt: Transcriber) -> str:
    clip = audio.record_until_silence(cfg.max_listen_seconds, cfg.silence_seconds, cfg.energy_threshold)
    text = stt(clip)
    log.info("heard: %r", text)
    return text


def run(cfg: Config) -> int:
    stt = Transcriber(cfg.whisper_model)
    audio.speak("Hi. Where are we going?")
    for _ in range(3):
        text = listen(cfg, stt)
        if not text:
            audio.speak("I didn't hear anything. Where to?")
            continue
        dest = parse_destination(text, cfg)
        if not dest.understood or not dest.query:
            audio.speak(dest.reply)
            continue
        if cfg.confirm:
            audio.speak(f"{dest.query}. Is that right?")
            answer = listen(cfg, stt).lower().strip(" .!?")
            if answer.split(" ")[0] not in YES:
                audio.speak("Okay, where to?")
                continue
        try:
            phone.send_to_phone(dest.query, dest.mode, cfg)
        except Exception:
            log.exception("phone trigger failed")
            audio.speak("I couldn't reach your phone.")
            return 1
        audio.speak(dest.reply)
        return 0
    audio.speak("Okay, I'll stay quiet.")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sys.exit(run(Config()))
