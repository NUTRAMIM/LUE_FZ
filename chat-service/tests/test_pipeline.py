# tests/test_pipeline.py
import json
from app.pipeline import process_message
from app.models import WebhookPayload


def _payload(msg="quero um top", mid="msg-1", conv="conv-1"):
    return WebhookPayload(mensagem=msg, id_mensagem=mid, id_conversa=conv,
                          nome_loja="LUE", id_loja="store-1", tipo_de_mensagem="text")


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
