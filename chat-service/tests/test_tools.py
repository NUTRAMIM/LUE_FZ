# tests/test_tools.py
from app.agent.tools import (buscar_produtos, registrar_pedido, format_pedido,
                             calcular_valor_total)


def _doc(name, category, cores, image_urls=None, video_url=None, pid="d1"):
    md = {"name": name, "category": category, "price": 99.9,
          "tamanhos": ["P", "M"], "cores": cores, "brand": None,
          "image_url": f"http://x/{name}"}
    if image_urls is not None:
        md["image_urls"] = image_urls
    if video_url is not None:
        md["video_url"] = video_url
    return {"id": pid, "content": name, "similarity": 0.5, "metadata": md}


async def test_buscar_produtos_resolves_product_uuid_by_name(db, llm):
    # match_documents devolve o id do DOCUMENTO (bigint); o id retornado tem que
    # ser o do PRODUTO (uuid), resolvido pelo nome — senão product_mentions quebra
    db.match_results = [_doc("Top Alça", "top", ["rosa"], pid="234396")]  # doc id
    db.product_ids_by_name = {"top alça": "uuid-top-alca"}
    _, ids, _ = await buscar_produtos(db, llm, "store-1", "top", "top")
    assert ids == ["uuid-top-alca"]


async def test_buscar_produtos_builds_cards_with_video_last(db, llm):
    db.match_results = [_doc("Top Alça", "top", ["rosa", "azul"],
                             image_urls=["http://img/a.jpg", "http://img/b.jpg"],
                             video_url="http://vid/a.mp4")]
    db.product_ids_by_name = {"top alça": "d1"}
    segmento, ids, resumo = await buscar_produtos(db, llm, "store-1", "top floral", "top")
    assert ids == ["d1"]
    assert segmento == (
        "[produto]\n"
        "Top Alça\n"
        "http://img/a.jpg\n"
        "http://img/b.jpg\n"
        "http://vid/a.mp4\n"
        "R$ 99,90\n"
        "Tamanhos: P, M\n"
        "Cores: rosa, azul\n"
        "[/produto]"
    )
    assert "Mostrei 1" in resumo
    assert llm.embed_calls == ["top floral"]


async def test_buscar_produtos_falls_back_to_single_image_url(db, llm):
    # quando o metadata não tem image_urls (plural), usa image_url (singular)
    db.match_results = [_doc("Vestido", "vestido", ["azul"])]
    segmento, _, _ = await buscar_produtos(db, llm, "store-1", "algo", "vestido")
    assert "http://x/Vestido" in segmento


async def test_buscar_produtos_no_cross_category_when_filtered_empty(db, llm):
    # categoria foi informada (top) mas só há vestido: NÃO pode vazar pra outra
    # categoria (evita "pedi calcinha, veio sutiã"). Retorna vazio.
    db.match_results = [_doc("Vestido Longo", "vestido", ["azul"])]
    segmento, ids, resumo = await buscar_produtos(db, llm, "store-1", "algo", "top")
    assert segmento == ""
    assert ids == []
    assert "Vestido Longo" not in segmento


async def test_buscar_produtos_empty_returns_empty_segment(db, llm):
    db.match_results = []
    segmento, ids, resumo = await buscar_produtos(db, llm, "store-1", "x", "")
    assert segmento == ""
    assert ids == []
    assert resumo


async def test_buscar_produtos_returns_shown_ids(db, llm):
    # os IDs dos produtos mostrados são devolvidos pra registrar como "ai_shown"
    # e não reaparecerem nas próximas mensagens
    db.match_results = [_doc("Top A", "top", ["rosa"], pid="p1"),
                        _doc("Top B", "top", ["azul"], pid="p2")]
    db.product_ids_by_name = {"top a": "p1", "top b": "p2"}
    _, ids, _ = await buscar_produtos(db, llm, "store-1", "top", "top")
    assert ids == ["p1", "p2"]


async def test_buscar_produtos_excludes_already_shown(db, llm):
    db.match_results = [_doc("Top A", "top", ["rosa"], pid="p1"),
                        _doc("Top B", "top", ["azul"], pid="p2")]
    db.product_ids_by_name = {"top a": "p1", "top b": "p2"}
    segmento, ids, _ = await buscar_produtos(db, llm, "store-1", "top", "top",
                                             exclude_ids=["p1"])
    assert ids == ["p2"]
    assert "Top A" not in segmento


async def test_buscar_produtos_all_shown_returns_suggestion(db, llm):
    db.match_results = [_doc("Top A", "top", ["rosa"], pid="p1")]
    db.product_ids_by_name = {"top a": "p1"}
    segmento, ids, resumo = await buscar_produtos(db, llm, "store-1", "top", "top",
                                                  exclude_ids=["p1"])
    assert segmento == ""
    assert ids == []
    assert "outra categoria" in resumo.lower()


from app.agent.tools import bare_category_target


def test_bare_category_target_plain_name():
    cats = ["Bodies", "Conjuntos"]
    assert bare_category_target(cats, "bodies", "Bodies") == "Bodies"
    assert bare_category_target(cats, "bodies", "") == "Bodies"


def test_bare_category_target_matches_singular_or_plural():
    cats = ["Conjuntos"]
    assert bare_category_target(cats, "conjunto", "") == "Conjuntos"


def test_bare_category_target_more_options_uses_category_arg():
    cats = ["Bodies"]
    assert bare_category_target(cats, "quero ver mais opções", "Bodies") == "Bodies"
    assert bare_category_target(cats, "me mostra mais", "Bodies") == "Bodies"


def test_bare_category_target_more_pieces_of_category():
    cats = ["Bodies"]
    assert bare_category_target(cats, "tem mais peças de bodies?", "") == "Bodies"
    assert bare_category_target(cats, "me mostra o resto dos bodies", "Bodies") == "Bodies"


def test_bare_category_target_none_when_filter_present():
    cats = ["Bodies"]
    assert bare_category_target(cats, "body preto", "Bodies") is None
    assert bare_category_target(cats, "bodies tamanho P", "Bodies") is None


def test_bare_category_target_none_for_unknown_category():
    cats = ["Bodies"]
    assert bare_category_target(cats, "calcinha", "") is None
    assert bare_category_target(cats, "algo qualquer", "") is None


from app.agent.tools import listar_categoria


def _prod(pid, name, category, price=89.9, tamanhos=None, cores=None,
          image_urls=None, is_available=True, video_url=None):
    return {"id": pid, "name": name, "category": category, "price": price,
            "brand": None, "tamanhos": tamanhos if tamanhos is not None else ["P", "M"],
            "cores": cores if cores is not None else ["preto", "branco"],
            "image_urls": image_urls if image_urls is not None else [f"http://img/{pid}.jpg"],
            "video_url": video_url,
            "is_available": is_available}


async def test_listar_categoria_builds_cards_in_order(db):
    db.category_products = [_prod("p1", "Conjunto Alfa", "Conjuntos")]
    segmento, ids, resumo = await listar_categoria(db, "store-1", "Conjuntos")
    assert ids == ["p1"]
    assert segmento == (
        "[produto]\n"
        "Conjunto Alfa\n"
        "http://img/p1.jpg\n"
        "R$ 89,90\n"
        "Tamanhos: P, M\n"
        "Cores: preto, branco\n"
        "[/produto]"
    )
    assert "Conjuntos" in resumo


async def test_listar_categoria_joins_multiple_cards(db):
    db.category_products = [_prod("p1", "A", "Tops"), _prod("p2", "B", "Tops")]
    segmento, ids, _ = await listar_categoria(db, "store-1", "Tops")
    assert ids == ["p1", "p2"]
    assert segmento.count("[produto]") == 2
    assert segmento == (
        "[produto]\nA\nhttp://img/p1.jpg\nR$ 89,90\nTamanhos: P, M\nCores: preto, branco\n[/produto]\n"
        "[produto]\nB\nhttp://img/p2.jpg\nR$ 89,90\nTamanhos: P, M\nCores: preto, branco\n[/produto]"
    )


async def test_listar_categoria_omits_missing_fields(db):
    db.category_products = [_prod("p1", "Sem Tudo", "Tops", price=None,
                                  tamanhos=[], cores=[], image_urls=[])]
    segmento, ids, _ = await listar_categoria(db, "store-1", "Tops")
    assert segmento == "[produto]\nSem Tudo\n[/produto]"


async def test_listar_categoria_is_case_insensitive(db):
    db.category_products = [_prod("p1", "Conjunto", "Conjuntos")]
    segmento, ids, _ = await listar_categoria(db, "store-1", "conjuntos")
    assert ids == ["p1"]


async def test_listar_categoria_caps_at_limit(db, monkeypatch):
    import app.agent.tools as tools_mod
    monkeypatch.setattr(tools_mod.settings, "listar_limit", 15)
    db.category_products = [_prod(f"p{i}", f"Peça {i}", "Tops") for i in range(20)]
    segmento, ids, resumo = await listar_categoria(db, "store-1", "Tops")
    assert len(ids) == 15                       # no máximo 15 por envio
    assert segmento.count("[produto]") == 15
    assert "mais" in resumo.lower()             # avisa que tem mais


async def test_listar_categoria_below_limit_has_no_more(db, monkeypatch):
    import app.agent.tools as tools_mod
    monkeypatch.setattr(tools_mod.settings, "listar_limit", 15)
    db.category_products = [_prod(f"p{i}", f"Peça {i}", "Tops") for i in range(3)]
    _, ids, _ = await listar_categoria(db, "store-1", "Tops")
    assert len(ids) == 3


async def test_listar_categoria_second_page_after_exclusion(db, monkeypatch):
    # com os 15 primeiros já mostrados, o próximo envio traz o restante
    import app.agent.tools as tools_mod
    monkeypatch.setattr(tools_mod.settings, "listar_limit", 15)
    db.category_products = [_prod(f"p{i}", f"Peça {i}", "Tops") for i in range(20)]
    ja_mostrados = [f"p{i}" for i in range(15)]
    _, ids, _ = await listar_categoria(db, "store-1", "Tops", exclude_ids=ja_mostrados)
    assert ids == [f"p{i}" for i in range(15, 20)]   # os 5 restantes


async def test_listar_categoria_ignores_surrounding_whitespace(db):
    # cadastro vem com espaço sobrando na categoria; deve casar mesmo assim
    db.category_products = [_prod("p1", "Body Doll", " BABY DOLL")]
    segmento, ids, _ = await listar_categoria(db, "store-1", "BABY DOLL")
    assert ids == ["p1"]


async def test_listar_categoria_skips_out_of_stock(db):
    db.category_products = [
        _prod("p1", "Em estoque", "Tops"),
        _prod("p2", "Esgotado", "Tops", is_available=False),
    ]
    segmento, ids, _ = await listar_categoria(db, "store-1", "Tops")
    assert ids == ["p1"]
    assert "Esgotado" not in segmento


async def test_listar_categoria_empty_when_no_stock(db):
    db.category_products = []
    segmento, ids, resumo = await listar_categoria(db, "store-1", "Tops")
    assert segmento == ""
    assert ids == []
    assert "Nenhuma" in resumo


async def test_listar_categoria_empty_when_no_category(db):
    segmento, ids, resumo = await listar_categoria(db, "store-1", "  ")
    assert segmento == ""
    assert ids == []


async def test_listar_categoria_card_includes_all_images_for_carousel(db):
    # várias image_urls devem sair em linhas consecutivas pro front formar carrossel
    db.category_products = [_prod("p1", "Multi Fotos", "Tops",
                                  image_urls=["http://img/p1-a.jpg",
                                              "http://img/p1-b.jpg",
                                              "http://img/p1-c.jpg"])]
    segmento, _, _ = await listar_categoria(db, "store-1", "Tops")
    assert segmento == (
        "[produto]\n"
        "Multi Fotos\n"
        "http://img/p1-a.jpg\n"
        "http://img/p1-b.jpg\n"
        "http://img/p1-c.jpg\n"
        "R$ 89,90\n"
        "Tamanhos: P, M\n"
        "Cores: preto, branco\n"
        "[/produto]"
    )


async def test_listar_categoria_includes_all_colors(db):
    db.category_products = [_prod("p1", "Multi", "Tops",
                                  cores=[f"c{i}" for i in range(10)])]
    segmento, _, _ = await listar_categoria(db, "store-1", "Tops")
    assert "Cores: " + ", ".join(f"c{i}" for i in range(10)) in segmento


async def test_listar_categoria_card_appends_video_after_images(db):
    db.category_products = [_prod("p1", "Com Video", "Tops",
                                  image_urls=["http://img/p1-a.jpg", "http://img/p1-b.jpg"],
                                  video_url="http://vid/p1.mp4")]
    segmento, _, _ = await listar_categoria(db, "store-1", "Tops")
    assert segmento == (
        "[produto]\n"
        "Com Video\n"
        "http://img/p1-a.jpg\n"
        "http://img/p1-b.jpg\n"
        "http://vid/p1.mp4\n"
        "R$ 89,90\n"
        "Tamanhos: P, M\n"
        "Cores: preto, branco\n"
        "[/produto]"
    )


async def test_listar_categoria_excludes_already_shown(db):
    db.category_products = [_prod("p1", "A", "Tops"), _prod("p2", "B", "Tops")]
    segmento, ids, _ = await listar_categoria(db, "store-1", "Tops", exclude_ids=["p1"])
    assert ids == ["p2"]
    assert "A\n" not in segmento and "B" in segmento


async def test_listar_categoria_all_shown_suggests_other_category(db):
    db.category_products = [_prod("p1", "A", "Tops")]
    segmento, ids, resumo = await listar_categoria(db, "store-1", "Tops",
                                                   exclude_ids=["p1"])
    assert segmento == ""
    assert ids == []
    low = resumo.lower()
    assert "já mostrou" in low
    assert "outra categoria" in low


async def test_listar_categoria_empty_category_keeps_distinct_message(db):
    # categoria SEM nenhuma peça (não é "tudo já mostrado") mantém msg própria
    db.category_products = []
    segmento, ids, resumo = await listar_categoria(db, "store-1", "Tops",
                                                   exclude_ids=["p1"])
    assert segmento == ""
    assert "Nenhuma peça disponível" in resumo


def test_format_pedido_empty():
    assert format_pedido([]) == "(nenhum item ainda)"


def test_format_pedido_lists_items():
    itens = [
        {"produto": "Cropped rosa", "qtd": 2, "tamanho": "P", "cor": "rosa"},
        {"produto": "Legging", "qtd": 1, "tamanho": "M"},
    ]
    out = format_pedido(itens)
    assert out == "2x Cropped rosa (tam P, cor rosa); 1x Legging (tam M)"


async def test_registrar_pedido_upserts_and_confirms(db):
    itens = [{"produto": "Cropped", "qtd": 2, "tamanho": "P"}]
    out = await registrar_pedido(db, "store-1", "conv-1", itens, "Pix", "Sedex")
    assert db.order_upserts[0]["conversation_id"] == "conv-1"
    assert db.order_upserts[0]["store_id"] == "store-1"
    assert db.order_upserts[0]["pedido"] == [
        {"produto": "Cropped", "qtd": 2, "tamanho": "P", "cor": None, "preco": None}
    ]
    assert db.order_upserts[0]["forma_pagamento"] == "Pix"
    assert db.order_upserts[0]["forma_entrega"] == "Sedex"
    assert "Pix" in out and "Sedex" in out
    # o retorno traz o pedido itemizado completo (estado autoritativo no turno)
    assert "2x Cropped" in out


async def test_registrar_pedido_drops_invalid_items(db):
    itens = [{"produto": "", "qtd": 1}, {"qtd": 3}, {"produto": "Top", "qtd": "x"}]
    await registrar_pedido(db, "store-1", "conv-1", itens, None, None)
    # "" e sem produto são descartados; qtd inválida vira 1
    assert db.order_upserts[0]["pedido"] == [
        {"produto": "Top", "qtd": 1, "tamanho": None, "cor": None, "preco": None}
    ]
    assert db.order_upserts[0]["forma_pagamento"] is None


def test_calcular_valor_total_soma_preco_vezes_qtd():
    itens = [
        {"produto": "Cropped", "qtd": 2, "preco": 50.0},
        {"produto": "Legging", "qtd": 1, "preco": 89.9},
    ]
    assert calcular_valor_total(itens) == 189.9


def test_calcular_valor_total_ignora_itens_sem_preco():
    itens = [
        {"produto": "Cropped", "qtd": 2, "preco": 50.0},
        {"produto": "Brinde", "qtd": 1},
    ]
    assert calcular_valor_total(itens) == 100.0


def test_calcular_valor_total_none_quando_nenhum_preco():
    itens = [{"produto": "Cropped", "qtd": 2}, {"produto": "Top", "qtd": 1}]
    assert calcular_valor_total(itens) is None


def test_calcular_valor_total_vazio():
    assert calcular_valor_total([]) is None


async def test_registrar_pedido_calcula_e_grava_valor_total(db):
    itens = [
        {"produto": "Cropped", "qtd": 2, "preco": 50.0},
        {"produto": "Legging", "qtd": 1, "preco": 89.9},
    ]
    out = await registrar_pedido(db, "store-1", "conv-1", itens, "Pix", "Sedex")
    assert db.order_upserts[0]["valor_total"] == 189.9
    # total formatado em R$ aparece no retorno autoritativo
    assert "R$ 189,90" in out


async def test_registrar_pedido_valor_total_none_sem_preco(db):
    itens = [{"produto": "Cropped", "qtd": 2}]
    out = await registrar_pedido(db, "store-1", "conv-1", itens, None, None)
    assert db.order_upserts[0]["valor_total"] is None
    assert "não definido" in out


async def test_registrar_pedido_completa_preco_pelo_catalogo(db):
    # agente não mandou preço; o catálogo preenche pelo nome exato (case-insensitive)
    db.product_prices = {"cropped rosa": 50.0}
    itens = [{"produto": "Cropped Rosa", "qtd": 2}]
    out = await registrar_pedido(db, "store-1", "conv-1", itens, None, None)
    assert db.order_upserts[0]["pedido"][0]["preco"] == 50.0
    assert db.order_upserts[0]["valor_total"] == 100.0
    assert "R$ 100,00" in out


async def test_registrar_pedido_preco_do_agente_tem_prioridade(db):
    # se o agente já mandou preço, não sobrescreve pelo catálogo
    db.product_prices = {"cropped": 999.0}
    itens = [{"produto": "Cropped", "qtd": 1, "preco": 49.9}]
    await registrar_pedido(db, "store-1", "conv-1", itens, None, None)
    assert db.order_upserts[0]["pedido"][0]["preco"] == 49.9
    assert db.order_upserts[0]["valor_total"] == 49.9
