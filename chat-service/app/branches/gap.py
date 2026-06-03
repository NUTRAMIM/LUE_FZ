# app/branches/gap.py
import json
from app.config import settings
from app.branches.lead import _strip_fences


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

Retorne APENAS JSON puro, sem markdown, no formato:
{{"is_gap": true|false, "question": "pergunta normalizada em minúsculas", "tag": "POLÍTICA DE ENTREGA"|"PRAZO"|"ATACADO"|"SKU INEXISTENTE"|"PAGAMENTO"|"OUTROS"}}

Marque is_gap=true APENAS se:
- A mensagem contém pergunta concreta (com '?' ou claramente interrogativa).
- A resposta NÃO está nas instruções acima.
- A pergunta NÃO é sobre um produto específico do catálogo (isso é trabalho do vendedor).

Marque is_gap=false se: saudação, comentário, declaração de interesse, pergunta sobre produto/cor/tamanho específico, ou pergunta já coberta pelas instruções acima.

Se is_gap=false, devolva question="" e tag="OUTROS"."""


async def run_gap(db, llm, ctx) -> None:
    resp = await llm.chat(
        model=settings.chat_model,
        messages=[{"role": "system", "content": _gap_system(ctx.store)},
                  {"role": "user", "content": f"Mensagem do cliente: {ctx.chat_input}"}])
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
