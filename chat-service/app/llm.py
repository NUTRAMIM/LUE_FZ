# app/llm.py
from openai import AsyncOpenAI
from app.usage import record_usage


def _record(label, usage):
    if usage is None:
        return
    # embeddings usage não tem completion_tokens — só chat completions tem.
    # prompt_tokens_details.cached_tokens indica quantos tokens de input vieram
    # do cache (cobrados ~90% mais barato nos GPT-5) — métrica do ganho do cache.
    details = getattr(usage, "prompt_tokens_details", None)
    cached = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    record_usage(label, getattr(usage, "prompt_tokens", 0) or 0,
                 getattr(usage, "completion_tokens", 0) or 0,
                 getattr(usage, "total_tokens", 0) or 0,
                 cached)


class LLMClient:
    def __init__(self, api_key: str):
        # max_retries acima do default (2): a SDK retenta erros transitórios de
        # conexão (DNS/getaddrinfo, timeouts) com backoff, dando resiliência a
        # blips de rede em produção.
        self._client = AsyncOpenAI(api_key=api_key, max_retries=5)

    async def chat(self, model, messages, tools=None, max_tokens=None,
                   reasoning_effort=None) -> dict:
        kwargs = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        if max_tokens:
            kwargs["max_completion_tokens"] = max_tokens
        # GPT-5 cobra reasoning tokens como output. Em tarefas simples
        # (classificação/extração) "minimal" corta esse custo.
        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
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
