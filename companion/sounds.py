"""Robot sound effects, synthesised in code (radio static, servo whirrs, chirps).

Drop your own short WAV files into the sounds/ folder (greet.wav, ask.wav, ...) to override any event.
"""
import os
import wave

import numpy as np

SR = 22050
EVENTS = ("greet", "listen", "ask", "ok", "huh", "error", "bye")


def _t(dur: float) -> np.ndarray:
    return np.linspace(0, dur, int(SR * dur), endpoint=False)


def chirp(f0: float, f1: float, dur: float, gain: float = 0.5) -> np.ndarray:
    t = _t(dur)
    f = np.linspace(f0, f1, t.size)
    wave_ = np.sin(2 * np.pi * np.cumsum(f) / SR)
    env = np.minimum(1, np.minimum(t, dur - t) / 0.01)  # short fade in/out, no clicks
    return gain * wave_ * env


def whirr(f0: float, f1: float, dur: float, gain: float = 0.35) -> np.ndarray:
    """Servo-like sawtooth sweep with a wobble."""
    t = _t(dur)
    f = np.linspace(f0, f1, t.size) * (1 + 0.04 * np.sin(2 * np.pi * 28 * t))
    phase = np.cumsum(f) / SR
    saw = 2 * (phase % 1) - 1
    env = np.minimum(1, np.minimum(t, dur - t) / 0.03)
    return gain * saw * env


def static(dur: float, gain: float = 0.25, seed: int = 1) -> np.ndarray:
    """Radio static: noise in stuttering bursts."""
    rng = np.random.default_rng(seed)
    noise = rng.uniform(-1, 1, int(SR * dur))
    gate = np.repeat(rng.uniform(0, 1, int(dur * 40) + 1) > 0.35, SR // 40)[: noise.size]
    return gain * noise * gate


def _seq(*parts: np.ndarray) -> np.ndarray:
    return np.concatenate(parts)


def _gap(dur: float = 0.04) -> np.ndarray:
    return np.zeros(int(SR * dur))


def synth(event: str) -> np.ndarray:
    if event == "greet":  # tuning a radio, then a happy blip-blip-whirr
        return _seq(static(0.45), chirp(300, 1800, 0.12), static(0.15, seed=2), chirp(700, 1400, 0.1),
                    _gap(), chirp(900, 1700, 0.1), whirr(150, 600, 0.25))
    if event == "listen":  # "go ahead"
        return _seq(chirp(600, 1200, 0.08), _gap(), chirp(900, 1500, 0.08))
    if event == "ask":  # rising question
        return _seq(whirr(200, 350, 0.15), chirp(500, 1600, 0.25))
    if event == "ok":  # affirmative double beep and a transform whirr
        return _seq(chirp(1000, 1000, 0.07), _gap(), chirp(1400, 1400, 0.07), _gap(0.05), whirr(120, 700, 0.35))
    if event == "huh":  # didn't get it: falling warble
        return _seq(chirp(1200, 500, 0.2), chirp(600, 900, 0.1), chirp(900, 400, 0.2))
    if event == "error":
        return _seq(whirr(300, 80, 0.4, gain=0.4), static(0.25, seed=3))
    if event == "bye":
        return _seq(chirp(1200, 800, 0.1), _gap(), whirr(500, 100, 0.4))
    raise ValueError(f"unknown sound event {event!r}")


def _load_wav(path: str) -> np.ndarray:
    with wave.open(path) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype("float32") / 32768
        return data.reshape(-1, w.getnchannels()).mean(axis=1)  # mono; sample rate left as recorded


def get_sound(event: str, sounds_dir: str = "sounds") -> tuple[np.ndarray, int]:
    path = os.path.join(sounds_dir, f"{event}.wav")
    if os.path.exists(path):
        with wave.open(path) as w:
            return _load_wav(path), w.getframerate()
    return synth(event).astype("float32"), SR


def play(event: str, sounds_dir: str = "sounds", volume: float = 1.0) -> None:
    import sounddevice as sd

    samples, rate = get_sound(event, sounds_dir)
    sd.play(np.clip(samples * volume, -1, 1), rate)
    sd.wait()
