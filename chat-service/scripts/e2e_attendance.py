#!/usr/bin/env python
"""Atendimento completo ponta a ponta com modelos REAIS, medindo tokens e custo.

- Puxa UMA loja real + produtos (read-only) do banco pra ter prompt de tamanho
  realista (categorias/FAQ/instruções reais afetam o tamanho e o caching).
- Roda a conversa contra um banco EM MEMÓRIA (FakeDB) — NÃO escreve nada na
  produção (nenhum insert_message/create_lead real).
- Instrumenta cada chamada à OpenAI (modelo, prompt, cached, completion) e
  estima o custo desta conversa no setup NOVO (caching + nano) vs ANTIGO
  (mini em tudo, sem caching efetivo).

Uso: python -m scripts.e2e_attendance
"""
import asyncio
import sys

try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

import asyncpg
from app.config import settings
from app.llm import LLMClient
from app.db import Database
from app.models import Context
from app.agent.runner import run_agent
from app.branches.lead import run_lead
from app.branches.gap import run_gap
from app.usage import start_usage
from tests.conftest import FakeDB  # banco em memória, não toca produção

# Preços USD / 1M tokens (junho/2026, páginas oficiais OpenAI)
PRICES = {
    "gpt-5-mini": {"in": 0.25, "cached": 0.025, "out": 2.00},
    "gpt-5-nano": {"in": 0.05, "cached": 0.005, "out": 0.40},
    "text-embedding-3-small": {"in": 0.02, "cached": 0.02, "out": 0.0},
}

# A conversa simulada (varejo): saudação → categoria → filtro → intenção → dados
TURNS = [
    "oi, tudo bem?",
    "queria ver vestidos",
    "tem algum vermelho?",
    "amei esse, quero comprar! como faço?",
    "meu nome é Ana Beatriz, meu zap é (11) 98888-7777",
]


def cost_of(model, prompt, cached, completion):
    p = PRICES[model]
    uncached = max(prompt - cached, 0)
    return (uncached * p["in"] + cached * p["cached"] + completion * p["out"]) / 1e6


async def seed_from_real_store():
    """Lê 1 loja + produtos reais (somente SELECT) e devolve um FakeDB seedado."""
    conn = await asyncpg.connect(settings.database_url)
    try:
        # loja com mais produtos = prompt mais realista
        row = await conn.fetchrow(
            """SELECT user_id::text AS sid, count(*) AS n FROM products
               WHERE is_available = true GROUP BY user_id ORDER BY n DESC LIMIT 1""")
        store_id = row["sid"]
    finally:
        await conn.close()

    db_real = await Database.create(settings.database_url)
    try:
        store = await db_real.get_store_settings(store_id)
        prices = await db_real.get_product_prices(store_id)
        cat = store.categories[0] if store.categories else ""
        cat_products = await db_real.get_products_by_category(store_id, cat)
    finally:
        await db_real.close()

    fake = FakeDB()
    fake.store = store
    fake.product_prices = prices
    fake.category_products = [dict(p, category=cat, is_available=True) for p in cat_products[:8]]
    # alguns docs pra BUSCAR_PRODUTOS (semântica) — reaproveita produtos reais
    fake.match_results = [
        {"content": p["name"], "similarity": 0.6,
         "metadata": {"name": p["name"], "category": cat,
                      "price": p.get("price") or 0,
                      "tamanhos": p.get("tamanhos") or [], "cores": p.get("cores") or [],
                      "brand": p.get("brand"),
                      "image_url": (p.get("image_urls") or [None])[0]}}
        for p in cat_products[:5]]
    return store, fake, cat


def wrap_recording(llm):
    """Intercepta create() pra registrar modelo + usage por chamada."""
    records = []
    orig_chat = llm._client.chat.completions.create
    orig_embed = llm._client.embeddings.create

    async def chat_create(**kw):
        resp = await orig_chat(**kw)
        u = resp.usage
        det = getattr(u, "prompt_tokens_details", None)
        cached = (getattr(det, "cached_tokens", 0) or 0) if det else 0
        cdet = getattr(u, "completion_tokens_details", None)
        reasoning = (getattr(cdet, "reasoning_tokens", 0) or 0) if cdet else 0
        records.append({"kind": "chat", "model": kw["model"],
                        "tools": bool(kw.get("tools")),
                        "prompt": u.prompt_tokens, "cached": cached,
                        "completion": u.completion_tokens, "reasoning": reasoning})
        return resp

    async def embed_create(**kw):
        resp = await orig_embed(**kw)
        u = resp.usage
        records.append({"kind": "embed", "model": kw["model"],
                        "prompt": u.prompt_tokens, "cached": 0, "completion": 0})
        return resp

    llm._client.chat.completions.create = chat_create
    llm._client.embeddings.create = embed_create
    return records


async def main():
    if not settings.openai_api_key or not settings.database_url:
        sys.exit("Faltam OPENAI_API_KEY/DATABASE_URL no .env")

    store, db, cat = await seed_from_real_store()
    print(f"Loja real: {store.store_name!r} | categorias={len(store.categories)} "
          f"| FAQ={len(store.faq)} | 1ª categoria seedada={cat!r}\n")

    llm = LLMClient(api_key=settings.openai_api_key)
    records = wrap_recording(llm)

    history = []
    for i, user_text in enumerate(TURNS, 1):
        start_usage()
        lead = db.lead
        result = await run_agent(llm, db, store, db.shown_list, user_text, list(history),
                                 conversation_id="e2e-conv", lead=lead)
        # persiste no FakeDB (memória) o que o pipeline persistiria
        history.append({"role": "user", "content": user_text})
        for seg in result.product_segments:
            history.append({"role": "assistant", "content": seg})
        if result.text:
            history.append({"role": "assistant", "content": result.text})
        db.recent_messages = [{"role": m["role"], "content": m["content"]}
                              for m in reversed(history)]
        # na produção o lead persistido tem 'id'; o FakeDB em memória não põe um
        # quando o REGISTRAR_PEDIDO cria o registro — simula aqui.
        if db.lead is not None and "id" not in db.lead:
            db.lead["id"] = "e2e-lead"
        ctx = Context(store=store, conversation_id="e2e-conv",
                      chat_input=user_text, ai_output=result.text)
        await run_lead(db, llm, ctx)
        await run_gap(db, llm, ctx)
        reply = (result.text or "").replace("\n", " ")[:90]
        print(f"T{i} cliente: {user_text}")
        print(f"   IA: {reply}{' …' if result.text and len(result.text) > 90 else ''}\n")

    # ── agregação ────────────────────────────────────────────────────────────
    def agg(recs):
        a = {"prompt": 0, "cached": 0, "completion": 0, "calls": 0}
        for r in recs:
            a["prompt"] += r["prompt"]; a["cached"] += r["cached"]
            a["completion"] += r["completion"]; a["calls"] += 1
        return a

    # foreground = chamadas do run_agent (passam tools); lead = chat sem tools
    # no lead_model; background nano = gap + resumo de interesse.
    fg = [r for r in records if r["kind"] == "chat" and r["tools"]]
    nano = [r for r in records if r["kind"] == "chat" and r["model"] == settings.background_model]
    lead_calls = [r for r in records if r["kind"] == "chat" and not r["tools"]
                  and r["model"] == settings.lead_model]
    embeds = [r for r in records if r["kind"] == "embed"]

    print("================ TOKENS MEDIDOS (conversa de 5 turnos) ================")
    print(f"{'grupo':32} {'calls':>5} {'prompt':>8} {'cached':>8} {'compl':>7} {'(reason)':>8}")
    for name, recs in [(f"foreground agente ({settings.chat_model})", fg),
                       (f"lead extração ({settings.lead_model})", lead_calls),
                       (f"background nano ({settings.background_model})", nano),
                       ("embeddings", embeds)]:
        a = agg(recs)
        reason = sum(r.get("reasoning", 0) for r in recs)
        print(f"{name:32} {a['calls']:5} {a['prompt']:8} {a['cached']:8} "
              f"{a['completion']:7} {reason:8}")
    fg_a = agg(fg)
    hit = fg_a["cached"] / fg_a["prompt"] if fg_a["prompt"] else 0
    print(f"\nCache hit no foreground: {fg_a['cached']}/{fg_a['prompt']} "
          f"tokens de input = {hit:.1%}")

    # ── custo NOVO (medido) vs ANTIGO (contrafactual) ────────────────────────
    new_cost = sum(cost_of(r["model"], r["prompt"], r["cached"], r["completion"])
                   for r in records if r["kind"] == "chat")
    new_cost += sum(cost_of(r["model"], r["prompt"], 0, 0) for r in embeds)
    # ANTIGO: mini em TODO chat, sem caching (cached=0); embeddings iguais
    old_cost = sum(cost_of("gpt-5-mini", r["prompt"], 0, r["completion"])
                   for r in records if r["kind"] == "chat")
    old_cost += sum(cost_of(r["model"], r["prompt"], 0, 0) for r in embeds)

    print("\n================ CUSTO DESTA CONVERSA (USD) ================")
    print(f"ANTIGO (mini em tudo, sem cache):  ${old_cost:.6f}")
    print(f"NOVO   (cache + nano no fundo):    ${new_cost:.6f}")
    if old_cost:
        print(f"Economia: {(1 - new_cost/old_cost):.1%}")
    print(f"\nTotal de chamadas à OpenAI: {len(records)}")


if __name__ == "__main__":
    asyncio.run(main())
