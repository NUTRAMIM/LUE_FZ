# tests/test_llm_usage.py
import pytest
from types import SimpleNamespace
from app.llm import LLMClient
from app.usage import start_usage


class FakeCompletions:
    def __init__(self, usage):
        self._usage = usage

    async def create(self, **kwargs):
        msg = SimpleNamespace(content="oi", tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=self._usage)


class FakeEmbeddings:
    def __init__(self, usage):
        self._usage = usage

    async def create(self, **kwargs):
        return SimpleNamespace(data=[SimpleNamespace(embedding=[0.0] * 1536)],
                               usage=self._usage)


def make_client(chat_usage=None, embed_usage=None):
    client = LLMClient(api_key="test")
    client._client = SimpleNamespace(
        chat=SimpleNamespace(completions=FakeCompletions(chat_usage)),
        embeddings=FakeEmbeddings(embed_usage),
    )
    return client


async def test_chat_records_usage_into_current():
    acc = start_usage()
    usage = SimpleNamespace(prompt_tokens=100, completion_tokens=40, total_tokens=140)
    client = make_client(chat_usage=usage)

    await client.chat(model="m", messages=[{"role": "user", "content": "hi"}])

    assert acc.prompt == 100
    assert acc.completion == 40
    assert acc.total == 140
    assert acc.calls == 1


async def test_embed_records_usage_into_current():
    acc = start_usage()
    # embeddings Usage tem só prompt_tokens e total_tokens (sem completion_tokens)
    usage = SimpleNamespace(prompt_tokens=12, total_tokens=12)
    client = make_client(embed_usage=usage)

    await client.embed(model="m", text="hello")

    assert acc.total == 12
    assert acc.calls == 1
