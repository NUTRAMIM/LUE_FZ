# tests/test_history_order.py
# Investigação: a ordem do histórico chega cronológica ao modelo?
from app.pipeline import process_message
from app.models import WebhookPayload


def _payload(msg="agora", mid="msg-9", conv="conv-1"):
    return WebhookPayload(mensagem=msg, id_mensagem=mid, id_conversa=conv,
                          nome_loja="LUE", id_loja="store-1", tipo_de_mensagem="text",
                          respondendo_a=None)


async def test_history_reaches_model_in_chronological_order(db, llm, store, monkeypatch):
    import app.pipeline as pm

    async def _no_sleep(_):
        return None
    monkeypatch.setattr(pm.asyncio, "sleep", _no_sleep)

    db.store = store
    db.window_messages = [{"id": "msg-9", "content": "agora"}]
    db.catalog = []
    db.shown_list = ""
    # Exatamente o que get_recent_messages devolve em produção: DESC (recente-primeiro)
    db.recent_messages = [
        {"role": "assistant", "content": "R2"},   # mais recente
        {"role": "user", "content": "U2"},
        {"role": "assistant", "content": "R1"},
        {"role": "user", "content": "U1"},         # mais antiga
    ]
    llm.chat_responses = [{"content": "ok"}]

    await process_message(db, llm, _payload())

    msgs = llm.chat_calls[0]["messages"]
    convo = [m["content"] for m in msgs if m["content"] in ("U1", "U2", "R1", "R2")]
    print("\nORDEM QUE CHEGA AO MODELO:", convo)
    # Cronológico correto: U1 -> R1 -> U2 -> R2
    assert convo == ["U1", "R1", "U2", "R2"], f"fora de ordem cronologica: {convo}"
