import numpy as np

from companion.faces import Person, best_match, load_people, normalize, save_people, seat_of


def unit(*v):
    return normalize(np.array(v, dtype="float32"))


def test_best_match_and_threshold():
    sam = Person("Sam", embeddings=np.stack([unit(1, 0, 0), unit(0.9, 0.1, 0)]))
    lee = Person("Lee", embeddings=np.stack([unit(0, 1, 0)]))
    person, score = best_match(unit(0.95, 0.05, 0), [sam, lee], 0.4)
    assert person.name == "Sam" and score > 0.9
    stranger, _ = best_match(unit(0, 0, 1), [sam, lee], 0.4)
    assert stranger is None


def test_seat_of():
    assert seat_of(100, 1000, "left") == "driver"
    assert seat_of(900, 1000, "left") == "passenger"
    assert seat_of(900, 1000, "right") == "driver"


def test_roundtrip(tmp_path):
    path = str(tmp_path / "people.json")
    save_people(path, [Person("Sam", "12 Smith St", "ta", np.stack([unit(1, 0), unit(0, 1)]))])
    (p,) = load_people(path)
    assert (p.name, p.address, p.language) == ("Sam", "12 Smith St", "ta")
    assert p.embeddings.shape == (2, 2)
