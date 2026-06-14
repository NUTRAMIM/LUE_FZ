# app/branches/lead.py
import json
import re

from app.config import settings

_DISAMBIGUA_NUMEROS = """REGRA CRÍTICA — telefone vs. cep (ambos são só números, NÃO confunda):
- Conte os dígitos do número (ignore espaços, traços, parênteses, +).
- 8 dígitos => é CEP, NUNCA telefone. Ex.: "01310100", "22041-011".
- 10 a 13 dígitos => é TELEFONE/WhatsApp, NUNCA cep. Sempre tem DDD. Ex.: "11999998888", "(21) 98888-7777", "5511999998888".
- Na dúvida, decida pela contagem de dígitos: 8 = cep; 10+ = telefone.
- Um mesmo número nunca vai nos dois campos ao mesmo tempo."""

LEAD_SYSTEM = """Você é um extrator de informações pessoais. Analise a mensagem do cliente e identifique se ele compartilhou algum destes dados:

- nome (próprio do cliente, ex: "meu nome é João", "sou a Maria")
- telefone (WhatsApp ou fixo — 10 a 13 dígitos, sempre com DDD)
- email
- cep (exatamente 8 dígitos, formato 00000-000)

""" + _DISAMBIGUA_NUMEROS + """

Retorne APENAS um JSON puro, sem markdown e sem texto adicional, no formato:
{"nome": "João" ou null, "telefone": "5511999999999" ou null, "email": "x@y.com" ou null, "cep": "01310-100" ou null}

Se nada foi compartilhado, retorne:
{"nome": null, "telefone": null, "email": null, "cep": null}

Exemplos:
- "meu zap é (11) 99999-8888" => {"nome": null, "telefone": "5511999998888", "email": null, "cep": null}
- "meu cep é 01310100" => {"nome": null, "telefone": null, "email": null, "cep": "01310-100"}

Normalize:
- telefone: somente dígitos, com código do país (Brasil = 55).
- cep: formato 00000-000.
- nome: capitalizado ("João", não "joão")."""

LEAD_SYSTEM_ATACADO = """Você é um extrator de informações de um cliente REVENDEDOR (atacado). Analise a mensagem do cliente e identifique se ele compartilhou algum destes dados:

- nome (próprio do cliente, ex: "meu nome é João", "sou a Maria")
- telefone (WhatsApp ou fixo — 10 a 13 dígitos, sempre com DDD)
- email
- cep (exatamente 8 dígitos, formato 00000-000)
- carro_chefe (o produto/categoria que ele mais revende ou procura como principal, ex: "vestidos de festa", "moda fitness", "conjuntos")

""" + _DISAMBIGUA_NUMEROS + """

Retorne APENAS um JSON puro, sem markdown e sem texto adicional, no formato:
{"nome": "João" ou null, "telefone": "5511999999999" ou null, "email": "x@y.com" ou null, "cep": "01310-100" ou null, "carro_chefe": "vestidos de festa" ou null}

Se nada foi compartilhado, retorne:
{"nome": null, "telefone": null, "email": null, "cep": null, "carro_chefe": null}

Normalize:
- telefone: somente dígitos, com código do país (Brasil = 55).
- cep: formato 00000-000.
- nome: capitalizado ("João", não "joão").
- carro_chefe: texto curto, minúsculo, sem aspas."""

INTEREST_SYSTEM = """Você sintetiza o interesse do cliente para o vendedor humano que vai assumir. Em 1-2 frases (até ~200 caracteres), descreva: categoria/tipo de produto procurado, atributos mencionados (cor, tamanho, ocasião, estilo, faixa de preço). Não invente nada. Se a conversa não revelou interesse claro, devolva exatamente null. Sem markdown, sem aspas, sem prefixar com 'O cliente...' — vá direto ao ponto."""


def _strip_fences(raw: str) -> str:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.split("```")[1] if "```" in s[3:] else s
        s = s.replace("json", "", 1).strip("` \n")
    return s.strip()


def _normalize_numbers(parsed: dict) -> dict:
    """Reclassifica telefone/cep pela contagem de dígitos. No Brasil as faixas
    não se sobrepõem (cep = 8 dígitos; telefone = 10-13), então o tamanho
    decide com segurança e corrige trocas feitas pelo LLM."""
    telefone, cep = None, None
    for valor in (parsed.get("telefone"), parsed.get("cep")):
        d = re.sub(r"\D", "", valor or "")
        if len(d) == 8:
            cep = cep or d
        elif 10 <= len(d) <= 13:
            telefone = telefone or (("55" + d) if len(d) in (10, 11) else d)
        # tamanhos fora dessas faixas: descarta (provável ruído)
    parsed["telefone"] = telefone
    parsed["cep"] = f"{cep[:5]}-{cep[5:]}" if cep else None
    return parsed


def _parse_lead(raw: str) -> dict:
    try:
        obj = json.loads(_strip_fences(raw))
        parsed = {"nome": obj.get("nome") or None, "telefone": obj.get("telefone") or None,
                  "email": obj.get("email") or None, "cep": obj.get("cep") or None,
                  "carro_chefe": obj.get("carro_chefe") or None}
        return _normalize_numbers(parsed)
    except Exception:
        return {"nome": None, "telefone": None, "email": None, "cep": None,
                "carro_chefe": None}


_CONTACT_NAME_RE = re.compile(
    r"\b(meu nome|me chamo|sou a |sou o |aqui (é|eh|quem fala)|"
    r"pode (me )?chamar|nome (é|eh)|chamo)\b", re.I)
_ASKED_PERSONAL_RE = re.compile(
    r"\b(nome|whats|zap|telefone|celular|cep|e-?mail|contato|seus? dados?)\b", re.I)


def should_extract_lead(chat_input: str, history=None) -> bool:
    """Gate barato pra evitar chamar o extrator (mini) em TODA mensagem. Só vale
    rodar se a mensagem tem cara de dado de contato (telefone/cep/email/nome) OU
    se o cliente está respondendo a um pedido de dado pessoal da IA (cobre
    respostas curtas tipo só o nome ou só o CEP). Na dúvida, roda — perder lead
    custa mais que uma chamada extra. `history` vem recente-primeiro."""
    txt = chat_input or ""
    if "@" in txt or _CONTACT_NAME_RE.search(txt):
        return True
    if len(re.sub(r"\D", "", txt)) >= 8:        # telefone (10-13) ou cep (8 dígitos)
        return True
    for m in (history or []):                    # só a última fala da IA importa
        if m.get("role") == "assistant":
            return bool(_ASKED_PERSONAL_RE.search(m.get("content") or ""))
    return False


async def run_lead(db, llm, ctx) -> None:
    atacado = bool(getattr(ctx.store, "min_order_enabled", False))
    system = LEAD_SYSTEM_ATACADO if atacado else LEAD_SYSTEM
    tipo_cliente = "revendedor" if atacado else "varejo"

    # Extração de lead fica no lead_model (default gpt-5-mini). NÃO usar
    # reasoning_effort=minimal aqui: contar dígitos de telefone/cep se beneficia
    # de algum raciocínio, e falso-negativo de telefone = lead perdido.
    resp = await llm.chat(model=settings.lead_model,
                          messages=[{"role": "system", "content": system},
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
            cep=parsed["cep"] or existing.get("cep"),
            tipo_cliente=tipo_cliente,
            carro_chefe=parsed["carro_chefe"] or existing.get("carro_chefe"))
    else:
        await db.create_lead(
            conversation_id=ctx.conversation_id, store_id=ctx.store.id,
            name=parsed["nome"], whatsapp=parsed["telefone"],
            email=parsed["email"], cep=parsed["cep"],
            tipo_cliente=tipo_cliente, carro_chefe=parsed["carro_chefe"],
            source="chat")

    await _summarize_interest(db, llm, ctx)


async def _summarize_interest(db, llm, ctx) -> None:
    recent = await db.get_recent_messages(ctx.conversation_id, limit=10)
    text = "\n".join(f"{m['role']}: {m['content']}" for m in recent)
    resp = await llm.chat(
        model=settings.background_model,
        messages=[{"role": "system", "content": INTEREST_SYSTEM},
                  {"role": "user", "content": f"Mensagens recentes (mais recente primeiro):\n{text}"}],
        reasoning_effort="minimal")
    cleaned = _strip_fences(resp.get("content", ""))
    if not cleaned or cleaned.lower() == "null":
        return
    await db.update_lead_interest(ctx.conversation_id, ctx.store.id, cleaned)
