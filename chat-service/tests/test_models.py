# tests/test_models.py
import pytest
from pydantic import ValidationError
from app.models import WebhookPayload


def test_webhook_payload_parses_dispatch_shape():
    p = WebhookPayload.model_validate({
        "mensagem": "oi",
        "id_mensagem": "2689acbf-4fcb-42e6-97b2-fb1e1bd67c8d",
        "id_conversa": "92ee6d49-7dad-47f1-99ad-5f2ff13fc818",
        "nome_loja": "Teste",
        "id_loja": "c96ad899-bdaf-4ed4-919d-6f596e0f7db8",
        "tipo_de_mensagem": "text",
    })
    assert p.mensagem == "oi"
    assert p.id_conversa == "92ee6d49-7dad-47f1-99ad-5f2ff13fc818"
    assert p.media_url is None


def test_webhook_payload_requires_mensagem():
    with pytest.raises(ValidationError):
        WebhookPayload.model_validate({
            "id_mensagem": "x", "id_conversa": "y",
            "nome_loja": "z", "id_loja": "w", "tipo_de_mensagem": "text",
        })


def test_webhook_payload_respondendo_a_optional():
    p = WebhookPayload.model_validate({
        "mensagem": "oi", "id_mensagem": "x", "id_conversa": "y",
        "nome_loja": "z", "id_loja": "w", "tipo_de_mensagem": "text",
    })
    assert p.respondendo_a is None


def test_webhook_payload_parses_respondendo_a():
    p = WebhookPayload.model_validate({
        "mensagem": "quero esse", "id_mensagem": "x", "id_conversa": "y",
        "nome_loja": "z", "id_loja": "w", "tipo_de_mensagem": "text",
        "respondendo_a": {
            "id_mensagem": "m1", "autor": "loja",
            "conteudo": "Top Alça R$ 50",
        },
    })
    assert p.respondendo_a.id_mensagem == "m1"
    assert p.respondendo_a.autor == "loja"
    assert p.respondendo_a.conteudo == "Top Alça R$ 50"


from app.models import AgentResult


def test_agent_result_defaults_to_empty_lists():
    r = AgentResult(text="oi")
    assert r.text == "oi"
    assert r.product_segments == []
    assert r.shown_product_ids == []


def test_agent_result_holds_segments_and_ids():
    r = AgentResult(text="fecho", product_segments=["[produto]X[/produto]"],
                    shown_product_ids=["p1", "p2"])
    assert r.product_segments == ["[produto]X[/produto]"]
    assert r.shown_product_ids == ["p1", "p2"]


from app.models import StoreSettings


def test_store_settings_has_service_steps_and_faq_defaults():
    s = StoreSettings(id="x", store_name="Loja")
    assert s.service_steps == []
    assert s.faq == []


def test_store_settings_min_order_enabled_defaults_false():
    s = StoreSettings(id="x", store_name="Loja")
    assert s.min_order_enabled is False


def test_store_settings_accepts_min_order_enabled():
    s = StoreSettings(id="x", store_name="Loja", min_order_enabled=True)
    assert s.min_order_enabled is True


def test_store_settings_accepts_service_steps_and_faq():
    s = StoreSettings(
        id="x", store_name="Loja",
        service_steps=["Pergunte o tamanho", "Ofereça combo"],
        faq=[{"pergunta": "Troca?", "resposta": "Em 7 dias."}],
    )
    assert s.service_steps[0] == "Pergunte o tamanho"
    assert s.faq[0]["resposta"] == "Em 7 dias."
