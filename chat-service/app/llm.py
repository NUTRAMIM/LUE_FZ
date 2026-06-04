# app/llm.py
from openai import AsyncOpenAI
from app.usage import record_usage


def _record(label, usage):
    if usage is None:
        return
    # embeddings usage não tem completion_tokens — só chat completions tem
    record_usage(label, getattr(usage, "prompt_tokens", 0) or 0,
                 getattr(usage, "completion_tokens", 0) or 0,
                 getattr(usage, "total_tokens", 0) or 0)


class LLMClient:
    def __init__(self, api_key: str):
        self._client = AsyncOpenAI(api_key=api_key)

    async def chat(self, model, messages, tools=None, max_tokens=None) -> dict:
        kwargs = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        if max_tokens:
            kwargs["max_completion_tokens"] = max_tokens
        resp = await self._client.chat.completions.create(**kwargs)
        _record("chat", getattr(resp, "usage", None))
        msg = resp.choices[0].message
        tool_calls = None
        if msg.tool_calls:
            tool_calls = [{"id": tc.id, "name": tc.function.name,
                           "arguments": tc.function.arguments} for tc in msg.tool_calls]
        return {"content": msg.content, "tool_calls": tool_calls}

    async def embed(self, model, text) -> list[float]:
        resp = await self._client.embeddings.create(
            model=model, input=text, dimensions=1536)
        _record("embed", getattr(resp, "usage", None))
        return resp.data[0].embedding
