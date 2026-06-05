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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db, _llm
    _db = await Database.create(settings.database_url)
    _llm = LLMClient(settings.openai_api_key)
    yield
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
    return {"ok": True}
