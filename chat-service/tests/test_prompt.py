# tests/test_prompt.py
import dataclasses
from app.agent.prompt import (build_system_prompt, build_order_state_reminder,
                              build_store_prompt)


def test_atacado_asks_reseller_or_personal_before_carro_chefe(store):
    atacado = dataclasses.replace(store, min_order_enabled=True)
    p = build_store_prompt(atacado)
    # pergunta revenda vs uso próprio ANTES do carro-chefe, atendendo igual
    assert "revender" in p
    assert "uso próprio" in p
    assert p.index("uso próprio") < p.index("carro-chefe")


def test_prompt_includes_store_fields(store):
    p = build_system_prompt(store, shown_list="Top Alça")
    assert "loja LUE" in p
    assert "Categorias: top, vestido, calça" in p
    assert "Pagamento: pix, cartão" in p
    assert "Entrega: correios" in p
    assert "Atendimento das 9h às 18h." in p
    assert "5511999999999" in p
    assert "https://instagram.com/lue" in p
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
    assert "melhor agrupa" in p
    # não pode buscar com categoria vazia quando o cliente nomeou um tipo
    assert "NUNCA chame BUSCAR_PRODUTOS com `category` vazio" in p
    # não pode mais conter os exemplos fixos de loja fitness
    assert "Croppeds" not in p and "Leggings" not in p


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


def test_order_state_lives_only_in_reminder_not_system_prompt(store):
    # Após a raspagem, o estado do pedido NÃO é mais duplicado no system prompt
    # (era o bloco "# Pedido atual"); a fonte única é o build_order_state_reminder.
    lead = {"name": "Ana",
            "pedido": [{"produto": "Cropped", "qtd": 2, "tamanho": "P"}],
            "forma_pagamento": "Pix", "forma_entrega": "Sedex"}
    p = build_system_prompt(store, shown_list="", lead=lead)
    assert "2x Cropped" not in p          # não duplicado no prompt principal
    r = build_order_state_reminder(lead)
    assert "2x Cropped" in r and "Pix" in r and "Sedex" in r


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
    assert "revende" in low
    assert "atacado" in low


def test_prompt_atacado_is_humanized_without_jargon(store):
    p = build_system_prompt(_atacado(store), shown_list="", lead=None)
    low = p.lower()
    assert "carro-chefe" in low
    # o prompt instrui a falar simples, sem termo técnico de atacado
    assert "fale simples" in low
    assert "palavra técnica" in low


def test_prompt_atacado_does_not_ask_city_for_freight(store):
    p = build_system_prompt(_atacado(store), shown_list="", lead=None)
    low = p.lower()
    assert "cidade" not in low
    assert "região" not in low


def test_prompt_atacado_understands_short_carro_chefe(store):
    p = build_system_prompt(_atacado(store), shown_list="", lead=None)
    low = p.lower()
    assert "respond" in low and "curto" in low


def test_prompt_atacado_shows_category_after_carro_chefe(store):
    p = build_system_prompt(_atacado(store), shown_list="", lead=None)
    assert "LISTAR_CATEGORIA" in p
    assert "já mostre" in p.lower()


def test_prompt_atacado_bans_filler_openers(store):
    p = build_system_prompt(_atacado(store), shown_list="", lead=None)
    low = p.lower()
    assert "não comece" in low


def test_prompt_instructs_continuity_not_restart(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    low = p.lower()
    assert "não recomece" in low
    assert "primeiro contato" in low


def test_prompt_atacado_shows_captured_carro_chefe(store):
    lead = {"name": "Bia", "carro_chefe": "calça"}
    p = build_system_prompt(_atacado(store), shown_list="", lead=lead)
    assert "Carro-chefe: calça" in p


def test_prompt_varejo_omits_carro_chefe_line(store):
    p = build_system_prompt(store, shown_list="", lead={"name": "Ana"})
    assert "Carro-chefe:" not in p


def test_prompt_asks_cep_in_both_modes(store):
    varejo = build_system_prompt(store, shown_list="", lead=None)
    atacado = build_system_prompt(_atacado(store), shown_list="", lead=None)
    assert "CEP" in varejo
    assert "CEP" in atacado


def test_prompt_shows_captured_cep(store):
    p = build_system_prompt(store, shown_list="", lead={"name": "Ana", "cep": "01310-100"})
    assert "01310-100" in p


def test_varejo_shares_warm_persona_with_atacado(store):
    # o tom de abertura é o mesmo nos dois modos; só o enquadramento muda
    persona = "vendedora de verdade conversando no WhatsApp"
    varejo = build_store_prompt(store)
    atacado = build_store_prompt(_atacado(store))
    assert persona in varejo
    assert persona in atacado


def test_atacado_prompt_shows_min_order_rule(store):
    s = dataclasses.replace(store, min_order_enabled=True, min_order_quantity=10,
                            min_order_value=200.0, min_order_logic="all")
    p = build_store_prompt(s)
    assert "Pedido mínimo" in p
    assert "10 peças" in p
    assert "R$ 200,00" in p


def test_atacado_min_order_logic_any_uses_ou(store):
    s = dataclasses.replace(store, min_order_enabled=True, min_order_quantity=10,
                            min_order_value=200.0, min_order_logic="any")
    p = build_store_prompt(s)
    assert "10 peças ou R$ 200,00" in p


def test_atacado_min_order_logic_all_uses_e(store):
    s = dataclasses.replace(store, min_order_enabled=True, min_order_quantity=10,
                            min_order_value=200.0, min_order_logic="all")
    p = build_store_prompt(s)
    assert "10 peças e R$ 200,00" in p


def test_atacado_prompt_shows_percent_piece_discount(store):
    s = dataclasses.replace(store, min_order_enabled=True,
                            discount_type="percent_piece", discount_value=10.0)
    p = build_store_prompt(s)
    assert "10% de desconto" in p


def test_atacado_prompt_shows_fixed_piece_discount(store):
    s = dataclasses.replace(store, min_order_enabled=True,
                            discount_type="fixed_piece", discount_value=5.0)
    p = build_store_prompt(s)
    assert "R$ 5,00 de desconto por peça" in p


def test_atacado_custom_discount_uses_text(store):
    s = dataclasses.replace(store, min_order_enabled=True,
                            discount_type="custom", discount_custom="Leve 3 pague 2")
    p = build_store_prompt(s)
    assert "Leve 3 pague 2" in p


def test_varejo_prompt_omits_min_order_and_discount(store):
    # mesmo com dados preenchidos, loja varejo (min_order_enabled=False) não usa
    s = dataclasses.replace(store, min_order_quantity=10,
                            discount_type="percent_piece", discount_value=10.0)
    p = build_store_prompt(s)
    assert "Pedido mínimo" not in p
    assert "desconto" not in p.lower()


def test_atacado_without_rules_omits_block(store):
    p = build_store_prompt(_atacado(store))
    assert "# Regras desta loja (atacado)" not in p
    assert "Pedido mínimo:" not in p
    assert "Desconto:" not in p


def test_order_state_reminder_renders_current_state():
    lead = {"pedido": [{"produto": "Cropped", "qtd": 2, "tamanho": "P"}],
            "forma_pagamento": "Pix", "forma_entrega": "Sedex",
            "valor_total": 199.9}
    r = build_order_state_reminder(lead)
    assert "2x Cropped" in r
    assert "Pix" in r
    assert "Sedex" in r
    assert "199,90" in r
    assert "DESATUALIZADA" in r


def test_order_state_reminder_empty_when_no_lead():
    r = build_order_state_reminder(None)
    assert "(nenhum item ainda)" in r
    assert "(não definido)" in r


def test_order_state_reminder_total_placeholder_when_missing():
    lead = {"pedido": [{"produto": "Cropped", "qtd": 1}]}
    r = build_order_state_reminder(lead)
    assert "Valor total: (não definido)" in r
