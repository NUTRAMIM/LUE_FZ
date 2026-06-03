# tests/test_buffer.py
from app.buffer import resolve_window


async def test_empty_window_processes_original_input(db):
    db.window_messages = []
    res = await resolve_window(db, "conv-1", "msg-1", "olá original")
    assert res.should_process is True
    assert res.chat_input == "olá original"


async def test_not_latest_aborts(db):
    db.window_messages = [{"id": "msg-1", "content": "a"},
                          {"id": "msg-2", "content": "b"}]
    res = await resolve_window(db, "conv-1", "msg-1", "a")
    assert res.should_process is False


async def test_latest_joins_window_contents(db):
    db.window_messages = [{"id": "msg-1", "content": "quero"},
                          {"id": "msg-2", "content": "um top"}]
    res = await resolve_window(db, "conv-1", "msg-2", "um top")
    assert res.should_process is True
    assert res.chat_input == "quero\num top"


async def test_single_message_window(db):
    db.window_messages = [{"id": "msg-1", "content": "oi"}]
    res = await resolve_window(db, "conv-1", "msg-1", "oi")
    assert res.should_process is True
    assert res.chat_input == "oi"
