# app/usage.py
import logging
from contextvars import ContextVar

log = logging.getLogger("chat-service")


class UsageAccumulator:
    def __init__(self):
        self.prompt = 0
        self.completion = 0
        self.total = 0
        self.calls = 0

    def add(self, prompt: int, completion: int, total: int) -> None:
        self.prompt += prompt
        self.completion += completion
        self.total += total
        self.calls += 1


_current: ContextVar[UsageAccumulator | None] = ContextVar("usage_current", default=None)


def start_usage() -> UsageAccumulator:
    acc = UsageAccumulator()
    _current.set(acc)
    return acc


def record_usage(label: str, prompt: int, completion: int, total: int) -> None:
    acc = _current.get()
    if acc is None:
        return
    acc.add(prompt, completion, total)
    log.info("usage[%s] prompt=%d completion=%d total=%d", label, prompt, completion, total)
