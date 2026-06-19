# tests/test_branch_gap.py
import json
from app.branches.gap import run_gap, looks_like_question
from app.models import Context


def test_looks_like_question_with_qmark():
    assert looks_like_question("vocês entregam em SP?")


def test_looks_like_question_interrogative_without_qmark():
    assert looks_like_question("vocês fazem troca")


def test_looks_like_question_skips_greeting():
    assert not looks_like_question("oi tudo bem")


def test_looks_like_question_skips_purchase_intent():
    assert not looks_like_question("quero comprar esse")


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


async def test_gap_uses_structured_outputs(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"is_gap": True, "question": "vocês entregam em sp?", "tag": "PRAZO"})}]
    await run_gap(db, llm, _ctx(store, "vocês entregam em SP?"))
    rf = llm.chat_calls[0]["response_format"]
    assert rf["type"] == "json_schema"
    props = rf["json_schema"]["schema"]["properties"]
    assert props["is_gap"]["type"] == "boolean"
    assert "ATACADO" in props["tag"]["enum"]


def test_looks_like_question_catches_atacado_statement():
    assert looks_like_question("trabalho com revenda de moda fitness")
    assert looks_like_question("compro pra minha loja")
    assert looks_like_question("sou sacoleira")


def test_looks_like_question_still_skips_plain_greeting():
    assert not looks_like_question("oi tudo bem")
    assert not looks_like_question("kkk adorei")
