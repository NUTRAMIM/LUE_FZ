# app/pipeline.py
import asyncio
import logging
from app.buffer import resolve_window
from app.agent.runner import run_agent
from app.branches.lead import run_lead
from app.branches.gap import run_gap
from app.branches.mentions import run_mentions
from app.models import Context
from app.config import settings
from app.usage import start_usage

log = logging.getLogger("chat-service")

INSTABILITY_MSG = "Estamos com instabilidade. Sua mensagem foi recebida."


def with_reply_context(chat_input, respondendo_a):
    if respondendo_a is None:
        return chat_input
    origem = "da loja" if respondendo_a.autor == "loja" else "do cliente"
    quote = respondendo_a.conteudo.strip()
    return (f'[O cliente está respondendo a esta mensagem anterior {origem}: '
            f'"{quote}"]\n{chat_input}')


async def process_message(db, llm, payload) -> None:
    usage = start_usage()
    await asyncio.sleep(settings.buffer_wait_seconds)
    buf = await resolve_window(
        db, payload.id_conversa, payload.id_mensagem, payload.mensagem)
    if not buf.should_process:
        return

    store = await db.get_store_settings(payload.id_loja)
    if store is None:
        log.error("store not found: %s", payload.id_loja)
        return

    shown_list, history, lead = await asyncio.gather(
        db.get_shown_products(payload.id_conversa),
        db.get_recent_messages(payload.id_conversa, limit=10),
        db.get_lead(payload.id_conversa, store.id),
    )
    history_msgs = [{"role": m["role"], "content": m["content"]} for m in history]

    agent_input = with_reply_context(buf.chat_input, payload.respondendo_a)
    try:
        result = await run_agent(
            llm, db, store, shown_list, agent_input, history_msgs,
            conversation_id=payload.id_conversa, lead=lead)
    except Exception:
        log.exception("agent failed; inserting instability fallback")
        await db.insert_message(payload.id_conversa, "system", INSTABILITY_MSG)
        return

    for segmento in result.product_segments:
        await db.insert_message(payload.id_conversa, "assistant", segmento)
    for product_id in result.shown_product_ids:
        await db.insert_product_mention(
            store.id, payload.id_conversa, product_id, "ai_shown")
    if result.text:
        await db.insert_message(payload.id_conversa, "assistant", result.text)

    ctx = Context(store=store, conversation_id=payload.id_conversa,
                  chat_input=buf.chat_input, ai_output=result.text)
    results = await asyncio.gather(
        run_lead(db, llm, ctx),
        run_gap(db, llm, ctx),
        run_mentions(db, ctx),
        return_exceptions=True,
    )
    for r in results:
        if isinstance(r, Exception):
            log.error("branch failed: %r", r)

    log.info("usage da conversa %s: prompt=%d completion=%d total=%d calls=%d",
             payload.id_conversa, usage.prompt, usage.completion,
             usage.total, usage.calls)
