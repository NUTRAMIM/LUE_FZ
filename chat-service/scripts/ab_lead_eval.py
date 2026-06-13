#!/usr/bin/env python
"""A/B de extração de lead: compara o modelo de referência (gpt-5-mini) contra
candidatos mais baratos (ex.: gpt-5-nano) ANTES de promover o nano em produção.

Por que existe: a extração de lead (nome/telefone) é o coração do SaaS e já
regrediu com modelo mais fraco. Os testes unitários usam FakeLLM, então NÃO
medem qualidade de modelo real — este script mede.

Estratégia: o gpt-5-mini é tratado como referência (gabarito proxy, já que é o
modelo de produção confiável). Para cada mensagem real de cliente, extraímos com
mini e com cada candidato, normalizamos com o MESMO _parse_lead/_normalize_numbers
de produção e comparamos. O número que importa é o RECALL relativo de telefone e
nome: o candidato NÃO pode perder um telefone/nome que o mini capturou.

Critério de aceite sugerido para promover nano:
  - recall_telefone(nano vs mini) >= ~0.98  (não perder lead)
  - recall_nome(nano vs mini)      >= ~0.95
  - sem aumento relevante de falsos positivos (precisão)

Fontes de mensagens:
  - Banco (default): amostra `messages.role='user'` via DATABASE_URL.
  - Arquivo: --input messages.json  (lista de strings, ou de {"text","atacado"}).

Uso:
  python -m scripts.ab_lead_eval --limit 200 --models gpt-5-mini,gpt-5-nano
  python -m scripts.ab_lead_eval --input amostra.json --models gpt-5-mini,gpt-5-nano,gpt-4.1-nano
"""
import argparse
import asyncio
import json
import sys

# Workaround Norton/MITM TLS na máquina do dev (Windows): usa o trust store do
# SO em vez do certifi. No-op se truststore não estiver instalado (ex.: Linux).
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from app.config import settings
from app.llm import LLMClient
from app.branches.lead import LEAD_SYSTEM, LEAD_SYSTEM_ATACADO, _parse_lead

REF_FIELDS = ("nome", "telefone", "email", "cep")


async def _extract(llm, model, text, atacado, reasoning_effort):
    system = LEAD_SYSTEM_ATACADO if atacado else LEAD_SYSTEM
    resp = await llm.chat(
        model=model,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": text}],
        reasoning_effort=reasoning_effort)
    return _parse_lead(resp.get("content", ""))


async def _load_messages(args):
    if args.input:
        with open(args.input, encoding="utf-8") as f:
            raw = json.load(f)
        out = []
        for item in raw:
            if isinstance(item, str):
                out.append({"text": item, "atacado": args.atacado})
            else:
                out.append({"text": item["text"],
                            "atacado": bool(item.get("atacado", args.atacado))})
        return out[: args.limit]

    # banco: amostra mensagens reais de clientes
    import asyncpg
    if not settings.database_url:
        sys.exit("DATABASE_URL não setado e nenhum --input fornecido.")
    conn = await asyncpg.connect(settings.database_url)
    # --contacts: enviesa a amostra pras mensagens que REALMENTE têm dado de
    # lead (telefone/email/cep/nome), pra o recall ter denominador relevante.
    # Sem isso, a maioria das mensagens aleatórias ("oi", "quanto?") não tem
    # nada a extrair e o A/B vira inconclusivo.
    contact_filter = (
        r" AND (content ~ '\d{8,}' OR content LIKE '%@%'"
        r" OR content ILIKE '%meu nome%' OR content ILIKE '%me chamo%'"
        r" OR content ILIKE '%sou a %' OR content ILIKE '%sou o %'"
        r" OR content ILIKE '%zap%' OR content ILIKE '%whats%')"
    ) if args.contacts else ""
    try:
        rows = await conn.fetch(
            f"""SELECT content FROM messages
                WHERE role = 'user' AND length(content) BETWEEN 3 AND 400
                {contact_filter}
                ORDER BY random() LIMIT $1""", args.limit)
    finally:
        await conn.close()
    return [{"text": r["content"], "atacado": args.atacado} for r in rows]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="gpt-5-mini,gpt-5-nano",
                    help="csv; o PRIMEIRO é a referência")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--input", help="arquivo JSON com mensagens (em vez do banco)")
    ap.add_argument("--atacado", action="store_true",
                    help="usa o prompt de atacado (LEAD_SYSTEM_ATACADO) por padrão")
    ap.add_argument("--contacts", action="store_true",
                    help="amostra só mensagens que parecem ter telefone/email/nome")
    ap.add_argument("--reasoning", default=None,
                    help="reasoning_effort p/ os candidatos (ex.: minimal). Ref sempre None.")
    args = ap.parse_args()

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    ref, candidates = models[0], models[1:]
    if not candidates:
        sys.exit("Passe ao menos um candidato além da referência em --models.")

    msgs = await _load_messages(args)
    if not msgs:
        sys.exit("Nenhuma mensagem para avaliar.")
    print(f"Avaliando {len(msgs)} mensagens | ref={ref} | candidatos={candidates}\n")

    llm = LLMClient(api_key=settings.openai_api_key)

    # contadores por candidato
    stats = {c: {f: {"ref_has": 0, "cand_has": 0, "match": 0, "recall_hit": 0}
                 for f in REF_FIELDS} for c in candidates}

    for i, m in enumerate(msgs, 1):
        ref_parsed = await _extract(llm, ref, m["text"], m["atacado"], None)
        for c in candidates:
            cand_parsed = await _extract(llm, c, m["text"], m["atacado"], args.reasoning)
            for f in REF_FIELDS:
                rv, cv = ref_parsed.get(f), cand_parsed.get(f)
                s = stats[c][f]
                if rv:
                    s["ref_has"] += 1
                    if cv:
                        s["recall_hit"] += 1          # achou o campo que ref achou
                        if str(cv) == str(rv):
                            s["match"] += 1           # e com o MESMO valor
                if cv:
                    s["cand_has"] += 1
        if i % 25 == 0:
            print(f"  ...{i}/{len(msgs)}")

    print("\n================ RESULTADO (candidato vs referência) ================")
    for c in candidates:
        print(f"\n# {c}  (ref={ref})")
        print(f"{'campo':10} {'ref_tem':>8} {'cand_tem':>9} {'recall':>8} {'valor=':>8}")
        for f in REF_FIELDS:
            s = stats[c][f]
            recall = s["recall_hit"] / s["ref_has"] if s["ref_has"] else 1.0
            exact = s["match"] / s["ref_has"] if s["ref_has"] else 1.0
            flag = "  <-- ATENÇÃO" if (f in ("telefone", "nome") and recall < 0.98) else ""
            print(f"{f:10} {s['ref_has']:8} {s['cand_has']:9} "
                  f"{recall:8.2%} {exact:8.2%}{flag}")
    print("\nRegra: telefone/nome com recall < 98% => NÃO promover o candidato.")


if __name__ == "__main__":
    asyncio.run(main())
