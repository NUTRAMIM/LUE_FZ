# app/agent/runner.py
import json
from app.config import settings
from app.agent.prompt import build_system_prompt
from app.agent.tools import buscar_produtos

TOOL_NAME = "BUSCAR_PRODUTOS"
MAX_TOOL_ROUNDS = 5

TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": TOOL_NAME,
        "description": (
            "Busca semântica no catálogo de produtos da loja. Use sempre que o "
            "cliente perguntar sobre produtos. Na consulta descreva o pedido em "
            "linguagem natural (cor, ocasião, estilo). `category` é a categoria "
            "EXATA da loja (string vazia se vago)."
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


async def run_agent(llm, db, store, shown_list, chat_input, history) -> str:
    messages = [{"role": "system", "content": build_system_prompt(store, shown_list)}]
    messages.extend(history)
    messages.append({"role": "user", "content": chat_input})

    for _ in range(MAX_TOOL_ROUNDS):
        resp = await llm.chat(
            model=settings.chat_model, messages=messages,
            tools=[TOOL_SCHEMA], max_tokens=4096)

        tool_calls = resp.get("tool_calls")
        if not tool_calls:
            return resp.get("content") or ""

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
            result = await buscar_produtos(
                db, llm, store.id, args.get("consulta", ""), args.get("category", ""))
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": result})

    # esgotou as rodadas: força uma resposta textual
    resp = await llm.chat(model=settings.chat_model, messages=messages, max_tokens=4096)
    return resp.get("content") or ""
