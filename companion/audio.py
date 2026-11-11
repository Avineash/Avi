"""Microphone capture with simple silence detection."""
import time

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000


def record_until_silence(max_seconds: float, silence_seconds: float, threshold: float) -> np.ndarray:
    """Record mono audio; stop after speech followed by `silence_seconds` of quiet."""
    block = int(SAMPLE_RATE * 0.1)
    chunks: list[np.ndarray] = []
    heard_speech = False
    quiet_blocks = 0
    deadline = time.monotonic() + max_seconds
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=block) as stream:
        while time.monotonic() < deadline:
            data, _ = stream.read(block)
            chunks.append(data[:, 0].copy())
            loud = float(np.sqrt(np.mean(data**2))) > threshold
            if loud:
                heard_speech, quiet_blocks = True, 0
            elif heard_speech:
                quiet_blocks += 1
                if quiet_blocks * 0.1 >= silence_seconds:
                    break
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype="float32")
