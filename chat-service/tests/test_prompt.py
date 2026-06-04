# tests/test_prompt.py
from app.agent.prompt import build_system_prompt


def test_prompt_includes_store_fields(store):
    p = build_system_prompt(store, shown_list="Top Alça")
    assert "Assistente da loja LUE" in p
    assert "Categorias: top, vestido, calça" in p
    assert "Pagamento: pix, cartão" in p
    assert "Entrega: correios" in p
    assert "Atendimento das 9h às 18h." in p
    assert "5511999999999" in p
    assert "@lue" in p
    assert "Top Alça" in p


def test_prompt_shown_list_placeholder_when_empty(store):
    p = build_system_prompt(store, shown_list="")
    assert "(nenhum)" in p


def test_prompt_instructs_produto_tags(store):
    p = build_system_prompt(store, shown_list="")
    assert "[produto]" in p
    assert "[/produto]" in p


def test_prompt_documents_listar_categoria_tool(store):
    p = build_system_prompt(store, shown_list="")
    assert "LISTAR_CATEGORIA" in p


def test_prompt_scopes_three_product_cap_to_buscar(store):
    p = build_system_prompt(store, shown_list="")
    assert "Máximo 3 produtos por mensagem ao usar BUSCAR_PRODUTOS" in p


def test_prompt_instructs_category_synonym_mapping(store):
    p = build_system_prompt(store, shown_list="")
    assert "categoria existente mais próxima" in p


def test_prompt_has_tool_routing_decision(store):
    p = build_system_prompt(store, shown_list="")
    assert "decida pela intenção do cliente" in p
