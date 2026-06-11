# app/agent/runner.py
import json
import logging
from app.config import settings

log = logging.getLogger("chat-service")
from app.models import AgentResult
from app.agent.prompt import build_system_prompt, build_order_state_reminder
from app.agent.tools import buscar_produtos, listar_categoria, registrar_pedido

TOOL_NAME = "BUSCAR_PRODUTOS"
LISTAR_TOOL_NAME = "LISTAR_CATEGORIA"
REGISTRAR_TOOL_NAME = "REGISTRAR_PEDIDO"
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

TOOL_SCHEMA_REGISTRAR = {
    "type": "function",
    "function": {
        "name": REGISTRAR_TOOL_NAME,
        "description": (
            "Grava ou atualiza o pedido do cliente, a forma de pagamento e a "
            "forma de entrega na ficha do lead. Chame sempre que o cliente "
            "confirmar/alterar um item, a forma de pagamento ou a forma de "
            "entrega. O campo `itens` SUBSTITUI o pedido inteiro — envie a lista "
            "completa e atualizada."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "itens": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "produto": {"type": "string"},
                            "qtd": {"type": "integer"},
                            "tamanho": {"type": "string"},
                            "cor": {"type": "string"},
                            "preco": {"type": "number"},
                        },
                        "required": ["produto", "qtd"],
                    },
                },
                "forma_pagamento": {"type": "string"},
                "forma_entrega": {"type": "string"},
            },
            "required": ["itens"],
        },
    },
}


async def run_agent(llm, db, store, shown_list, chat_input, history,
                    conversation_id=None, lead=None) -> AgentResult:
    messages = [{"role": "system", "content": build_system_prompt(store, shown_list, lead)}]
    messages.extend(history)
    messages.append({"role": "system", "content": build_order_state_reminder(lead)})
    messages.append({"role": "user", "content": chat_input})

    product_segments: list[str] = []
    shown_product_ids: list[str] = []

    for _ in range(MAX_TOOL_ROUNDS):
        resp = await llm.chat(
            model=settings.chat_model, messages=messages,
            tools=[TOOL_SCHEMA, TOOL_SCHEMA_LISTAR, TOOL_SCHEMA_REGISTRAR], max_tokens=4096)

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
            log.info("tool call %s args=%s", call["name"], args)
            if call["name"] == LISTAR_TOOL_NAME:
                segmento, ids, resumo = await listar_categoria(
                    db, store.id, args.get("categoria", ""))
                if segmento:
                    product_segments.append(segmento)
                    shown_product_ids.extend(ids)
                log.info("LISTAR_CATEGORIA(%r) -> %d peças", args.get("categoria", ""), len(ids))
                content = resumo
            elif call["name"] == REGISTRAR_TOOL_NAME:
                content = await registrar_pedido(
                    db, store.id, conversation_id,
                    args.get("itens", []), args.get("forma_pagamento"),
                    args.get("forma_entrega"))
                log.info("REGISTRAR_PEDIDO -> %s", content)
            elif call["name"] == TOOL_NAME:
                segmento, ids, resumo = await buscar_produtos(
                    db, llm, store.id, args.get("consulta", ""), args.get("category", ""))
                if segmento:
                    product_segments.append(segmento)
                    shown_product_ids.extend(ids)
                log.info("BUSCAR_PRODUTOS(consulta=%r, category=%r) -> %d cards",
                         args.get("consulta", ""), args.get("category", ""),
                         segmento.count("[produto]") if segmento else 0)
                content = resumo
            else:
                content = ""
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": content})

    resp = await llm.chat(model=settings.chat_model, messages=messages, max_tokens=4096)
    return AgentResult(
        text=resp.get("content") or "",
        product_segments=product_segments,
        shown_product_ids=shown_product_ids)
