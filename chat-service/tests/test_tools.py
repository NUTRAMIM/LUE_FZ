# tests/test_tools.py
import json
from app.agent.tools import buscar_produtos


def _doc(name, category, cores):
    return {"content": name, "similarity": 0.5,
            "metadata": {"name": name, "category": category, "price": 99.9,
                         "tamanhos": ["P", "M"], "cores": cores,
                         "brand": None, "image_url": f"http://x/{name}"}}


async def test_buscar_produtos_includes_all_colors(db, llm):
    db.match_results = [_doc("Top Alça", "top", [f"c{i}" for i in range(10)])]
    out = await buscar_produtos(db, llm, "store-1", "top floral", "top")
    data = json.loads(out)
    assert data[0]["name"] == "Top Alça"
    assert data[0]["cores"] == ", ".join(f"c{i}" for i in range(10))
    assert llm.embed_calls == ["top floral"]


async def test_category_fallback_when_filtered_empty(db, llm):
    # só existe doc na categoria "vestido"; busca por "top" volta vazio e refaz sem categoria
    db.match_results = [_doc("Vestido Longo", "vestido", ["azul"])]
    out = await buscar_produtos(db, llm, "store-1", "algo", "top")
    data = json.loads(out)
    assert len(data) == 1
    assert data[0]["name"] == "Vestido Longo"


async def test_empty_result_returns_empty_list(db, llm):
    db.match_results = []
    out = await buscar_produtos(db, llm, "store-1", "x", "")
    assert json.loads(out) == []


from app.agent.tools import listar_categoria


def _prod(pid, name, category, price=89.9, tamanhos=None, cores=None,
          image_urls=None, is_available=True):
    return {"id": pid, "name": name, "category": category, "price": price,
            "brand": None, "tamanhos": tamanhos if tamanhos is not None else ["P", "M"],
            "cores": cores if cores is not None else ["preto", "branco"],
            "image_urls": image_urls if image_urls is not None else [f"http://img/{pid}.jpg"],
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
