# app/branches/gap.py
import json
import re
from app.config import settings
from app.branches.lead import _strip_fences

GAP_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "gap_detection",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "is_gap": {"type": "boolean"},
                "question": {"type": "string"},
                "tag": {"type": "string", "enum": [
                    "POLÍTICA DE ENTREGA", "PRAZO", "ATACADO",
                    "SKU INEXISTENTE", "PAGAMENTO", "OUTROS"]},
            },
            "required": ["is_gap", "question", "tag"],
        },
    },
}


def _gap_system(store) -> str:
    categorias = ", ".join(store.categories)
    pagamento = ", ".join(store.payment_methods)
    entrega = ", ".join(store.delivery_methods)
    return f"""Você analisa a mensagem do cliente e detecta perguntas que a loja não consegue responder com as instruções abaixo.

Instruções da loja:
- Categorias: {categorias}
- Pagamento: {pagamento}
- Entrega: {entrega}
- Outras: {store.service_instructions}

Marque is_gap=true APENAS se:
- A mensagem contém pergunta concreta (com '?' ou claramente interrogativa).
- A resposta NÃO está nas instruções acima.
- A pergunta NÃO é sobre um produto específico do catálogo (isso é trabalho do vendedor).

Marque is_gap=false se: saudação, comentário, declaração de interesse, pergunta sobre produto/cor/tamanho específico, ou pergunta já coberta pelas instruções acima.

Se is_gap=false, devolva question="" e tag="OUTROS"."""


_QUESTION_RE = re.compile(
    r"\?|\b(qual|quais|quanto|quantos|quanta|quantas|quando|onde|cad[eê]|como|"
    r"por que|porque|por quê|tem|t[eê]m|teria|h[aá] |posso|consigo|consegue|"
    r"d[aá] pra|aceita|aceitam|fazem|faz |entrega|entregam|envia|enviam|demora|"
    r"prazo|troca|garantia|funciona|precisa|vale a pena|"
    r"revend\w*|atacado|sacoleir\w*|lojist\w*|pra minha loja|pra revender)\b", re.I)


def looks_like_question(chat_input: str) -> bool:
    """Gate barato pro gap: só roda a detecção se a mensagem parece pergunta.
    Erra pro lado de rodar (nano é barato); o objetivo é pular saudação, elogio,
    'quero comprar' e confirmações — que não têm lacuna nenhuma a detectar."""
    return bool(_QUESTION_RE.search(chat_input or ""))


async def run_gap(db, llm, ctx) -> None:
    resp = await llm.chat(
        model=settings.background_model,
        messages=[{"role": "system", "content": _gap_system(ctx.store)},
                  {"role": "user", "content": f"Mensagem do cliente: {ctx.chat_input}"}],
        reasoning_effort="minimal",
        response_format=GAP_SCHEMA)
    try:
        obj = json.loads(_strip_fences(resp.get("content", "")))
        is_gap = bool(obj.get("is_gap"))
        question = str(obj.get("question") or "").lower().strip()
        tag = str(obj.get("tag") or "OUTROS").upper().strip()
    except Exception:
        return

    if not (is_gap and question):
        return
    await db.insert_knowledge_gap(ctx.store.id, ctx.conversation_id, question, tag)
