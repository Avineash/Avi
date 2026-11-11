"""Manage enrolled people.

  python -m companion.enroll add --name Sam --address "12 Smith St, Sydney" --language ta photos/sam/*.jpg
  python -m companion.enroll list
  python -m companion.enroll remove --name Sam
"""
import argparse

import numpy as np

from .config import Config
from .faces import Person, load_people, normalize, save_people


def embed_photos(paths: list[str]) -> np.ndarray:
    import cv2
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    embs = []
    for path in paths:
        img = cv2.imread(path)
        faces = app.get(img) if img is not None else []
        if not faces:
            print(f"  skipped (no face found): {path}")
            continue
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        embs.append(face.normed_embedding)
    return normalize(np.array(embs, dtype="float32")) if embs else np.zeros((0, 512), dtype="float32")


def main() -> None:
    cfg = Config()
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    add = sub.add_parser("add")
    add.add_argument("--name", required=True)
    add.add_argument("--address", default="")
    add.add_argument("--language", choices=["en", "ta"], default=None)
    add.add_argument("photos", nargs="+")
    sub.add_parser("list")
    rm = sub.add_parser("remove")
    rm.add_argument("--name", required=True)
    args = ap.parse_args()

    people = load_people(cfg.people_file)
    if args.cmd == "list":
        for p in people:
            print(f"{p.name}: {len(p.embeddings)} photos, home={p.address or '-'}, lang={p.language or 'auto'}")
        return
    if args.cmd == "remove":
        save_people(cfg.people_file, [p for p in people if p.name != args.name])
        print(f"removed {args.name}")
        return
    embs = embed_photos(args.photos)
    if len(embs) < 3:
        raise SystemExit(f"only {len(embs)} usable photos; use at least 3 (5-15 is better)")
    people = [p for p in people if p.name != args.name]
    people.append(Person(args.name, args.address, args.language, embs))
    save_people(cfg.people_file, people)
    print(f"enrolled {args.name} with {len(embs)} photos")


if __name__ == "__main__":
    main()
