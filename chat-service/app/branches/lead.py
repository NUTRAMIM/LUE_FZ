# app/branches/lead.py
import json
from app.config import settings

LEAD_SYSTEM = """Você é um extrator de informações pessoais. Analise a mensagem do cliente e identifique se ele compartilhou algum destes dados:

- nome (próprio do cliente, ex: "meu nome é João", "sou a Maria")
- telefone (WhatsApp ou fixo — qualquer número com >= 10 dígitos)
- email
- cep (formato 00000-000 ou 00000000)

Retorne APENAS um JSON puro, sem markdown e sem texto adicional, no formato:
{"nome": "João" ou null, "telefone": "5511999999999" ou null, "email": "x@y.com" ou null, "cep": "01310-100" ou null}

Se nada foi compartilhado, retorne:
{"nome": null, "telefone": null, "email": null, "cep": null}

Normalize:
- telefone: somente dígitos, com código do país (Brasil = 55).
- cep: formato 00000-000.
- nome: capitalizado ("João", não "joão")."""

INTEREST_SYSTEM = """Você sintetiza o interesse do cliente para o vendedor humano que vai assumir. Em 1-2 frases (até ~200 caracteres), descreva: categoria/tipo de produto procurado, atributos mencionados (cor, tamanho, ocasião, estilo, faixa de preço). Não invente nada. Se a conversa não revelou interesse claro, devolva exatamente null. Sem markdown, sem aspas, sem prefixar com 'O cliente...' — vá direto ao ponto."""


def _strip_fences(raw: str) -> str:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.split("```")[1] if "```" in s[3:] else s
        s = s.replace("json", "", 1).strip("` \n")
    return s.strip()


def _parse_lead(raw: str) -> dict:
    try:
        obj = json.loads(_strip_fences(raw))
        return {"nome": obj.get("nome") or None, "telefone": obj.get("telefone") or None,
                "email": obj.get("email") or None, "cep": obj.get("cep") or None}
    except Exception:
        return {"nome": None, "telefone": None, "email": None, "cep": None}


async def run_lead(db, llm, ctx) -> None:
    resp = await llm.chat(model=settings.chat_model,
                          messages=[{"role": "system", "content": LEAD_SYSTEM},
                                    {"role": "user", "content": ctx.chat_input}])
    parsed = _parse_lead(resp.get("content", ""))
    if not any(parsed.values()):
        return

    existing = await db.get_lead(ctx.conversation_id, ctx.store.id)
    if existing:
        await db.update_lead(
            existing["id"],
            name=parsed["nome"] or existing.get("name"),
            whatsapp=parsed["telefone"] or existing.get("whatsapp"),
            email=parsed["email"] or existing.get("email"),
            cep=parsed["cep"] or existing.get("cep"))
    else:
        await db.create_lead(
            conversation_id=ctx.conversation_id, store_id=ctx.store.id,
            name=parsed["nome"], whatsapp=parsed["telefone"],
            email=parsed["email"], cep=parsed["cep"], source="chat")

    await _summarize_interest(db, llm, ctx)


async def _summarize_interest(db, llm, ctx) -> None:
    recent = await db.get_recent_messages(ctx.conversation_id, limit=10)
    text = "\n".join(f"{m['role']}: {m['content']}" for m in recent)
    resp = await llm.chat(
        model=settings.chat_model,
        messages=[{"role": "system", "content": INTEREST_SYSTEM},
                  {"role": "user", "content": f"Mensagens recentes (mais recente primeiro):\n{text}"}])
    cleaned = _strip_fences(resp.get("content", ""))
    if not cleaned or cleaned.lower() == "null":
        return
    await db.update_lead_interest(ctx.conversation_id, ctx.store.id, cleaned)
