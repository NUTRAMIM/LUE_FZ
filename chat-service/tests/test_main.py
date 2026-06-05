# tests/test_main.py
from fastapi.testclient import TestClient
import app.main as main_mod


def test_valid_payload_returns_202(monkeypatch):
    captured = {}

    def fake_schedule(payload):
        captured["payload"] = payload

    monkeypatch.setattr(main_mod, "schedule_processing", fake_schedule)
    client = TestClient(main_mod.app)
    resp = client.post("/chat", json={
        "mensagem": "oi", "id_mensagem": "m1", "id_conversa": "c1",
        "nome_loja": "LUE", "id_loja": "s1", "tipo_de_mensagem": "text"})
    assert resp.status_code == 202
    assert captured["payload"].mensagem == "oi"


def test_invalid_payload_returns_422_and_no_schedule(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(main_mod, "schedule_processing", lambda p: called.__setitem__("n", 1))
    client = TestClient(main_mod.app)
    resp = client.post("/chat", json={"id_conversa": "c1"})  # falta campos
    assert resp.status_code == 422
    assert called["n"] == 0


_VALID_BODY = {
    "mensagem": "oi", "id_mensagem": "m1", "id_conversa": "c1",
    "nome_loja": "LUE", "id_loja": "s1", "tipo_de_mensagem": "text",
}


def test_secret_configured_rejects_missing_header(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(main_mod, "schedule_processing", lambda p: called.__setitem__("n", 1))
    monkeypatch.setattr(main_mod.settings, "webhook_secret", "topsecret")
    client = TestClient(main_mod.app)
    resp = client.post("/chat", json=_VALID_BODY)
    assert resp.status_code == 401
    assert called["n"] == 0


def test_secret_configured_rejects_wrong_header(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(main_mod, "schedule_processing", lambda p: called.__setitem__("n", 1))
    monkeypatch.setattr(main_mod.settings, "webhook_secret", "topsecret")
    client = TestClient(main_mod.app)
    resp = client.post("/chat", json=_VALID_BODY, headers={"X-Webhook-Secret": "wrong"})
    assert resp.status_code == 401
    assert called["n"] == 0


def test_secret_configured_accepts_correct_header(monkeypatch):
    monkeypatch.setattr(main_mod, "schedule_processing", lambda p: None)
    monkeypatch.setattr(main_mod.settings, "webhook_secret", "topsecret")
    client = TestClient(main_mod.app)
    resp = client.post("/chat", json=_VALID_BODY, headers={"X-Webhook-Secret": "topsecret"})
    assert resp.status_code == 202
