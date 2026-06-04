# tests/test_runner.py
import json
from app.agent.runner import run_agent, TOOL_NAME


async def test_returns_text_without_tool_call(db, llm, store):
    llm.chat_responses = [{"content": "oi, tudo bem?"}]
    out = await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    assert out == "oi, tudo bem?"


async def test_executes_tool_then_returns_text(db, llm, store):
    db.match_results = [{"content": "Top", "similarity": 0.5,
                         "metadata": {"name": "Top Alça", "category": "top",
                                      "price": 50, "tamanhos": ["P"], "cores": ["rosa"],
                                      "brand": None, "image_url": "http://x"}}]
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "top", "category": "top"})}]},
        {"content": "achei isso: Top Alça"},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="quero top", history=[])
    assert out == "achei isso: Top Alça"
    # a 2ª chamada ao LLM recebeu o resultado da tool no histórico
    second_call_msgs = llm.chat_calls[1]["messages"]
    assert any(m.get("role") == "tool" for m in second_call_msgs)


async def test_replayed_tool_calls_use_openai_shape(db, llm, store):
    db.match_results = [{"content": "Top", "similarity": 0.5,
                         "metadata": {"name": "Top Alça", "category": "top",
                                      "price": 50, "tamanhos": ["P"], "cores": ["rosa"],
                                      "brand": None, "image_url": "http://x"}}]
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "top", "category": "top"})}]},
        {"content": "achei isso: Top Alça"},
    ]
    await run_agent(llm, db, store, shown_list="", chat_input="quero top", history=[])
    second_call_msgs = llm.chat_calls[1]["messages"]
    assistant_msg = next(m for m in second_call_msgs if m.get("role") == "assistant")
    tc = assistant_msg["tool_calls"][0]
    assert tc["type"] == "function"
    assert tc["function"]["name"] == TOOL_NAME
    assert tc["function"]["arguments"] == json.dumps({"consulta": "top", "category": "top"})
    assert "name" not in tc  # not the flat normalized shape
