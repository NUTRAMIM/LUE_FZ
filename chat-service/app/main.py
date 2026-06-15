# app/main.py
import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Header, HTTPException, Response
from app.config import settings
from app.models import WebhookPayload
from app.pipeline import process_message
from app.db import Database
from app.llm import LLMClient

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chat-service")

_db: Database | None = None
_llm: LLMClient | None = None
_db_error: str | None = None
_llm_error: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db, _llm, _db_error, _llm_error
    try:
        _llm = LLMClient(settings.openai_api_key)
    except Exception as exc:
        _llm_error = f"{type(exc).__name__}: {exc}"
        log.exception("llm init failed at startup")
    try:
        _db = await Database.create(settings.database_url)
    except Exception as exc:
        _db_error = f"{type(exc).__name__}: {exc}"
        log.exception("database connect failed at startup")
    yield
    if _db is not None:
        await _db.close()


app = FastAPI(lifespan=lifespan)


async def _run(payload: WebhookPayload):
    try:
        await process_message(_db, _llm, payload)
    except Exception:
        log.exception("process_message crashed")


def schedule_processing(payload: WebhookPayload):
    asyncio.create_task(_run(payload))


@app.post("/chat", status_code=202)
async def chat(
    payload: WebhookPayload,
    x_webhook_secret: str | None = Header(default=None),
):
    # Endpoint público: se um secret estiver configurado, exige que o caller
    # (Next.js, via N8N_WEBHOOK_SECRET) envie o mesmo valor. Sem secret, fica
    # aberto — útil em dev/local.
    if settings.webhook_secret:
        if x_webhook_secret is None or not hmac.compare_digest(
            x_webhook_secret, settings.webhook_secret
        ):
            raise HTTPException(status_code=401, detail="invalid webhook secret")
    schedule_processing(payload)
    return Response(status_code=202)


@app.get("/health")
async def health():
    # Endpoint sem auth: devolve só status booleano. Os detalhes de erro
    # (_db_error/_llm_error, que podem conter trechos de DSN/mensagens da OpenAI)
    # ficam só nos logs do servidor (log.exception no lifespan), não na resposta.
    return {
        "ok": _db is not None and _llm is not None,
        "db": "connected" if _db is not None else "error",
        "llm": "ready" if _llm is not None else "error",
    }
