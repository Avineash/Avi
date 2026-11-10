import numpy as np
from faster_whisper import WhisperModel


class Transcriber:
    def __init__(self, model_name: str):
        self._model = WhisperModel(model_name, device="cpu", compute_type="int8")

    def __call__(self, audio: np.ndarray) -> str:
        if audio.size == 0:
            return ""
        segments, _ = self._model.transcribe(audio, language="en", vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip()
