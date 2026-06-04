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


def _format_price(price) -> str:
    return f"R$ {price:.2f}".replace(".", ",")


def _build_card(p: dict) -> str:
    lines = [p["name"]]
    urls = p.get("image_urls") or []
    if urls:
        lines.append(urls[0])
    if p.get("price") is not None:
        lines.append(_format_price(p["price"]))
    tamanhos = p.get("tamanhos") or []
    if tamanhos:
        lines.append("Tamanhos: " + ", ".join(tamanhos))
    cores = summarize_cores(p.get("cores") or [])
    if cores:
        lines.append("Cores: " + cores)
    body = "\n".join(lines)
    return f"[produto]\n{body}\n[/produto]"


async def listar_categoria(db, store_id: str, categoria: str):
    cat = (categoria or "").strip()
    if not cat:
        return ("", [], "Categoria não informada.")
    rows = await db.get_products_by_category(store_id, cat)
    if not rows:
        return ("", [], f"Nenhuma peça disponível em {cat}.")
    cards = [_build_card(p) for p in rows]
    ids = [p["id"] for p in rows]
    resumo = (f"Mostrei {len(rows)} peças de {cat} ao cliente. "
              "Escreva só uma frase curta de fecho perguntando se quer ver "
              "tamanho ou cor de alguma.")
    return ("\n".join(cards), ids, resumo)
