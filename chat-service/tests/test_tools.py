# tests/test_tools.py
from app.agent.tools import buscar_produtos, registrar_pedido, format_pedido


def _doc(name, category, cores, image_urls=None, video_url=None):
    md = {"name": name, "category": category, "price": 99.9,
          "tamanhos": ["P", "M"], "cores": cores, "brand": None,
          "image_url": f"http://x/{name}"}
    if image_urls is not None:
        md["image_urls"] = image_urls
    if video_url is not None:
        md["video_url"] = video_url
    return {"content": name, "similarity": 0.5, "metadata": md}


async def test_buscar_produtos_builds_cards_with_video_last(db, llm):
    db.match_results = [_doc("Top Alça", "top", ["rosa", "azul"],
                             image_urls=["http://img/a.jpg", "http://img/b.jpg"],
                             video_url="http://vid/a.mp4")]
    segmento, ids, resumo = await buscar_produtos(db, llm, "store-1", "top floral", "top")
    assert ids == []
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


async def test_buscar_produtos_category_fallback_when_filtered_empty(db, llm):
    db.match_results = [_doc("Vestido Longo", "vestido", ["azul"])]
    segmento, _, _ = await buscar_produtos(db, llm, "store-1", "algo", "top")
    assert "Vestido Longo" in segmento


async def test_buscar_produtos_empty_returns_empty_segment(db, llm):
    db.match_results = []
    segmento, ids, resumo = await buscar_produtos(db, llm, "store-1", "x", "")
    assert segmento == ""
    assert ids == []
    assert resumo


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
