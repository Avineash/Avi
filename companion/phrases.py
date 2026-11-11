"""Spoken phrases in English and Tamil."""

PHRASES = {
    "en": {
        "greet": "Hi {name}. Where are we going?",
        "retry": "I didn't hear anything. Where to?",
        "confirm": "{place}. Is that right?",
        "again": "Okay, where to?",
        "phone_fail": "I couldn't reach your phone.",
        "giveup": "Okay, I'll stay quiet.",
    },
    "ta": {
        "greet": "வணக்கம் {name}. எங்கே போகலாம்?",
        "retry": "எனக்கு கேட்கவில்லை. எங்கே போகணும்?",
        "confirm": "{place}. சரியா?",
        "again": "சரி, எங்கே போகணும்?",
        "phone_fail": "உங்கள் போனுடன் இணைக்க முடியவில்லை.",
        "giveup": "சரி, நான் அமைதியாக இருக்கிறேன்.",
    },
}

YES = {"yes", "yeah", "yep", "correct", "go", "sure", "ok", "okay",
       "ஆமாம்", "ஆம்", "ஆமா", "சரி", "சரிதான்"}


def say(key: str, lang: str | None, **kw) -> str:
    return PHRASES.get(lang or "en", PHRASES["en"])[key].format(**kw)
