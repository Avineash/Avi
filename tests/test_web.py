import numpy as np
import pytest

from companion import web
from companion.config import Config
from companion.faces import PeopleStore, Person, normalize
from companion.intent import Destination
from companion.state import State

H = {"X-Token": "t" * 16}


@pytest.fixture
def env(tmp_path, monkeypatch):
    cfg = Config(page_token="t" * 16, people_file=str(tmp_path / "people.json"))
    state, store = State(), PeopleStore(cfg.people_file)
    store.upsert(Person("Sam", "12 Smith St", "ta", normalize(np.ones((3, 4), dtype="float32"))))
    sounds = []
    app = web.create_app(cfg, state, store, on_sound=sounds.append)
    return app.test_client(), state, store, sounds, monkeypatch


def test_requires_token(env):
    client, *_ = env
    assert client.get("/").status_code == 200  # the shell page is public
    assert client.get("/api/state").status_code == 401
    assert client.get("/api/state", headers={"X-Token": "wrong"}).status_code == 401
    assert client.get("/api/state", headers=H).status_code == 200


def test_state_lists_people_without_embeddings(env):
    client, *_ = env
    body = client.get("/api/state", headers=H).get_json()
    assert body["people"] == [{"name": "Sam", "address": "12 Smith St", "language": "ta", "photos": 3}]


def test_destination_returns_google_link(env):
    client, state, _, sounds, mp = env
    seen = {}

    def fake_parse(text, cfg, home=""):
        seen["home"] = home
        return Destination(understood=True, query="Bunnings Marrickville")

    mp.setattr(web, "parse_destination", fake_parse)
    state.set_prompt("Avi", "1 Home Rd")
    r = client.post("/api/destination", json={"text": "bunnings"}, headers=H)
    body = r.get_json()
    assert body["understood"] and body["url"].startswith("https://www.google.com/maps/dir/")
    assert seen["home"] == "1 Home Rd" and state.snapshot()["prompt"] is None and sounds == ["ok"]


def test_destination_not_understood_and_errors(env):
    client, _, _, sounds, mp = env
    mp.setattr(web, "parse_destination", lambda *a, **k: Destination(understood=False))
    assert client.post("/api/destination", json={"text": "hmm"}, headers=H).get_json() == {"understood": False}
    assert client.post("/api/destination", json={"text": " "}, headers=H).status_code == 400

    def boom(*a, **k):
        raise RuntimeError("offline")

    mp.setattr(web, "parse_destination", boom)
    assert client.post("/api/destination", json={"text": "x"}, headers=H).status_code == 502
    assert sounds == ["huh", "error"]


def test_suggestion_lifecycle(env):
    client, state, *_ = env
    sid = state.add_suggestion("Sam", "12 Smith St", "https://www.google.com/maps")
    assert len(state.snapshot()["suggestions"]) == 1
    assert client.post(f"/api/suggestions/{sid}/dismissed", headers=H).status_code == 200
    assert state.snapshot()["suggestions"] == []
    assert client.post("/api/suggestions/999/opened", headers=H).status_code == 404


def test_suggestions_expire():
    state = State(suggestion_ttl=-1)
    state.add_suggestion("Sam", "x", "https://x")
    assert state.snapshot()["suggestions"] == []


def test_edit_and_delete_person(env):
    client, _, store, *_ = env
    assert client.patch("/api/people/Sam", json={"address": "9 New St"}, headers=H).status_code == 200
    assert store.snapshot()[0].address == "9 New St"
    assert client.patch("/api/people/Sam", json={"language": "fr"}, headers=H).status_code == 400
    assert client.delete("/api/people/Sam", headers=H).status_code == 200
    assert client.delete("/api/people/Sam", headers=H).status_code == 404


def test_add_person_needs_ready_model(env):
    client, *_ = env
    r = client.post("/api/people", data={"name": "Lee"}, headers=H)
    assert r.status_code == 503
