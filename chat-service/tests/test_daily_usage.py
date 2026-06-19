# tests/test_daily_usage.py
import pytest
from app.db import Database


class FakePool:
    def __init__(self):
        self.calls = []

    async def execute(self, sql, *args):
        self.calls.append((sql, args))


@pytest.fixture
def fake_db():
    db = Database.__new__(Database)   # sem abrir pool real
    db._pool = FakePool()
    return db


async def test_record_daily_usage_upsert_por_loja_dia_modelo(fake_db):
    await fake_db.record_daily_usage("store-1", "gpt-5-mini", 100, 40, 140, 80, 3)
    assert len(fake_db._pool.calls) == 1
    sql, args = fake_db._pool.calls[0]
    assert "INSERT INTO ai_usage_daily" in sql
    assert "ON CONFLICT (store_id, day, model) DO UPDATE" in sql
    assert "cached_tokens" in sql
    assert args == ("store-1", "gpt-5-mini", 100, 40, 140, 80, 3)


async def test_record_daily_usage_usa_fuso_sao_paulo_para_o_dia(fake_db):
    await fake_db.record_daily_usage("store-1", "gpt-5-nano", 1, 1, 2, 0, 1)
    sql, _ = fake_db._pool.calls[0]
    assert "America/Sao_Paulo" in sql
