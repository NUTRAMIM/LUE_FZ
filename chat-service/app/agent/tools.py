# app/agent/tools.py
import json
from app.config import settings


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
            "cores": ", ".join(m.get("cores") or []),
            "image_url": m.get("image_url"),
        })
    return json.dumps(produtos, ensure_ascii=False)


def _format_price(price) -> str:
    return f"R$ {price:.2f}".replace(".", ",")


def _build_card(p: dict) -> str:
    lines = [p["name"]]
    urls = p.get("image_urls") or []
    # todas as URLs em linhas consecutivas -> o front agrupa num carrossel
    lines.extend(urls)
    if p.get("price") is not None:
        lines.append(_format_price(p["price"]))
    tamanhos = p.get("tamanhos") or []
    if tamanhos:
        lines.append("Tamanhos: " + ", ".join(tamanhos))
    cores = ", ".join(p.get("cores") or [])
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


def _normalize_itens(itens) -> list:
    norm = []
    for it in itens or []:
        if not isinstance(it, dict):
            continue
        produto = (it.get("produto") or "").strip()
        if not produto:
            continue
        try:
            qtd = int(it.get("qtd", 1))
        except (TypeError, ValueError):
            qtd = 1
        norm.append({
            "produto": produto,
            "qtd": qtd,
            "tamanho": it.get("tamanho") or None,
            "cor": it.get("cor") or None,
            "preco": it.get("preco") if isinstance(it.get("preco"), (int, float)) else None,
        })
    return norm


async def _fill_missing_prices(db, store_id, norm) -> None:
    # quando o agente não informa o preço, completa pelo nome exato do catálogo
    if all(it.get("preco") is not None for it in norm):
        return
    precos = await db.get_product_prices(store_id)
    for it in norm:
        if it.get("preco") is None:
            it["preco"] = precos.get(it["produto"].strip().lower())


def calcular_valor_total(itens) -> float | None:
    norm = _normalize_itens(itens)
    precos = [it["preco"] * it["qtd"] for it in norm if it.get("preco") is not None]
    if not precos:
        return None
    return round(sum(precos), 2)


def format_pedido(itens) -> str:
    norm = _normalize_itens(itens)
    if not norm:
        return "(nenhum item ainda)"
    partes = []
    for it in norm:
        base = f"{it['qtd']}x {it['produto']}"
        extras = []
        if it.get("tamanho"):
            extras.append(f"tam {it['tamanho']}")
        if it.get("cor"):
            extras.append(f"cor {it['cor']}")
        if extras:
            base += " (" + ", ".join(extras) + ")"
        partes.append(base)
    return "; ".join(partes)


async def registrar_pedido(db, store_id: str, conversation_id: str,
                           itens, forma_pagamento, forma_entrega) -> str:
    norm = _normalize_itens(itens)
    await _fill_missing_prices(db, store_id, norm)
    pag = (forma_pagamento or "").strip() or None
    ent = (forma_entrega or "").strip() or None
    total = calcular_valor_total(norm)
    await db.upsert_lead_order(
        conversation_id=conversation_id, store_id=store_id,
        pedido=norm, forma_pagamento=pag, forma_entrega=ent,
        valor_total=total)
    total_str = _format_price(total) if total is not None else "não definido"
    return (
        "Pedido atualizado. ESTADO ATUAL (fonte da verdade, responda com base "
        f"exatamente nisto): Itens: {format_pedido(norm)}. "
        f"Total: {total_str}. "
        f"Pagamento: {pag or 'não definido'}. Entrega: {ent or 'não definido'}.")
