import numpy as np
import pytest

from companion import sounds


@pytest.mark.parametrize("event", sounds.EVENTS)
def test_every_event_synthesises(event):
    wav = sounds.synth(event)
    assert wav.size > sounds.SR * 0.1
    assert np.max(np.abs(wav)) <= 1.0 and np.max(np.abs(wav)) > 0.05


def test_unknown_event():
    with pytest.raises(ValueError):
        sounds.synth("nope")


def test_wav_override(tmp_path):
    import wave

    with wave.open(str(tmp_path / "greet.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(np.zeros(1600, dtype=np.int16).tobytes())
    samples, rate = sounds.get_sound("greet", str(tmp_path))
    assert rate == 16000 and samples.size == 1600
