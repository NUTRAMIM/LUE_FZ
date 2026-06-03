# tests/test_branch_lead.py
import json
from app.branches.lead import run_lead
from app.models import Context, Lead


def _ctx(store, msg="quero comprar, sou a Maria, 11999998888"):
    return Context(store=store, conversation_id="conv-1", chat_input=msg, ai_output="ok")


async def test_no_data_does_nothing(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"nome": None, "telefone": None, "email": None, "cep": None})}]
    await run_lead(db, llm, _ctx(store, "oi"))
    assert db.created_leads == [] and db.updated_leads == []


async def test_creates_lead_when_absent_then_summarizes(db, llm, store):
    db.lead = None
    db.recent_messages = [{"role": "user", "content": "quero um top"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": "Maria", "telefone": "5511999998888",
                                "email": None, "cep": None})},
        {"content": "top, tamanho M, cor rosa"},
    ]
    await run_lead(db, llm, _ctx(store))
    assert db.created_leads[0]["name"] == "Maria"
    assert db.created_leads[0]["whatsapp"] == "5511999998888"
    assert db.interest_updates[0]["interest_summary"] == "top, tamanho M, cor rosa"


async def test_updates_existing_lead(db, llm, store):
    db.lead = {"id": "lead-1", "name": None, "whatsapp": None, "email": None, "cep": None}
    db.recent_messages = [{"role": "user", "content": "oi"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": "João", "telefone": None,
                                "email": "j@x.com", "cep": None})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(store))
    assert db.updated_leads[0]["id"] == "lead-1"
    assert db.updated_leads[0]["name"] == "João"
    # interest "null" → não atualiza
    assert db.interest_updates == []
