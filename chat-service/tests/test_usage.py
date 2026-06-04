# tests/test_usage.py
import asyncio
from app.usage import UsageAccumulator, start_usage, record_usage, _current


def test_accumulator_add_sums():
    acc = UsageAccumulator()
    acc.add(10, 5, 15)
    acc.add(20, 8, 28)
    assert acc.prompt == 30
    assert acc.completion == 13
    assert acc.total == 43
    assert acc.calls == 2


def test_start_usage_returns_fresh_and_sets_current():
    acc = start_usage()
    assert acc.total == 0
    assert acc.calls == 0
    assert _current.get() is acc


def test_record_usage_adds_to_current():
    acc = start_usage()
    record_usage("agente", 100, 40, 140)
    assert acc.prompt == 100
    assert acc.completion == 40
    assert acc.total == 140
    assert acc.calls == 1


def test_record_usage_noop_without_current():
    _current.set(None)
    record_usage("agente", 100, 40, 140)  # não deve levantar


async def test_record_usage_accumulates_across_gather():
    acc = start_usage()

    async def worker(p, c, t):
        record_usage("branch", p, c, t)

    await asyncio.gather(worker(10, 1, 11), worker(20, 2, 22))
    assert acc.total == 33
    assert acc.calls == 2
