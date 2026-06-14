# tests/test_branch_lead.py
import json
from app.branches.lead import run_lead, should_extract_lead
from app.models import Context, Lead


def test_should_extract_lead_on_phone():
    assert should_extract_lead("meu zap é (11) 98888-7777")


def test_should_extract_lead_on_email():
    assert should_extract_lead("manda no ana@x.com")


def test_should_extract_lead_on_name_intro():
    assert should_extract_lead("oi, meu nome é Ana")


def test_should_extract_lead_on_cep_digits():
    assert should_extract_lead("01310-100")


def test_should_extract_lead_skips_greeting():
    assert not should_extract_lead("oi, tudo bem")


def test_should_extract_lead_skips_product_request():
    assert not should_extract_lead("queria ver vestidos")


def test_should_extract_lead_on_bare_reply_after_ia_asked():
    # cliente responde só o nome logo após a IA pedir dados pessoais
    history = [{"role": "user", "content": "Ana Beatriz"},
               {"role": "assistant", "content": "Qual seu nome e WhatsApp?"}]
    assert should_extract_lead("Ana Beatriz", history)


def test_should_extract_lead_skips_bare_reply_when_ia_didnt_ask():
    history = [{"role": "assistant", "content": "Achei esses tops pra você!"}]
    assert not should_extract_lead("o segundo", history)


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


async def test_cep_misclassified_as_phone_is_corrected(db, llm, store):
    db.lead = None
    db.recent_messages = [{"role": "user", "content": "meu cep é 01310100"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": None, "telefone": "01310100",
                                "email": None, "cep": None})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(store, "meu cep é 01310100"))
    assert db.created_leads[0]["whatsapp"] is None
    assert db.created_leads[0]["cep"] == "01310-100"


async def test_phone_misclassified_as_cep_is_corrected(db, llm, store):
    db.lead = None
    db.recent_messages = [{"role": "user", "content": "meu zap 11999998888"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": "11999998888"})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(store, "meu zap 11999998888"))
    assert db.created_leads[0]["cep"] is None
    assert db.created_leads[0]["whatsapp"] == "5511999998888"


async def test_phone_without_ddi_gets_55_and_cep_keeps_format(db, llm, store):
    db.lead = None
    db.recent_messages = [{"role": "user", "content": "11988887777 e cep 22041-011"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": None, "telefone": "(11) 98888-7777",
                                "email": None, "cep": "22041011"})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(store, "tel e cep"))
    assert db.created_leads[0]["whatsapp"] == "5511988887777"
    assert db.created_leads[0]["cep"] == "22041-011"


import dataclasses


def _atacado(store):
    return dataclasses.replace(store, min_order_enabled=True)


async def test_varejo_marks_tipo_cliente_varejo(db, llm, store):
    db.lead = None
    db.recent_messages = [{"role": "user", "content": "quero um top"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": "Maria", "telefone": "5511999998888",
                                "email": None, "cep": None})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(store))
    assert db.created_leads[0]["tipo_cliente"] == "varejo"
    assert db.created_leads[0].get("carro_chefe") is None


async def test_atacado_extracts_carro_chefe_and_marks_reseller(db, llm, store):
    db.lead = None
    db.recent_messages = [{"role": "user", "content": "revendo vestido"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": "Bia", "telefone": "5511988887777",
                                "email": None, "cep": None,
                                "carro_chefe": "vestidos de festa"})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(_atacado(store)))
    assert db.created_leads[0]["tipo_cliente"] == "revendedor"
    assert db.created_leads[0]["carro_chefe"] == "vestidos de festa"


async def test_atacado_update_preserves_existing_carro_chefe(db, llm, store):
    db.lead = {"id": "lead-1", "name": "Bia", "whatsapp": None, "email": None,
               "cep": None, "carro_chefe": "moda fitness"}
    db.recent_messages = [{"role": "user", "content": "meu cep é 01310-100"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": None, "telefone": None, "email": None,
                                "cep": "01310-100", "carro_chefe": None})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(_atacado(store)))
    assert db.updated_leads[0]["carro_chefe"] == "moda fitness"
    assert db.updated_leads[0]["tipo_cliente"] == "revendedor"
    assert db.updated_leads[0]["cep"] == "01310-100"
