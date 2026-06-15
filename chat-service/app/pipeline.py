# app/pipeline.py
import asyncio
import logging
import re
from app.buffer import resolve_window
from app.agent.runner import run_agent
from app.branches.lead import run_lead, should_extract_lead
from app.branches.gap import run_gap, looks_like_question
from app.branches.mentions import run_mentions
from app.models import Context
from app.config import settings
from app.usage import start_usage

log = logging.getLogger("chat-service")

INSTABILITY_MSG = "Estamos com instabilidade. Sua mensagem foi recebida."


def _compact_shown_cards(history_msgs: list[dict]) -> list[dict]:
    """Troca os cards de produto ANTIGOS do histórico por uma referência curta,
    pra não reenviar o markup completo a cada turno (atacado despeja ~metade do
    estoque). Mantém o despejo MAIS RECENTE intacto (follow-up imediato precisa
    do detalhe). Os nomes de tudo mostrado já vão no bloco 'Já mostrado'.
    `history_msgs` chega CRONOLÓGICO (antiga→recente), então o ÚLTIMO card é o
    mais recente."""
    card_idxs = [i for i, m in enumerate(history_msgs)
                 if m["role"] == "assistant" and "[produto]" in m["content"]]
    keep = card_idxs[-1] if card_idxs else None   # último despejo = mais recente
    out = []
    for i, m in enumerate(history_msgs):
        if i in card_idxs and i != keep:
            n = m["content"].count("[produto]")
            out.append({"role": m["role"],
                        "content": f'[{n} peça(s) mostrada(s) ao cliente — nomes no bloco "Já mostrado"]'})
        else:
            out.append(m)
    return out


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
        db.get_recent_messages(payload.id_conversa, limit=settings.history_limit),
        db.get_lead(payload.id_conversa, store.id),
    )
    # get_recent_messages vem recente-primeiro (ORDER BY created_at DESC, pra
    # aplicar o LIMIT). O agente/OpenAI precisam do histórico em ordem
    # CRONOLÓGICA (antiga→recente), senão a conversa chega invertida ao modelo.
    history_msgs = _compact_shown_cards(
        [{"role": m["role"], "content": m["content"]} for m in reversed(history)])

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
    # Gating dos branches de fundo: lead e gap rodavam em TODA mensagem (2-3
    # chamadas LLM por resposta). Aqui só agendamos quando há sinal — pula a
    # chamada (e o prompt) em saudação/elogio/sem dado de contato.
    tasks = []
    if should_extract_lead(buf.chat_input, history_msgs):
        tasks.append(run_lead(db, llm, ctx))
    if looks_like_question(buf.chat_input):
        tasks.append(run_gap(db, llm, ctx))
    tasks.append(run_mentions(db, ctx))
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            log.error("branch failed: %r", r)

    log.info("usage da conversa %s: prompt=%d (cached=%d) completion=%d total=%d calls=%d",
             payload.id_conversa, usage.prompt, usage.cached, usage.completion,
             usage.total, usage.calls)
    if usage.calls > 0:
        try:
            for model, m in usage.by_model.items():
                await db.record_daily_usage(
                    store.id, model, m["prompt"], m["completion"],
                    m["total"], m["cached"], m["calls"])
        except Exception:
            log.exception("falha ao gravar ai_usage_daily (ignorada)")
