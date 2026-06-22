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
                "nenhuma. Diga, numa frase leve, que NÃO TEM MAIS peças dessa "
                "categoria, e sugira pelo NOME uma outra categoria QUE TENHA ESTOQUE "
                "(veja a lista de categorias com estoque; sem mostrar fotos).")

    resumo = (f"Mostrei {mostrou} peças ao cliente. Escreva só uma frase curta "
              "de fecho perguntando se quer ver tamanho ou cor de alguma.")
    return ("\n".join(cards), ids, resumo)


def _format_price(price) -> str:
    return f"R$ {price:.2f}".replace(".", ",")


def _is_http_url(u) -> bool:
    # cadastro às vezes traz URL de imagem incompleta (ex.: ".webp"), que o chat
    # não consegue renderizar. Só manda link http(s) de verdade.
    return isinstance(u, str) and u.strip().lower().startswith(("http://", "https://"))


# Ordem canônica de tamanho de roupa (P antes de M antes de G...). Tamanho
# numérico ordena por número; desconhecido vai pro fim.
_SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XG", "XGG", "G1", "G2", "G3", "G4",
               "UNICO", "U", "UN", "UNI"]
_SIZE_RANK = {s: i for i, s in enumerate(_SIZE_ORDER)}


def _norm_token(s) -> str:
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return t.strip().strip(":").strip().upper().replace(" ", "")


def _size_key(t):
    n = _norm_token(t)
    if n in _SIZE_RANK:
        return (0, _SIZE_RANK[n], "")
    if n.isdigit():
        return (1, int(n), "")
    return (2, 0, n)


def _is_tamanho_garbage(c) -> bool:
    # cor cujo valor é literalmente "tamanho" (lixo do cadastro) -> cor única
    return _norm_token(c) == "TAMANHO"


def _build_card(p: dict) -> str:
    lines = [p["name"]]
    # só URLs válidas; lixo/parcial é descartado pra não virar imagem quebrada
    urls = [u for u in (p.get("image_urls") or []) if _is_http_url(u)]
    # todas as URLs em linhas consecutivas -> o front agrupa num carrossel
    lines.extend(urls)
    video = p.get("video_url")
    if _is_http_url(video):
        lines.append(video)
    if p.get("price") is not None:
        lines.append(_format_price(p["price"]))
    tamanhos = p.get("tamanhos") or []
    if tamanhos:
        lines.append("Tamanhos: " + ", ".join(sorted(tamanhos, key=_size_key)))
    cores_raw = [c for c in (p.get("cores") or []) if c]
    cores_limpas = [c for c in cores_raw if not _is_tamanho_garbage(c)]
    if cores_limpas:
        lines.append("Cores: " + ", ".join(cores_limpas))
    elif cores_raw:
        # tinha cor, mas o valor era "Tamanho" (lixo) -> cor única
        lines.append("Cor única")
    body = "\n".join(lines)
    return f"[produto]\n{body}\n[/produto]"


async def listar_categoria(db, store_id: str, categoria: str, exclude_ids=None):
    cat = (categoria or "").strip()
    if not cat:
        return ("", [], "Categoria não informada.")
    rows = await db.get_products_by_category(store_id, cat)
    if not rows:
        return ("", [], (f"Não tem peça de {cat} em estoque agora. Diga, numa frase "
                f"leve, que não tem {cat} disponível no momento, e sugira pelo NOME "
                f"uma outra categoria QUE TENHA ESTOQUE (veja a lista; sem fotos)."))
    # Tira o que já foi mostrado nesta conversa pra não reenviar a categoria toda.
    exclude = {str(x) for x in (exclude_ids or [])}
    novos = [p for p in rows if str(p["id"]) not in exclude]
    if not novos:
        return ("", [], (f"Você já mostrou TODAS as peças de {cat} nesta conversa. "
                f"NÃO repita nenhuma. Diga ao cliente, numa frase leve, que NÃO TEM "
                f"MAIS peças de {cat}, e sugira pelo NOME uma outra categoria QUE "
                f"TENHA ESTOQUE (veja a lista de categorias com estoque; sem fotos)."))
    # Teto por envio: manda no máximo `listar_limit`. O resto fica pra um próximo
    # "ver mais" (a exclusão de já-mostrados pagina sozinha).
    tem_mais = len(novos) > settings.listar_limit
    mostrados = novos[:settings.listar_limit]
    cards = [_build_card(p) for p in mostrados]
    ids = [str(p["id"]) for p in mostrados]
    if tem_mais:
        resumo = (f"Mostrei {len(mostrados)} peças de {cat} (ainda tem MAIS nessa "
                  "categoria). Escreva uma frase curta de fecho avisando que tem mais "
                  "nessa categoria E perguntando se ela quer ver mais de {cat} ou de "
                  "OUTRA categoria (cite pelo nome 1-2 outras categorias da loja que "
                  "combinem).").replace("{cat}", cat)
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


def _norm_name(s) -> str:
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", t).strip().lower()


async def _fill_missing_prices(db, store_id, norm) -> None:
    # quando o agente não informa o preço, completa pelo catálogo. Casa o nome
    # de forma robusta (sem acento, espaços normalizados); se não casar exato,
    # tenta o produto cujo nome contém TODAS as palavras do item — só usa quando
    # é único (não chuta preço se houver ambiguidade). Assim o total fecha por
    # código mesmo quando a LLM encurta/varia o nome da peça.
    if all(it.get("preco") is not None for it in norm):
        return
    precos = await db.get_product_prices(store_id)
    norm_map = {_norm_name(name): price for name, price in precos.items()}
    for it in norm:
        if it.get("preco") is not None:
            continue
        key = _norm_name(it["produto"])
        price = norm_map.get(key)
        if price is None and key:
            tokens = set(key.split())
            cands = {p for n, p in norm_map.items()
                     if tokens and tokens.issubset(set(n.split()))}
            if len(cands) == 1:
                price = next(iter(cands))
        it["preco"] = price


def calcular_valor_total(itens) -> float | None:
    norm = _normalize_itens(itens)
    precos = [it["preco"] * it["qtd"] for it in norm if it.get("preco") is not None]
    if not precos:
        return None
    return round(sum(precos), 2)


def minimo_atacado_atingido(store, itens) -> bool:
    """True se o pedido bate o mínimo de atacado configurado na loja.
    Sem mínimo configurado, retorna True (não há barreira para o desconto)."""
    norm = _normalize_itens(itens)
    qtd_total = sum(it["qtd"] for it in norm)
    valor_bruto = calcular_valor_total(norm) or 0.0
    minq = store.min_order_quantity
    minv = store.min_order_value
    if not minq and not minv:
        return True
    cond_qtd = (not minq) or (qtd_total >= minq)
    cond_val = (not minv) or (valor_bruto >= minv)
    if (store.min_order_logic or "all") == "all":
        return cond_qtd and cond_val
    return cond_qtd or cond_val


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
