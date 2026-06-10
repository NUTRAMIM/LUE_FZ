# tests/test_prompt.py
from app.agent.prompt import build_system_prompt, build_order_state_reminder


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


import dataclasses


def test_prompt_injects_lead_name_when_present(store):
    p = build_system_prompt(store, shown_list="", lead={"name": "Maria"})
    assert "Maria" in p


def test_prompt_lead_name_empty_when_no_lead(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    # não deve aparecer a chave literal não-substituída
    assert "{{nome_lead}}" not in p


def test_prompt_shows_captured_contact_fields(store):
    lead = {"name": "Ana", "whatsapp": "5511988887777", "email": "ana@x.com"}
    p = build_system_prompt(store, shown_list="", lead=lead)
    assert "5511988887777" in p
    assert "ana@x.com" in p
    assert "não peça de novo" in p or "NUNCA peça de novo" in p


def test_prompt_marks_uncaptured_contact_fields(store):
    p = build_system_prompt(store, shown_list="", lead={"name": "Ana"})
    # whatsapp/email ausentes ficam marcados como não capturados
    assert "(não capturado)" in p


def test_prompt_shows_current_order_state(store):
    lead = {"name": "Ana",
            "pedido": [{"produto": "Cropped", "qtd": 2, "tamanho": "P"}],
            "forma_pagamento": "Pix", "forma_entrega": "Sedex"}
    p = build_system_prompt(store, shown_list="", lead=lead)
    assert "2x Cropped" in p
    assert "Pix" in p
    assert "Sedex" in p


def test_prompt_order_placeholder_when_empty(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "(nenhum item ainda)" in p


def test_prompt_includes_store_service_steps(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "Confirme o tamanho antes de fechar" in p


def test_prompt_includes_store_faq(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "Fazem troca?" in p
    assert "Sim, em até 7 dias." in p


def test_prompt_omits_steps_and_faq_when_store_has_none(store):
    bare = dataclasses.replace(store, service_steps=[], faq=[])
    p = build_system_prompt(bare, shown_list="", lead=None)
    assert "Etapas específicas desta loja" not in p
    assert "Perguntas frequentes" not in p


def test_prompt_documents_registrar_pedido_and_payment_question(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "REGISTRAR_PEDIDO" in p
    assert "forma de pagamento" in p
    assert "forma de entrega" in p


def _atacado(store):
    return dataclasses.replace(store, min_order_enabled=True)


def test_prompt_varejo_has_no_reseller_persona(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "revendedor" not in p.lower()


def test_prompt_atacado_treats_customer_as_reseller(store):
    p = build_system_prompt(_atacado(store), shown_list="", lead=None)
    low = p.lower()
    assert "revendedor" in low
    assert "atacado" in low


def test_prompt_atacado_uses_wholesale_jargon(store):
    p = build_system_prompt(_atacado(store), shown_list="", lead=None)
    low = p.lower()
    assert "carro-chefe" in low
    assert "margem" in low
    assert "grade" in low
    assert "pronta-entrega" in low


def test_prompt_atacado_asks_qualification(store):
    p = build_system_prompt(_atacado(store), shown_list="", lead=None)
    low = p.lower()
    assert "revenda ou consumo" in low
    assert "cidade" in low


def test_prompt_asks_cep_in_both_modes(store):
    varejo = build_system_prompt(store, shown_list="", lead=None)
    atacado = build_system_prompt(_atacado(store), shown_list="", lead=None)
    assert "CEP" in varejo
    assert "CEP" in atacado


def test_prompt_shows_captured_cep(store):
    p = build_system_prompt(store, shown_list="", lead={"name": "Ana", "cep": "01310-100"})
    assert "01310-100" in p


def test_order_state_reminder_renders_current_state():
    lead = {"pedido": [{"produto": "Cropped", "qtd": 2, "tamanho": "P"}],
            "forma_pagamento": "Pix", "forma_entrega": "Sedex"}
    r = build_order_state_reminder(lead)
    assert "2x Cropped" in r
    assert "Pix" in r
    assert "Sedex" in r
    assert "DESATUALIZADA" in r


def test_order_state_reminder_empty_when_no_lead():
    r = build_order_state_reminder(None)
    assert "(nenhum item ainda)" in r
    assert "(não definido)" in r
