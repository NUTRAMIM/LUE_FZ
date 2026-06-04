# app/agent/runner.py
import json
from app.config import settings
from app.models import AgentResult
from app.agent.prompt import build_system_prompt
from app.agent.tools import buscar_produtos, listar_categoria

TOOL_NAME = "BUSCAR_PRODUTOS"
LISTAR_TOOL_NAME = "LISTAR_CATEGORIA"
MAX_TOOL_ROUNDS = 5

TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": TOOL_NAME,
        "description": (
            "Busca semântica no catálogo de produtos da loja. Use quando o "
            "cliente pedir produtos COM algum filtro (cor, tamanho, ocasião, "
            "estilo, preço). Na consulta descreva o pedido em linguagem natural. "
            "`category` é a categoria EXATA da loja (string vazia se vago)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "consulta": {"type": "string"},
                "category": {"type": "string"},
            },
            "required": ["consulta", "category"],
        },
    },
}

TOOL_SCHEMA_LISTAR = {
    "type": "function",
    "function": {
        "name": LISTAR_TOOL_NAME,
        "description": (
            "Mostra TODAS as peças de uma categoria de uma vez. Use SOMENTE "
            "quando o cliente pedir a categoria inteira SEM nenhum filtro "
            "(ex.: 'me mostra os conjuntos', 'quais tops vocês têm'). Se houver "
            "qualquer filtro (cor, tamanho, ocasião, preço), use BUSCAR_PRODUTOS. "
            "`categoria` deve ser a categoria EXATA da loja."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "categoria": {"type": "string"},
            },
            "required": ["categoria"],
        },
    },
}


async def run_agent(llm, db, store, shown_list, chat_input, history) -> AgentResult:
    messages = [{"role": "system", "content": build_system_prompt(store, shown_list)}]
    messages.extend(history)
    messages.append({"role": "user", "content": chat_input})

    product_segments: list[str] = []
    shown_product_ids: list[str] = []

    for _ in range(MAX_TOOL_ROUNDS):
        resp = await llm.chat(
            model=settings.chat_model, messages=messages,
            tools=[TOOL_SCHEMA, TOOL_SCHEMA_LISTAR], max_tokens=4096)

        tool_calls = resp.get("tool_calls")
        if not tool_calls:
            return AgentResult(
                text=resp.get("content") or "",
                product_segments=product_segments,
                shown_product_ids=shown_product_ids)

        messages.append({
            "role": "assistant",
            "content": resp.get("content"),
            "tool_calls": [
                {"id": tc["id"], "type": "function",
                 "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                for tc in tool_calls
            ],
        })
        for call in tool_calls:
            args = json.loads(call["arguments"])
            if call["name"] == LISTAR_TOOL_NAME:
                segmento, ids, resumo = await listar_categoria(
                    db, store.id, args.get("categoria", ""))
                if segmento:
                    product_segments.append(segmento)
                    shown_product_ids.extend(ids)
                content = resumo
            else:
                content = await buscar_produtos(
                    db, llm, store.id, args.get("consulta", ""), args.get("category", ""))
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": content})

    resp = await llm.chat(model=settings.chat_model, messages=messages, max_tokens=4096)
    return AgentResult(
        text=resp.get("content") or "",
        product_segments=product_segments,
        shown_product_ids=shown_product_ids)
