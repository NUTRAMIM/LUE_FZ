# tests/test_tools.py
from app.agent.tools import summarize_cores


def test_few_colors_unchanged():
    cores = ["rosa", "branco", "preto"]
    assert summarize_cores(cores) == "rosa, branco, preto"


def test_exactly_eight_unchanged():
    cores = [f"c{i}" for i in range(8)]
    assert summarize_cores(cores) == ", ".join(cores)


def test_many_colors_sampled_with_count():
    cores = [f"c{i}" for i in range(204)]
    out = summarize_cores(cores)
    assert out == "c0, c1, c2, c3, c4, c5, c6, c7 (+196 de 204)"


def test_empty_returns_empty_string():
    assert summarize_cores([]) == ""


# tests/test_tools.py  (append)
import json
from app.agent.tools import buscar_produtos


def _doc(name, category, cores):
    return {"content": name, "similarity": 0.5,
            "metadata": {"name": name, "category": category, "price": 99.9,
                         "tamanhos": ["P", "M"], "cores": cores,
                         "brand": None, "image_url": f"http://x/{name}"}}


async def test_buscar_produtos_summarizes_colors(db, llm):
    db.match_results = [_doc("Top Alça", "top", [f"c{i}" for i in range(10)])]
    out = await buscar_produtos(db, llm, "store-1", "top floral", "top")
    data = json.loads(out)
    assert data[0]["name"] == "Top Alça"
    assert data[0]["cores"] == "c0, c1, c2, c3, c4, c5, c6, c7 (+2 de 10)"
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
