# tests/test_pipeline.py
import json
import asyncio
import pytest
import app.pipeline as pipeline_mod
from app.pipeline import process_message, with_reply_context
from app.models import WebhookPayload, RespondendoA
from app.config import settings


@pytest.fixture(autouse=True)
def fast_buffer_wait(monkeypatch):
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(pipeline_mod.asyncio, "sleep", fake_sleep)
    return slept


def _payload(msg="quero um top", mid="msg-1", conv="conv-1", respondendo_a=None):
    return WebhookPayload(mensagem=msg, id_mensagem=mid, id_conversa=conv,
                          nome_loja="LUE", id_loja="store-1", tipo_de_mensagem="text",
                          respondendo_a=respondendo_a)


def test_with_reply_context_none_returns_unchanged():
    assert with_reply_context("oi", None) == "oi"


def test_with_reply_context_loja_includes_quote_and_message():
    out = with_reply_context(
        "quero esse",
        RespondendoA(id_mensagem="m1", autor="loja", conteudo="Top Alça R$ 50"),
    )
    assert "Top Alça R$ 50" in out
    assert "quero esse" in out
    assert "loja" in out.lower()


def test_with_reply_context_cliente_marks_origin():
    out = with_reply_context(
        "isso mesmo",
        RespondendoA(id_mensagem="m2", autor="cliente", conteudo="quero azul"),
    )
    assert "quero azul" in out
    assert "cliente" in out.lower()


async def test_reply_context_reaches_agent(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "quero esse"}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [
        {"content": "claro!"},
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},
    ]
    ra = RespondendoA(id_mensagem="m1", autor="loja", conteudo="Top Alça R$ 50")
    await process_message(db, llm, _payload(mid="msg-1", respondendo_a=ra))
    first_call = llm.chat_calls[0]
    user_msgs = [m for m in first_call["messages"] if m["role"] == "user"]
    assert any("Top Alça R$ 50" in m["content"] for m in user_msgs)


async def test_aborts_when_not_latest(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "a"}, {"id": "msg-2", "content": "b"}]
    await process_message(db, llm, _payload(mid="msg-1"))
    assert db.inserted_messages == []   # abortou no buffer


async def test_happy_path_inserts_assistant_and_runs_branches(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "quero um top"}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [
        {"content": "achei isso pra você"},                       # agente principal
        {"content": json.dumps({"nome": None, "telefone": None,   # lead analyzer (sem dado)
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},  # gap
    ]
    await process_message(db, llm, _payload(mid="msg-1"))
    assert db.inserted_messages[0]["role"] == "assistant"
    assert db.inserted_messages[0]["content"] == "achei isso pra você"


async def test_agent_failure_inserts_instability_system_message(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "oi"}]

    async def boom(*a, **k):
        raise RuntimeError("openai down")
    llm.chat = boom

    await process_message(db, llm, _payload(mid="msg-1"))
    assert db.inserted_messages[0]["role"] == "system"
    assert "instabilidade" in db.inserted_messages[0]["content"].lower()


async def test_waits_buffer_window_before_processing(db, llm, store, fast_buffer_wait):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "oi"}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [{"content": "oi!"}]
    await process_message(db, llm, _payload(mid="msg-1"))
    assert settings.buffer_wait_seconds in fast_buffer_wait
