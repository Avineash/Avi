"""The phone-facing web page and its JSON API."""
import hmac
import os
import re

import numpy as np
from flask import Flask, abort, jsonify, request, send_from_directory

from .config import Config
from .faces import PeopleStore, Person, normalize
from .intent import parse_destination
from .phone import maps_url
from .state import State

STATIC = os.path.join(os.path.dirname(__file__), "static")
NAME_RE = re.compile(r"^[^\x00-\x1f]{1,40}$")


def create_app(cfg: Config, state: State, store: PeopleStore, get_recognizer=lambda: None,
               on_sound=lambda event: None) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024

    @app.before_request
    def auth():
        if request.path.startswith("/api/"):
            token = request.headers.get("X-Token", "")
            if not hmac.compare_digest(token.encode(), cfg.page_token.encode()):
                abort(401)

    @app.get("/")
    def index():
        return send_from_directory(STATIC, "index.html")

    def people_json():
        return [{"name": p.name, "address": p.address, "language": p.language, "photos": len(p.embeddings)}
                for p in store.snapshot()]

    @app.get("/api/state")
    def get_state():
        return jsonify(state.snapshot() | {"people": people_json()})

    @app.post("/api/destination")
    def destination():
        text = ((request.get_json(silent=True) or {}).get("text") or "").strip()
        if not text or len(text) > 500:
            return jsonify(error="Say or type where you want to go (max 500 characters)."), 400
        home = state.prompt["address"] if state.prompt else ""
        try:
            dest = parse_destination(text, cfg, home=home)
        except Exception:
            app.logger.exception("destination parsing failed")
            on_sound("error")
            return jsonify(error="Couldn't work out the destination (is the Pi online?)."), 502
        if not dest.understood or not dest.query:
            on_sound("huh")
            return jsonify(understood=False)
        state.clear_prompt()
        state.add_event("destination", dest.query)
        on_sound("ok")
        return jsonify(understood=True, query=dest.query, mode=dest.mode,
                       url=maps_url(dest.query, cfg.maps_app, dest.mode))

    @app.post("/api/suggestions/<int:sid>/<action>")
    def suggestion(sid: int, action: str):
        if action not in ("opened", "dismissed"):
            abort(404)
        if not state.update_suggestion(sid, action):
            abort(404)
        return jsonify(ok=True)

    @app.post("/api/people")
    def add_person():
        name = (request.form.get("name") or "").strip()
        language = request.form.get("language") or None
        if not NAME_RE.match(name) or language not in (None, "en", "ta"):
            return jsonify(error="Enter a name (up to 40 characters) and a valid language."), 400
        recognizer = get_recognizer()
        if recognizer is None:
            return jsonify(error="The face model isn't ready yet."), 503
        import cv2  # lazy: only needed for uploads

        embs = []
        for f in request.files.getlist("photos"):
            img = cv2.imdecode(np.frombuffer(f.read(), np.uint8), cv2.IMREAD_COLOR)
            emb = recognizer.enroll_embedding(img) if img is not None else None
            if emb is not None:
                embs.append(emb)
        if len(embs) < 3:
            return jsonify(error=f"Only {len(embs)} usable photos found; send at least 3 (5-15 is better)."), 400
        store.upsert(Person(name, (request.form.get("address") or "").strip(), language,
                            normalize(np.array(embs, dtype="float32"))))
        state.add_event("people", f"Enrolled {name} with {len(embs)} photos")
        return jsonify(ok=True, photos=len(embs))

    @app.patch("/api/people/<name>")
    def edit_person(name: str):
        body = request.get_json(silent=True) or {}
        language = body.get("language")
        if language not in (None, "", "en", "ta"):
            return jsonify(error="Language must be en, ta or empty."), 400
        if not store.update(name, address=body.get("address"), language=language):
            abort(404)
        return jsonify(ok=True)

    @app.delete("/api/people/<name>")
    def delete_person(name: str):
        if not store.remove(name):
            abort(404)
        state.add_event("people", f"Removed {name}")
        return jsonify(ok=True)

    return app
