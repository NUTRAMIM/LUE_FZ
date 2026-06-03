# tests/test_branch_mentions.py
from app.branches.mentions import run_mentions
from app.models import Context


def _ctx(store, ai_output, customer_msg):
    return Context(store=store, conversation_id="conv-1",
                   chat_input=customer_msg, ai_output=ai_output)


async def test_matches_ai_output_and_customer_msg(db, store):
    db.catalog = [{"id": "p1", "name": "Top Alça"}, {"id": "p2", "name": "Vestido Longo"}]
    ctx = _ctx(store, ai_output="olha o Top Alça que achei",
               customer_msg="tem Vestido Longo?")
    await run_mentions(db, ctx)
    pairs = {(m["product_id"], m["source"]) for m in db.inserted_mentions}
    assert ("p1", "ai_shown") in pairs
    assert ("p2", "customer_asked") in pairs


async def test_longest_name_wins_no_double_count(db, store):
    db.catalog = [{"id": "p1", "name": "Top"}, {"id": "p2", "name": "Top Alça"}]
    ctx = _ctx(store, ai_output="o Top Alça é lindo", customer_msg="")
    await run_mentions(db, ctx)
    ids = [m["product_id"] for m in db.inserted_mentions]
    assert ids == ["p2"]   # "Top Alça" consumiu o trecho; "Top" não recasa


async def test_no_match_inserts_nothing(db, store):
    db.catalog = [{"id": "p1", "name": "Top Alça"}]
    ctx = _ctx(store, ai_output="oi tudo bem", customer_msg="bom dia")
    await run_mentions(db, ctx)
    assert db.inserted_mentions == []
