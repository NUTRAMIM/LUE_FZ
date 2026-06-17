# app/models.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal
from pydantic import BaseModel, Field


class RespondendoA(BaseModel):
    id_mensagem: str
    autor: Literal["cliente", "loja"]
    conteudo: str


class WebhookPayload(BaseModel):
    # Teto generoso: mensagens normais de chat ficam muito abaixo. Rejeita
    # payloads absurdos (abuso de custo de tokens / inflar prompt) com 422.
    mensagem: str = Field(max_length=8000)
    id_mensagem: str
    id_conversa: str
    nome_loja: str
    id_loja: str
    tipo_de_mensagem: Literal["text", "image", "audio"]
    media_url: str | None = None
    respondendo_a: RespondendoA | None = None


@dataclass
class Message:
    id: str
    role: str
    content: str


@dataclass
class StoreSettings:
    id: str
    store_name: str
    categories: list[str] = field(default_factory=list)
    payment_methods: list[str] = field(default_factory=list)
    delivery_methods: list[str] = field(default_factory=list)
    service_instructions: str = ""
    seller_phone: str = ""
    instagram_handle: str = ""
    service_steps: list[str] = field(default_factory=list)
    faq: list[dict] = field(default_factory=list)
    min_order_enabled: bool = False
    min_order_quantity: int | None = None
    min_order_value: float | None = None
    min_order_logic: str = "all"
    discount_type: str | None = None
    discount_value: float | None = None
    discount_custom: str = ""


@dataclass
class Product:
    name: str
    price: float | None = None
    category: str | None = None
    brand: str | None = None
    image_url: str | None = None
    tamanhos: list[str] = field(default_factory=list)
    cores: list[str] = field(default_factory=list)


@dataclass
class Lead:
    id: str
    name: str | None = None
    whatsapp: str | None = None
    email: str | None = None
    cep: str | None = None


@dataclass
class BufferResult:
    should_process: bool
    chat_input: str = ""


@dataclass
class Context:
    store: StoreSettings
    conversation_id: str
    chat_input: str
    ai_output: str


@dataclass
class AgentResult:
    text: str
    product_segments: list[str] = field(default_factory=list)
    shown_product_ids: list[str] = field(default_factory=list)
