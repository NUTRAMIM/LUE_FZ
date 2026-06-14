# app/usage.py
import logging
from contextvars import ContextVar

log = logging.getLogger("chat-service")


class UsageAccumulator:
    """Acumula tokens de uma requisição, QUEBRADO POR MODELO — pra dar pra
    calcular custo exato depois (mini/nano e input cacheado têm preços bem
    diferentes). As propriedades agregadas (prompt/cached/…) somam tudo, pro
    log e pra retrocompatibilidade."""

    def __init__(self):
        self.by_model: dict[str, dict] = {}

    def add(self, model: str, prompt: int, completion: int, total: int,
            cached: int = 0) -> None:
        m = self.by_model.setdefault(
            model, {"prompt": 0, "completion": 0, "total": 0, "cached": 0, "calls": 0})
        m["prompt"] += prompt
        m["completion"] += completion
        m["total"] += total
        m["cached"] += cached
        m["calls"] += 1

    def _sum(self, key: str) -> int:
        return sum(m[key] for m in self.by_model.values())

    @property
    def prompt(self) -> int:
        return self._sum("prompt")

    @property
    def completion(self) -> int:
        return self._sum("completion")

    @property
    def total(self) -> int:
        return self._sum("total")

    @property
    def cached(self) -> int:
        return self._sum("cached")

    @property
    def calls(self) -> int:
        return self._sum("calls")


_current: ContextVar[UsageAccumulator | None] = ContextVar("usage_current", default=None)


def start_usage() -> UsageAccumulator:
    acc = UsageAccumulator()
    _current.set(acc)
    return acc


def record_usage(label: str, model: str, prompt: int, completion: int,
                 total: int, cached: int = 0) -> None:
    acc = _current.get()
    if acc is None:
        return
    acc.add(model, prompt, completion, total, cached)
    log.info("usage[%s/%s] prompt=%d completion=%d total=%d cached=%d",
             label, model, prompt, completion, total, cached)
