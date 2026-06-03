# app/llm.py
from openai import AsyncOpenAI


class LLMClient:
    def __init__(self, api_key: str):
        self._client = AsyncOpenAI(api_key=api_key)

    async def chat(self, model, messages, tools=None, max_tokens=None) -> dict:
        kwargs = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        if max_tokens:
            kwargs["max_tokens"] = max_tokens
        resp = await self._client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        tool_calls = None
        if msg.tool_calls:
            tool_calls = [{"id": tc.id, "name": tc.function.name,
                           "arguments": tc.function.arguments} for tc in msg.tool_calls]
        return {"content": msg.content, "tool_calls": tool_calls}

    async def embed(self, model, text) -> list[float]:
        resp = await self._client.embeddings.create(
            model=model, input=text, dimensions=1536)
        return resp.data[0].embedding
