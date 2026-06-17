# app/agent/tools.py
import re
import unicodedata

from app.config import settings

# Palavras de "encheção" que aparecem num pedido de categoria inteira e NÃO são
# filtro (cor/tamanho/preço). Se, tirando a categoria e essas palavras, não
# sobra nada, o pedido é a categoria inteira → LISTAR_CATEGORIA.
_FILLER = {
    "quero", "ver", "mais", "opcoes", "opcao", "opções", "opção", "me", "mostra",
    "mostrar", "mostre", "todos", "todas", "todo", "toda", "o", "os", "a", "as",
    "de", "do", "da", "dos", "das", "e", "quais", "tem", "teem", "vcs", "voces", "queria",
    "gostaria", "uns", "umas", "alguns", "algumas", "pra", "para", "por", "favor",
    "oi", "ola", "ai", "hoje", "tambem", "outras", "outros", "outra", "outro",
    "alguma", "algum", "ainda", "que", "pecas", "peca", "resto", "novidade",
    "novidades", "modelos", "modelo",
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]", " ", s.lower())


def _category_forms(label: str) -> set:
    # casa a categoria no singular e no plural simples (conjunto/conjuntos)
    n = _norm(label).strip()
    forms = {n}
    if n.endswith("s"):
        forms.add(n[:-1])
    else:
        forms.add(n + "s")
    return forms


def bare_category_target(categories, consulta: str, category: str):
    """Se a chamada de BUSCAR_PRODUTOS for, na verdade, um pedido de categoria
    INTEIRA sem filtro (ex.: "bodies", "quero ver mais opções" com a categoria no
    arg), devolve o rótulo EXATO da categoria da loja a ser listada. Senão, None.
    Rede de segurança determinística: não depende do modelo escolher LISTAR."""
    form_to_label = {}
    for label in categories or []:
        for f in _category_forms(label):
            form_to_label[f] = label

    target = form_to_label.get(_norm(category).strip())
    tokens = [t for t in _norm(consulta).split() if t and t not in _FILLER]

    leftover = []
    for t in tokens:
        label = form_to_label.get(t)
        if label and (target is None or label == target):
            target = target or label
            continue
        leftover.append(t)

    return target if (target and not leftover) else None


async def buscar_produtos(db, llm, store_id: str, consulta: str, category: str,
                          exclude_ids=None):
    embedding = await llm.embed(settings.embed_model, consulta)
    cat = (category or "").strip()

    # Busca SEMPRE restrita à categoria pedida (vinda das categorias do
    # store_settings). Sem fallback para o catálogo inteiro: misturar categorias
    # fazia "pedi calcinha, veio sutiã". Se a categoria esgotar, o agente é
    # instruído (no prompt) a tentar a próxima categoria da loja.
    raw = await db.match_documents(
        embedding=embedding, match_count=settings.match_count,
        user_id=store_id, category=cat or None)

    if not raw:
        return ("", [], "Não encontrei peças para esse pedido. Peça ao cliente "
                "mais detalhes (cor, tamanho ou ocasião) numa frase curta.")

    # match_documents devolve o id do DOCUMENTO (bigint), não o id do produto.
    # Resolvemos o UUID do produto pelo NOME (estável) — é esse id que vai pra
    # product_mentions e pra exclusão de já-mostrados.
    name_to_id = await db.get_product_ids_by_name(store_id)
    exclude = {str(x) for x in (exclude_ids or [])}

    cards, ids, mostrou = [], [], 0
    for r in raw:
        m = r.get("metadata", {}) or {}
        pid = name_to_id.get((m.get("name") or "").strip().lower())
        if pid and pid in exclude:
            continue   # já mostrado nesta conversa
        imgs = m.get("image_urls")
        if not imgs:
            single = m.get("image_url")
            imgs = [single] if single else []
        cards.append(_build_card({
            "name": m.get("name"),
            "price": m.get("price"),
            "tamanhos": m.get("tamanhos") or [],
            "cores": m.get("cores") or [],
            "image_urls": imgs,
            "video_url": m.get("video_url"),
        }))
        mostrou += 1
        if pid:
            ids.append(pid)

    if not cards:
        return ("", [], "Essas peças você já mostrou nesta conversa. NÃO repita "
                "nenhuma. Diga, numa frase leve, que por enquanto é só isso, e "
                "sugira pelo NOME uma outra categoria parecida da loja (sem mostrar "
                "fotos por conta própria).")

    resumo = (f"Mostrei {mostrou} peças ao cliente. Escreva só uma frase curta "
              "de fecho perguntando se quer ver tamanho ou cor de alguma.")
    return ("\n".join(cards), ids, resumo)


def _format_price(price) -> str:
    return f"R$ {price:.2f}".replace(".", ",")


def _build_card(p: dict) -> str:
    lines = [p["name"]]
    urls = p.get("image_urls") or []
    # todas as URLs em linhas consecutivas -> o front agrupa num carrossel
    lines.extend(urls)
    video = p.get("video_url")
    if video:
        lines.append(video)
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


async def listar_categoria(db, store_id: str, categoria: str, exclude_ids=None):
    cat = (categoria or "").strip()
    if not cat:
        return ("", [], "Categoria não informada.")
    rows = await db.get_products_by_category(store_id, cat)
    if not rows:
        return ("", [], f"Nenhuma peça disponível em {cat}.")
    # Tira o que já foi mostrado nesta conversa pra não reenviar a categoria toda.
    exclude = {str(x) for x in (exclude_ids or [])}
    novos = [p for p in rows if str(p["id"]) not in exclude]
    if not novos:
        return ("", [], (f"Você já mostrou TODAS as peças de {cat} nesta conversa. "
                f"NÃO repita nenhuma. Diga ao cliente, numa frase leve, que por "
                f"enquanto é só isso em {cat}, e sugira pelo NOME uma outra categoria "
                f"parecida da loja (sem mostrar fotos por conta própria)."))
    # Teto por envio: manda no máximo `listar_limit`. O resto fica pra um próximo
    # "ver mais" (a exclusão de já-mostrados pagina sozinha).
    tem_mais = len(novos) > settings.listar_limit
    mostrados = novos[:settings.listar_limit]
    cards = [_build_card(p) for p in mostrados]
    ids = [str(p["id"]) for p in mostrados]
    if tem_mais:
        resumo = (f"Mostrei {len(mostrados)} peças de {cat} (ainda tem MAIS nessa "
                  "categoria). Escreva uma frase curta de fecho avisando que tem mais, "
                  "se ele quiser ver é só pedir.")
    else:
        resumo = (f"Mostrei {len(mostrados)} peças de {cat} ao cliente. Escreva uma "
                  "frase curta de fecho e, se fizer sentido, sugira pelo NOME uma outra "
                  "categoria que combine (só o nome, sem mostrar fotos por conta própria).")
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
