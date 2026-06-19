#!/usr/bin/env python
"""A/B de qualidade do agente FOREGROUND sob diferentes reasoning_effort.

O agente gasta ~8k reasoning tokens/conversa (cobrados como output a $2/1M) —
de longe o maior custo restante depois do caching+tiering. reasoning_effort
"low"/"minimal" cortam isso, MAS podem degradar tool-calling e redação. Este
script roda a MESMA conversa sob cada effort e mostra, lado a lado: custo,
reasoning tokens, se o lead foi capturado, e as respostas — pra decidir com
dados (e NÃO mudar o default antes de aprovar).

Uso: python -m scripts.ab_foreground_effort
"""
import asyncio
import sys

from app.config import settings
from app.llm import LLMClient
from app.models import Context
from app.agent.runner import run_agent
from app.branches.lead import run_lead
from app.branches.gap import run_gap
from app.usage import start_usage
from scripts.e2e_attendance import (
    seed_from_real_store, wrap_recording, cost_of, TURNS)

EFFORTS = [None, "low", "minimal"]


async def run_conversation(effort):
    settings.foreground_reasoning_effort = effort
    _, db, _ = await seed_from_real_store()
    llm = LLMClient(api_key=settings.openai_api_key)
    records = wrap_recording(llm)

    history, replies = [], []
    for user_text in TURNS:
        start_usage()
        result = await run_agent(llm, db, store_of(db), db.shown_list, user_text,
                                 list(history), conversation_id="ab", lead=db.lead)
        history.append({"role": "user", "content": user_text})
        for seg in result.product_segments:
            history.append({"role": "assistant", "content": seg})
        if result.text:
            history.append({"role": "assistant", "content": result.text})
        db.recent_messages = [{"role": m["role"], "content": m["content"]}
                              for m in reversed(history)]
        if db.lead is not None and "id" not in db.lead:
            db.lead["id"] = "ab-lead"
        ctx = Context(store=store_of(db), conversation_id="ab",
                      chat_input=user_text, ai_output=result.text)
        await run_lead(db, llm, ctx)
        await run_gap(db, llm, ctx)
        replies.append((result.text or "").replace("\n", " ").strip())

    # lead capturado? procura name+whatsapp nos create/update do FakeDB
    leads = db.created_leads + [dict(l) for l in db.updated_leads]
    got_name = any((l.get("name") or "").strip() for l in leads)
    got_phone = any((l.get("whatsapp") or "").strip() for l in leads)

    fg = [r for r in records if r["kind"] == "chat" and r["tools"]]
    reasoning = sum(r.get("reasoning", 0) for r in fg)
    cost = sum(cost_of(r["model"], r["prompt"], r["cached"], r["completion"])
               for r in records if r["kind"] == "chat")
    return {"effort": effort, "fg_calls": len(fg), "reasoning": reasoning,
            "cost": cost, "got_name": got_name, "got_phone": got_phone,
            "replies": replies}


def store_of(db):
    return db.store


async def main():
    if not settings.openai_api_key or not settings.database_url:
        sys.exit("Faltam OPENAI_API_KEY/DATABASE_URL no .env")

    results = []
    for effort in EFFORTS:
        print(f"... rodando foreground reasoning_effort={effort!r}")
        results.append(await run_conversation(effort))

    print("\n================ A/B FOREGROUND reasoning_effort ================")
    print(f"{'effort':10} {'fg_calls':>8} {'reasoning':>10} {'custo$':>10} "
          f"{'nome?':>6} {'tel?':>5}")
    base = next(r for r in results if r["effort"] is None)
    for r in results:
        save = (1 - r["cost"] / base["cost"]) if base["cost"] else 0
        print(f"{str(r['effort']):10} {r['fg_calls']:8} {r['reasoning']:10} "
              f"{r['cost']:10.6f} {('SIM' if r['got_name'] else 'NÃO'):>6} "
              f"{('SIM' if r['got_phone'] else 'NÃO'):>5}   ({save:+.0%} vs default)")

    print("\n================ RESPOSTAS POR EFFORT (inspeção de qualidade) ===========")
    for r in results:
        print(f"\n--- effort={r['effort']!r} | lead nome={r['got_name']} tel={r['got_phone']} ---")
        for i, (u, a) in enumerate(zip(TURNS, r["replies"]), 1):
            print(f"  T{i} cliente: {u}")
            print(f"     IA: {a[:120]}{'…' if len(a) > 120 else ''}")

    print("\nRegra: só baixar o effort se NÃO degradar captura de lead (nome+tel) "
          "nem a qualidade das respostas/tool-calling. Rode algumas vezes (saída "
          "do modelo varia).")


if __name__ == "__main__":
    asyncio.run(main())
