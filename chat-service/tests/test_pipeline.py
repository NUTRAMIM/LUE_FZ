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


def test_strip_dashes_replaces_separators_keeps_numbers():
    f = pipeline_mod._strip_dashes
    assert f("esses dois — olha:") == "esses dois, olha:"
    assert f("esses dois - olha") == "esses dois, olha"
    assert f("texto‑aqui") == "texto, aqui"          # hífen não-quebrável (U+2011)
    # preserva hífen dentro de número/palavra (telefone, CEP, palavra composta)
    assert f("seu zap (11) 98888-7777") == "seu zap (11) 98888-7777"
    assert f("CEP 01310-100") == "CEP 01310-100"
    assert f("o carro-chefe dela") == "o carro-chefe dela"
    assert f("") == ""


async def test_pipeline_strips_dashes_from_reply(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "quero esse"}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [{"content": "Anotei, Ana — seu zap (11) 98888-7777 está certo"}]
    await process_message(db, llm, _payload(msg="quero esse", mid="msg-1"))
    assistant = [m for m in db.inserted_messages if m["role"] == "assistant"]
    assert assistant
    assert "—" not in assistant[0]["content"]
    assert "Anotei, Ana, seu zap (11) 98888-7777 está certo" == assistant[0]["content"]


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


async def test_logs_token_usage_summary(db, llm, store, caplog):
    db.store = store
    # mensagem com contato (telefone) E pergunta → dispara os 3 (agente+lead+gap)
    msg = "meu zap é 11999998888, vocês entregam em SP?"
    db.window_messages = [{"id": "msg-1", "content": msg}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [
        {"content": "achei isso pra você"},
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},
    ]
    with caplog.at_level("INFO", logger="chat-service"):
        await process_message(db, llm, _payload(msg=msg, mid="msg-1"))
    summary = [r for r in caplog.records if "total=42" in r.getMessage()]
    assert summary, "esperava log de resumo de tokens com total acumulado"
    assert "calls=3" in summary[0].getMessage()


async def test_gating_skips_background_for_plain_greeting(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "oi tudo bem"}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [{"content": "oi! como posso te ajudar?"}]  # só o agente
    await process_message(db, llm, _payload(msg="oi tudo bem", mid="msg-1"))
    # saudação sem contato e sem pergunta → lead e gap PULADOS (1 chamada só)
    assert len(llm.chat_calls) == 1
    assert db.created_leads == [] and db.updated_leads == []
    assert db.inserted_gaps == []


async def test_gating_runs_lead_when_phone_present(db, llm, store):
    db.store = store
    msg = "meu zap é 11999998888"
    db.window_messages = [{"id": "msg-1", "content": msg}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [
        {"content": "anotado!"},                                          # agente
        {"content": json.dumps({"nome": None, "telefone": "11999998888",  # extração lead
                                "email": None, "cep": None})},
        {"content": "cliente quer fechar pedido"},                        # resumo interesse
    ]
    await process_message(db, llm, _payload(msg=msg, mid="msg-1"))
    # contato presente → lead roda (extração + resumo de interesse); gap PULADO
    assert len(llm.chat_calls) == 3
    assert db.created_leads and db.created_leads[0]["whatsapp"] == "5511999998888"
    assert db.inserted_gaps == []   # sem pergunta → gap não rodou


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


async def test_category_dump_inserts_cards_then_closing(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "me mostra os conjuntos"}]
    db.recent_messages = []
    db.category_products = [
        {"id": "p1", "name": "Conjunto A", "category": "Conjuntos", "price": 99.9,
         "brand": None, "tamanhos": ["P"], "cores": ["preto"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
        {"id": "p2", "name": "Conjunto B", "category": "Conjuntos", "price": 79.9,
         "brand": None, "tamanhos": ["M"], "cores": ["branco"],
         "image_urls": ["http://img/p2.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": "LISTAR_CATEGORIA",
                         "arguments": json.dumps({"categoria": "Conjuntos"})}]},
        {"content": "Esses são nossos conjuntos! Quer ver algum?"},
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},
    ]
    await process_message(db, llm, _payload(mid="msg-1"))

    assistant_msgs = [m for m in db.inserted_messages if m["role"] == "assistant"]
    assert len(assistant_msgs) == 2
    assert "[produto]" in assistant_msgs[0]["content"]
    assert "Conjunto A" in assistant_msgs[0]["content"]
    assert "Conjunto B" in assistant_msgs[0]["content"]
    assert assistant_msgs[1]["content"] == "Esses são nossos conjuntos! Quer ver algum?"
    shown = [m for m in db.inserted_mentions if m["source"] == "ai_shown"]
    assert {m["product_id"] for m in shown} == {"p1", "p2"}


async def test_category_dump_skips_text_insert_when_empty(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "me mostra os conjuntos"}]
    db.recent_messages = []
    db.category_products = [
        {"id": "p1", "name": "Conjunto A", "category": "Conjuntos", "price": 99.9,
         "brand": None, "tamanhos": ["P"], "cores": ["preto"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": "LISTAR_CATEGORIA",
                         "arguments": json.dumps({"categoria": "Conjuntos"})}]},
        {"content": ""},
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},
    ]
    await process_message(db, llm, _payload(mid="msg-1"))
    assistant_msgs = [m for m in db.inserted_messages if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    assert "[produto]" in assistant_msgs[0]["content"]


async def test_pipeline_uses_history_limit_setting(db, llm, store, monkeypatch):
    monkeypatch.setattr(pipeline_mod.settings, "history_limit", 8)
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "oi tudo bem"}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [{"content": "oi! como posso ajudar?"}]
    await process_message(db, llm, _payload(msg="oi tudo bem", mid="msg-1"))
    assert db.recent_limit == 8


def test_compact_keeps_most_recent_dump_and_compacts_older():
    # cronológico (antiga→recente): o ÚLTIMO card é o mais recente (mantém);
    # o 1º card é o antigo (compacta)
    history = [
        {"role": "user", "content": "me mostra os conjuntos"},
        {"role": "assistant", "content": "[produto]\nConj A\nR$ 99\n[/produto]\n[produto]\nConj B\nR$ 89\n[/produto]"},
        {"role": "user", "content": "e os tops?"},
        {"role": "assistant", "content": "[produto]\nTop X\nR$ 40\n[/produto]"},
    ]
    out = pipeline_mod._compact_shown_cards(history)
    assert "[produto]" not in out[1]["content"]   # despejo antigo compactado
    assert "2" in out[1]["content"]               # com a contagem
    assert "[produto]" in out[3]["content"] and "Top X" in out[3]["content"]  # recente intacto
    assert out[0]["content"] == "me mostra os conjuntos"
    assert out[2]["content"] == "e os tops?"


def test_compact_single_dump_is_left_intact():
    history = [
        {"role": "user", "content": "oi"},
        {"role": "assistant", "content": "[produto]\nTop X\nR$ 40\n[/produto]"},
    ]
    out = pipeline_mod._compact_shown_cards(history)
    assert out[1]["content"].count("[produto]") == 1


def test_compact_no_cards_is_noop():
    history = [{"role": "user", "content": "oi"},
               {"role": "assistant", "content": "oi! tudo bem?"}]
    assert pipeline_mod._compact_shown_cards(history) == history


async def test_pipeline_compacts_old_cards_before_sending_to_agent(db, llm, store):
    # "quero esse" não dispara gap nem lead (gating) → 1 chamada foreground só.
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "quero esse"}]
    db.catalog = []
    # recente-primeiro (como get_recent_messages devolve, DESC): recente=Short, antigo=Conj
    db.recent_messages = [
        {"role": "assistant", "content": "[produto]\nShort A\nR$ 50\n[/produto]"},
        {"role": "user", "content": "me mostra os shorts"},
        {"role": "assistant", "content": "[produto]\nConj A\nR$ 99\n[/produto]\n[produto]\nConj B\nR$ 89\n[/produto]"},
        {"role": "user", "content": "me mostra os conjuntos"},
    ]
    llm.chat_responses = [{"content": "fechou!"}]
    await process_message(db, llm, _payload(msg="quero esse", mid="msg-1"))

    sent = llm.chat_calls[0]["messages"]
    blob = "\n".join(m["content"] for m in sent)
    assert "Conj A" not in blob and "Conj B" not in blob   # despejo antigo compactado
    assert "Short A" in blob                                 # despejo recente intacto


async def test_lead_state_reaches_agent_prompt(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "oi"}]
    db.catalog = []
    db.recent_messages = []
    db.lead = {"id": "lead-1", "name": "Joana", "whatsapp": "55", "email": None,
               "cep": None, "pedido": [{"produto": "Cropped", "qtd": 1}],
               "forma_pagamento": "Pix", "forma_entrega": None}
    llm.chat_responses = [
        {"content": "oi Joana!"},
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},
    ]
    await process_message(db, llm, _payload(mid="msg-1"))
    # estado do lead/pedido vai nos blocos de sistema (dinâmico + lembrete),
    # não necessariamente na 1ª mensagem (que é o prefixo estático cacheável).
    system_blob = "\n".join(m["content"] for m in llm.chat_calls[0]["messages"]
                            if m["role"] == "system")
    assert "Joana" in system_blob
    assert "1x Cropped" in system_blob
    assert "Pix" in system_blob
