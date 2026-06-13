#!/usr/bin/env python
"""A/B AMPLO do reasoning_effort do agente foreground.

Vai além de 1 conversa: roda VÁRIOS cenários (listar categoria, busca com filtro,
item fora de catálogo, compra direta) x efforts (None/low/minimal) x repetições
(o output do modelo varia), e mede automaticamente o que importa pra qualidade:

  - cards: o agente surfou produto(s) quando o cliente pediu? (shown_product_ids)
  - lead:  capturou nome E telefone quando o cliente deu?
  - order: registrou o pedido quando o cliente quis comprar?

…além de custo/conversa e reasoning tokens. Tudo aterrado nas categorias REAIS
da loja (com estoque). NÃO escreve em produção (FakeDB em memória).

Uso:
  python -m scripts.ab_foreground_broad                     # defaults
  python -m scripts.ab_foreground_broad --repeats 3 --efforts none,low
"""
import argparse
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
from tests.conftest import FakeDB
from scripts.e2e_attendance import wrap_recording, cost_of


async def fetch_seed(n_categories=4, per_cat=6):
    """Lê 1 loja real + produtos de várias categorias (somente SELECT)."""
    conn = await asyncpg.connect(settings.database_url)
    try:
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
        by_cat = {}
        for cat in store.categories:
            prods = await db_real.get_products_by_category(store_id, cat)
            if prods:
                by_cat[cat] = prods[:per_cat]
            if len(by_cat) >= n_categories:
                break
    finally:
        await db_real.close()
    if not by_cat:
        sys.exit("Loja sem categorias com estoque — não dá pra avaliar cards.")
    return store, prices, by_cat


def make_db(store, prices, by_cat):
    """FakeDB fresco seedado com TODAS as categorias coletadas."""
    db = FakeDB()
    db.store = store
    db.product_prices = prices
    cat_products, match_results = [], []
    for cat, prods in by_cat.items():
        for p in prods:
            cat_products.append(dict(p, category=cat, is_available=True))
            match_results.append({
                "content": p["name"], "similarity": 0.6,
                "metadata": {"name": p["name"], "category": cat,
                             "price": p.get("price") or 0,
                             "tamanhos": p.get("tamanhos") or [],
                             "cores": p.get("cores") or [],
                             "brand": p.get("brand"),
                             "image_url": (p.get("image_urls") or [None])[0]}})
    db.category_products = cat_products
    db.match_results = match_results
    return db


def build_scenarios(cats):
    """Cenários aterrados nas categorias reais. 'expect' = comportamentos
    esperados ({cards, lead, order})."""
    c0 = cats[0]
    c1 = cats[1] if len(cats) > 1 else cats[0]
    return [
        {"name": f"listar {c0}", "expect": {"cards", "lead"}, "turns": [
            "oi, tudo bem?",
            f"me mostra os {c0}",
            "tem algum vermelho?",
            "amei esse, quero comprar! como faço?",
            "meu nome é Ana Beatriz, meu zap é (11) 98888-7777"]},
        {"name": f"busca filtrada {c1}", "expect": {"cards", "lead", "order"}, "turns": [
            "oi tudo bem?",
            f"você tem {c1} na cor preta?",
            "qual o preço e os tamanhos?",
            "perfeito, quero esse tamanho M, pode reservar",
            "sou a Bia, meu whats é 11977776666, pago no pix"]},
        {"name": "fora de catálogo (honestidade)", "expect": {"lead"}, "turns": [
            "oi",
            "vocês têm vestido de noiva?",
            "e maiô de praia?",
            "tá, então me mostra o que vocês têm de melhor",
            "fechou, sou a Carla, meu número é 11955554444"]},
        {"name": f"compra direta {c0}", "expect": {"cards", "lead", "order"}, "turns": [
            "quero comprar uma peça de vocês",
            f"queria ver {c0}",
            "tem tamanho M?",
            "perfeito, quero esse, como faço pra pagar?",
            "meu nome é João Silva, zap 11944443333, prefiro pix"]},
    ]


async def run_one(effort, scenario, store, prices, by_cat):
    settings.foreground_reasoning_effort = effort
    db = make_db(store, prices, by_cat)
    llm = LLMClient(api_key=settings.openai_api_key)
    records = wrap_recording(llm)

    history = []
    cards_total = 0
    for user_text in scenario["turns"]:
        start_usage()
        result = await run_agent(llm, db, store, db.shown_list, user_text,
                                 list(history), conversation_id="abb", lead=db.lead)
        cards_total += len(result.shown_product_ids)
        history.append({"role": "user", "content": user_text})
        for seg in result.product_segments:
            history.append({"role": "assistant", "content": seg})
        if result.text:
            history.append({"role": "assistant", "content": result.text})
        db.recent_messages = [{"role": m["role"], "content": m["content"]}
                              for m in reversed(history)]
        if db.lead is not None and "id" not in db.lead:
            db.lead["id"] = "abb-lead"
        ctx = Context(store=store, conversation_id="abb",
                      chat_input=user_text, ai_output=result.text)
        await run_lead(db, llm, ctx)
        await run_gap(db, llm, ctx)

    leads = db.created_leads + [dict(l) for l in db.updated_leads]
    got_name = any((l.get("name") or "").strip() for l in leads)
    got_phone = any((l.get("whatsapp") or "").strip() for l in leads)
    met = {
        "cards": cards_total > 0,
        "lead": got_name and got_phone,
        "order": bool(db.order_upserts),
    }
    reasoning = sum(r.get("reasoning", 0) for r in records
                    if r["kind"] == "chat" and r["tools"])
    cost = sum(cost_of(r["model"], r["prompt"], r["cached"], r["completion"])
               for r in records if r["kind"] == "chat")
    return {"met": met, "cards": cards_total, "reasoning": reasoning, "cost": cost}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--efforts", default="none,low,minimal")
    ap.add_argument("--repeats", type=int, default=2)
    args = ap.parse_args()
    if not settings.openai_api_key or not settings.database_url:
        sys.exit("Faltam OPENAI_API_KEY/DATABASE_URL no .env")

    efforts = [None if e.strip().lower() == "none" else e.strip()
               for e in args.efforts.split(",")]

    store, prices, by_cat = await fetch_seed()
    cats = list(by_cat.keys())
    scenarios = build_scenarios(cats)
    total = len(efforts) * len(scenarios) * args.repeats
    print(f"Loja {store.store_name!r} | categorias c/ estoque seedadas={cats} | "
          f"atacado={store.min_order_enabled}")
    print(f"{len(scenarios)} cenários x {len(efforts)} efforts x {args.repeats} reps "
          f"= {total} conversas\n")

    # agrega por effort
    agg = {str(e): {"runs": 0, "cost": 0.0, "reasoning": 0, "cards": 0,
                    "exp": {"cards": 0, "lead": 0, "order": 0},
                    "met": {"cards": 0, "lead": 0, "order": 0}} for e in efforts}

    done = 0
    skipped = 0
    for effort in efforts:
        for sc in scenarios:
            for _ in range(args.repeats):
                done += 1
                # resiliente a blip de rede (getaddrinfo/Connection): tenta a
                # conversa até 3x; se ainda falhar, PULA (não derruba o batch).
                r = None
                for attempt in range(3):
                    try:
                        r = await run_one(effort, sc, store, prices, by_cat)
                        break
                    except Exception as e:
                        if attempt == 2:
                            print(f"  [{done}/{total}] effort={str(effort):8} "
                                  f"{sc['name']:28} PULADA ({type(e).__name__})")
                        else:
                            await asyncio.sleep(3 * (attempt + 1))
                if r is None:
                    skipped += 1
                    continue
                a = agg[str(effort)]
                a["runs"] += 1
                a["cost"] += r["cost"]; a["reasoning"] += r["reasoning"]
                a["cards"] += r["cards"]
                for k in ("cards", "lead", "order"):
                    if k in sc["expect"]:
                        a["exp"][k] += 1
                        if r["met"][k]:
                            a["met"][k] += 1
                print(f"  [{done}/{total}] effort={str(effort):8} {sc['name']:28} "
                      f"cards={r['cards']} lead={r['met']['lead']} order={r['met']['order']}")
    if skipped:
        print(f"\n(atenção: {skipped} conversa(s) puladas por erro de rede)")

    def pct(n, d):
        return f"{n/d:.0%}" if d else "n/a"

    print("\n================ RESULTADO AMPLO POR EFFORT ================")
    base = agg[str(efforts[0])]
    hdr = (f"{'effort':9} {'cards✓':>8} {'lead✓':>8} {'order✓':>8} "
           f"{'reason/conv':>12} {'$/conv':>9} {'vs base':>9}")
    print(hdr)
    for e in efforts:
        a = agg[str(e)]
        n = a["runs"]
        cards_r = pct(a["met"]["cards"], a["exp"]["cards"])
        lead_r = pct(a["met"]["lead"], a["exp"]["lead"])
        order_r = pct(a["met"]["order"], a["exp"]["order"])
        cpc = a["cost"] / n if n else 0
        rpc = a["reasoning"] // n if n else 0
        base_cpc = base["cost"] / base["runs"] if base["runs"] else 0
        save = f"{(1 - cpc/base_cpc):+.0%}" if base_cpc else "—"
        print(f"{str(e):9} {cards_r:>8} {lead_r:>8} {order_r:>8} "
              f"{rpc:>12} {cpc:>9.5f} {save:>9}")

    print("\nLegenda: cards✓/lead✓/order✓ = % das conversas (onde era esperado) em que "
          "o agente surfou produto / capturou lead / registrou pedido.")
    print("Regra de promoção: o effort menor SÓ entra se cards✓ e lead✓ ficarem "
          "lado a lado com o default (None). Queda em cards✓ = perda de venda.")


if __name__ == "__main__":
    asyncio.run(main())
