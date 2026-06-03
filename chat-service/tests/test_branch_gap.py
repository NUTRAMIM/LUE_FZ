# tests/test_branch_gap.py
import json
from app.branches.gap import run_gap
from app.models import Context


def _ctx(store, msg):
    return Context(store=store, conversation_id="conv-1", chat_input=msg, ai_output="ok")


async def test_inserts_gap_when_detected(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"is_gap": True, "question": "vocês entregam em sp?", "tag": "PRAZO"})}]
    await run_gap(db, llm, _ctx(store, "vocês entregam em SP?"))
    assert db.inserted_gaps[0]["question"] == "vocês entregam em sp?"
    assert db.inserted_gaps[0]["tag"] == "PRAZO"


async def test_no_gap_inserts_nothing(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"is_gap": False, "question": "", "tag": "OUTROS"})}]
    await run_gap(db, llm, _ctx(store, "oi"))
    assert db.inserted_gaps == []


async def test_gap_true_but_empty_question_inserts_nothing(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"is_gap": True, "question": "", "tag": "OUTROS"})}]
    await run_gap(db, llm, _ctx(store, "?"))
    assert db.inserted_gaps == []
