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
