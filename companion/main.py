"""Start the robot loop in the background and serve the phone page."""
import logging
import threading

from waitress import serve

from .config import Config
from .faces import FaceRecognizer, PeopleStore
from .robot import play_async, watch
from .state import State
from .web import create_app

log = logging.getLogger("companion")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    cfg = Config()
    if len(cfg.page_token) < 16:
        raise SystemExit("Set PAGE_TOKEN to a long random string (at least 16 characters): openssl rand -hex 16")
    state = State(cfg.suggestion_ttl)
    store = PeopleStore(cfg.people_file)
    holder: dict = {}

    def start_robot() -> None:
        try:
            from .camera import Camera

            state.add_event("status", "Loading face model...")
            holder["recognizer"] = FaceRecognizer(store, cfg.face_threshold, cfg.driver_side)
            cam = Camera(cfg)
        except Exception as e:
            log.exception("robot failed to start")
            state.add_event("error", f"Robot failed to start: {e}")
            return
        state.add_event("status", f"Watching with {len(store.snapshot())} enrolled people")
        watch(cfg, state, store, holder["recognizer"], cam)

    threading.Thread(target=start_robot, daemon=True).start()
    app = create_app(cfg, state, store, lambda: holder.get("recognizer"), lambda e: play_async(cfg, e))
    log.info("page on http://%s:%d", cfg.host, cfg.port)
    serve(app, host=cfg.host, port=cfg.port, threads=4)


if __name__ == "__main__":
    main()
