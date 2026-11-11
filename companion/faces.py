"""Face matching against people you have enrolled. Embeddings are stored, not photos."""
import json
import os
import threading
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Person:
    name: str
    address: str = ""
    language: str | None = None  # "en", "ta" or None for auto-detect
    embeddings: np.ndarray = field(default_factory=lambda: np.zeros((0, 512), dtype="float32"))


@dataclass
class Sighting:
    person: Person | None
    score: float
    seat: str  # "driver" or "passenger"


def normalize(v: np.ndarray) -> np.ndarray:
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)


def load_people(path: str) -> list[Person]:
    if not os.path.exists(path):
        return []
    with open(path) as f:
        raw = json.load(f)
    return [
        Person(p["name"], p.get("address", ""), p.get("language"),
               normalize(np.array(p["embeddings"], dtype="float32")))
        for p in raw["people"]
    ]


def save_people(path: str, people: list[Person]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    data = {"people": [
        {"name": p.name, "address": p.address, "language": p.language,
         "embeddings": p.embeddings.round(5).tolist()}
        for p in people
    ]}
    with open(path, "w") as f:
        json.dump(data, f)
    os.chmod(path, 0o600)


def best_match(emb: np.ndarray, people: list[Person], threshold: float) -> tuple[Person | None, float]:
    """Closest enrolled person by cosine similarity, or None if below threshold."""
    emb = normalize(emb)
    best, best_score = None, -1.0
    for p in people:
        if len(p.embeddings) == 0:
            continue
        score = float(np.max(p.embeddings @ emb))
        if score > best_score:
            best, best_score = p, score
    return (best, best_score) if best_score >= threshold else (None, best_score)


def seat_of(bbox_center_x: float, frame_width: int, driver_side: str) -> str:
    on_left = bbox_center_x < frame_width / 2
    return "driver" if on_left == (driver_side == "left") else "passenger"


class PeopleStore:
    """Enrolled people, shared by the robot loop and the web page."""

    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        self._people = load_people(path)

    def snapshot(self) -> list[Person]:
        with self._lock:
            return list(self._people)

    def upsert(self, person: Person) -> None:
        with self._lock:
            self._people = [p for p in self._people if p.name != person.name] + [person]
            save_people(self.path, self._people)

    def update(self, name: str, address: str | None = None, language: str | None = None) -> bool:
        with self._lock:
            for p in self._people:
                if p.name == name:
                    if address is not None:
                        p.address = address
                    if language is not None:
                        p.language = language or None
                    save_people(self.path, self._people)
                    return True
            return False

    def remove(self, name: str) -> bool:
        with self._lock:
            kept = [p for p in self._people if p.name != name]
            changed = len(kept) != len(self._people)
            self._people = kept
            if changed:
                save_people(self.path, kept)
            return changed


class FaceRecognizer:
    def __init__(self, store: PeopleStore, threshold: float, driver_side: str):
        from insightface.app import FaceAnalysis  # heavy import, kept lazy

        self.store, self.threshold, self.driver_side = store, threshold, driver_side
        self._lock = threading.Lock()
        self.app = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=-1, det_size=(640, 640))

    def _faces(self, frame):
        with self._lock:
            return self.app.get(frame)

    def enroll_embedding(self, img):
        """Embedding of the largest face in an image, or None."""
        faces = self._faces(img)
        if not faces:
            return None
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        return face.normed_embedding

    def look(self, frame) -> list[Sighting]:
        width = frame.shape[1]
        people = self.store.snapshot()
        out = []
        for f in self._faces(frame):
            person, score = best_match(f.normed_embedding, people, self.threshold)
            cx = float((f.bbox[0] + f.bbox[2]) / 2)
            out.append(Sighting(person, score, seat_of(cx, width, self.driver_side)))
        return out
