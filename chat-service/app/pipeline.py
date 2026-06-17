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
                        "content": f'[{n} peça(s) mostrada(s) ao cliente, nomes no bloco "Já mostrado"]'})
        else:
            out.append(m)
    return out


_DASH_SEP_RE = re.compile(r"\s*[‐-―−]\s*|\s+-\s+")


def _strip_dashes(text: str) -> str:
    """Tira travessão/hífen usado como SEPARADOR da fala enviada ao cliente
    (a loja não quer '-' nem '—' ligando frases). Troca por vírgula. Preserva
    hífen colado dentro de número/palavra (telefone, CEP, carro-chefe)."""
    if not text:
        return text
    return _DASH_SEP_RE.sub(", ", text)


# Rede de segurança: às vezes o modelo escreve uma chamada de ferramenta como
# TEXTO (ex.: ao esgotar os rounds, a chamada final é sem tools). O cliente nunca
# pode ver isso. Remove linhas que são claramente JSON de tool-call.
_TOOL_LEAK_RE = re.compile(
    r'^\s*\{.*"(?:categoria|consulta|category|itens|forma_pagamento|forma_entrega)".*\}\s*$',
    re.MULTILINE)


def _strip_tool_leak(text: str) -> str:
    if not text:
        return text
    cleaned = _TOOL_LEAK_RE.sub("", text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


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
    # diagnóstico: confirma se as categorias da loja chegam ao agente (sem elas o
    # modelo "chuta" categorias e toda busca volta vazia)
    log.info("store=%s categorias(%d)=%s", store.id, len(store.categories),
             store.categories)

    shown_list, shown_ids, history, lead = await asyncio.gather(
        db.get_shown_products(payload.id_conversa),
        db.get_shown_product_ids(payload.id_conversa),
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
            conversation_id=payload.id_conversa, lead=lead, shown_ids=shown_ids)
    except Exception:
        log.exception("agent failed; inserting instability fallback")
        await db.insert_message(payload.id_conversa, "system", INSTABILITY_MSG)
        return

    for segmento in result.product_segments:
        await db.insert_message(payload.id_conversa, "assistant", segmento)
    for product_id in result.shown_product_ids:
        # registrar a menção nunca pode derrubar a resposta ao cliente: um id
        # inesperado (ex.: não-UUID) é logado e ignorado, não propaga.
        try:
            await db.insert_product_mention(
                store.id, payload.id_conversa, product_id, "ai_shown")
        except Exception:
            log.warning("falha ao gravar product_mention %r (ignorada)", product_id)
    reply_text = _strip_dashes(_strip_tool_leak(result.text))   # sem JSON de tool nem hífen-separador
    if reply_text:
        await db.insert_message(payload.id_conversa, "assistant", reply_text)

    ctx = Context(store=store, conversation_id=payload.id_conversa,
                  chat_input=buf.chat_input, ai_output=reply_text)
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
