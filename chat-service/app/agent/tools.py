# app/agent/tools.py
import json
from app.config import settings

KEEP_CORES = 8


def summarize_cores(cores: list[str], keep: int = KEEP_CORES) -> str:
    if not cores:
        return ""
    if len(cores) <= keep:
        return ", ".join(cores)
    visiveis = cores[:keep]
    return f"{', '.join(visiveis)} (+{len(cores) - keep} de {len(cores)})"


async def buscar_produtos(db, llm, store_id: str, consulta: str, category: str) -> str:
    embedding = await llm.embed(settings.embed_model, consulta)
    cat = (category or "").strip()

    rows = await db.match_documents(
        embedding=embedding, match_count=settings.match_count,
        user_id=store_id, category=cat or None)
    if not rows and cat:
        rows = await db.match_documents(
            embedding=embedding, match_count=settings.match_count,
            user_id=store_id, category=None)

    produtos = []
    for r in rows:
        m = r.get("metadata", {})
        produtos.append({
            "name": m.get("name"),
            "price": m.get("price"),
            "category": m.get("category"),
            "brand": m.get("brand"),
            "tamanhos": m.get("tamanhos") or [],
            "cores": summarize_cores(m.get("cores") or []),
            "image_url": m.get("image_url"),
        })
    return json.dumps(produtos, ensure_ascii=False)
