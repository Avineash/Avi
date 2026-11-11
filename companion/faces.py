"""Face matching against people you have enrolled. Embeddings are stored, not photos."""
import json
import os
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


class FaceRecognizer:
    def __init__(self, people: list[Person], threshold: float, driver_side: str):
        from insightface.app import FaceAnalysis  # heavy import, kept lazy

        self.people, self.threshold, self.driver_side = people, threshold, driver_side
        self.app = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=-1, det_size=(640, 640))

    def embed(self, frame):
        """[(bbox, normalized embedding)] for every face in a BGR frame."""
        return [(f.bbox, f.normed_embedding) for f in self.app.get(frame)]

    def look(self, frame) -> list[Sighting]:
        width = frame.shape[1]
        out = []
        for bbox, emb in self.embed(frame):
            person, score = best_match(emb, self.people, self.threshold)
            cx = float((bbox[0] + bbox[2]) / 2)
            out.append(Sighting(person, score, seat_of(cx, width, self.driver_side)))
        return out
