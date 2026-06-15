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


async def test_chat_records_cached_tokens():
    acc = start_usage()
    # a OpenAI devolve cached_tokens dentro de prompt_tokens_details nos GPT-5
    details = SimpleNamespace(cached_tokens=1536)
    usage = SimpleNamespace(prompt_tokens=2000, completion_tokens=50, total_tokens=2050,
                            prompt_tokens_details=details)
    client = make_client(chat_usage=usage)

    await client.chat(model="m", messages=[{"role": "user", "content": "hi"}])

    assert acc.prompt == 2000
    assert acc.cached == 1536


async def test_chat_cached_defaults_zero_without_details():
    acc = start_usage()
    usage = SimpleNamespace(prompt_tokens=100, completion_tokens=40, total_tokens=140)
    client = make_client(chat_usage=usage)

    await client.chat(model="m", messages=[{"role": "user", "content": "hi"}])

    assert acc.cached == 0


async def test_chat_passes_reasoning_effort_through():
    captured = {}

    class CapturingCompletions:
        async def create(self, **kwargs):
            captured.update(kwargs)
            msg = SimpleNamespace(content="ok", tool_calls=None)
            return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=None)

    client = LLMClient(api_key="test")
    client._client = SimpleNamespace(
        chat=SimpleNamespace(completions=CapturingCompletions()))

    await client.chat(model="m", messages=[], reasoning_effort="minimal")
    assert captured["reasoning_effort"] == "minimal"

    captured.clear()
    await client.chat(model="m", messages=[])
    assert "reasoning_effort" not in captured


async def test_chat_passes_response_format_through():
    captured = {}

    class _Stub:
        class chat:
            class completions:
                @staticmethod
                async def create(**kwargs):
                    captured.update(kwargs)
                    class _M: content = "{}"; tool_calls = None
                    class _C: message = _M()
                    class _R: choices = [_C()]; usage = None
                    return _R()

    from app.llm import LLMClient
    client = LLMClient("k")
    client._client = _Stub()
    rf = {"type": "json_schema", "json_schema": {"name": "x", "strict": True,
          "schema": {"type": "object", "additionalProperties": False,
                     "properties": {}, "required": []}}}
    await client.chat(model="m", messages=[], response_format=rf)
    assert captured["response_format"] == rf

    captured.clear()
    await client.chat(model="m", messages=[])
    assert "response_format" not in captured


async def test_embed_records_usage_into_current():
    acc = start_usage()
    # embeddings Usage tem só prompt_tokens e total_tokens (sem completion_tokens)
    usage = SimpleNamespace(prompt_tokens=12, total_tokens=12)
    client = make_client(embed_usage=usage)

    await client.embed(model="m", text="hello")

    assert acc.total == 12
    assert acc.calls == 1
