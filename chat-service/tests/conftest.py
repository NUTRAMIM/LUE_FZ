# tests/conftest.py
import pytest
from app.models import StoreSettings


class FakeDB:
    """Implementa a mesma interface de app.db.Database, em memória."""

    def __init__(self):
        self.window_messages = []          # list[dict(id, content)]
        self.store = None                  # StoreSettings | None
        self.shown_list = ""
        self.recent_messages = []          # list[dict(role, content)]
        self.match_results = []            # list[dict(content, metadata, similarity)]
        self.catalog = []                  # list[dict(id, name)]
        self.category_products = []        # list[dict(id,name,price,brand,tamanhos,cores,image_urls,category,is_available)]
        self.lead = None                   # dict | None
        self.inserted_messages = []
        self.created_leads = []
        self.updated_leads = []
        self.interest_updates = []
        self.inserted_gaps = []
        self.inserted_mentions = []

    async def get_user_messages_in_window(self, conversation_id):
        return list(self.window_messages)

    async def get_store_settings(self, store_id):
        return self.store

    async def get_shown_products(self, conversation_id):
        return self.shown_list

    async def get_recent_messages(self, conversation_id, limit=10):
        return list(self.recent_messages)

    async def match_documents(self, embedding, match_count, user_id, category):
        # honra o filtro de categoria do fake quando setado
        if category:
            return [r for r in self.match_results
                    if (r["metadata"].get("category") or "").lower() == category.lower()]
        return list(self.match_results)

    async def get_catalog(self, store_id):
        return list(self.catalog)

    async def get_products_by_category(self, store_id, category):
        return [p for p in self.category_products
                if (p.get("category") or "").lower() == category.lower()
                and p.get("is_available", True)]

    async def insert_message(self, conversation_id, role, content, store_id=None):
        self.inserted_messages.append(
            {"conversation_id": conversation_id, "role": role, "content": content})

    async def get_lead(self, conversation_id, store_id):
        return self.lead

    async def create_lead(self, **kw):
        self.created_leads.append(kw)

    async def update_lead(self, lead_id, **kw):
        self.updated_leads.append({"id": lead_id, **kw})

    async def update_lead_interest(self, conversation_id, store_id, interest_summary):
        self.interest_updates.append(
            {"conversation_id": conversation_id, "store_id": store_id,
             "interest_summary": interest_summary})

    async def insert_knowledge_gap(self, store_id, conversation_id, question, tag):
        self.inserted_gaps.append(
            {"store_id": store_id, "conversation_id": conversation_id,
             "question": question, "tag": tag})

    async def insert_product_mention(self, store_id, conversation_id, product_id, source):
        self.inserted_mentions.append(
            {"store_id": store_id, "conversation_id": conversation_id,
             "product_id": product_id, "source": source})


class FakeLLM:
    """Fila de respostas pré-programadas para chat(); embed() retorna vetor fixo."""

    def __init__(self):
        self.chat_responses = []   # list[dict]: {"content": str} ou {"tool_calls": [...]}
        self.chat_calls = []
        self.embed_calls = []

    async def chat(self, model, messages, tools=None, max_tokens=None):
        self.chat_calls.append({"messages": messages, "tools": tools})
        return self.chat_responses.pop(0)

    async def embed(self, model, text):
        self.embed_calls.append(text)
        return [0.0] * 1536


@pytest.fixture
def db():
    return FakeDB()


@pytest.fixture
def llm():
    return FakeLLM()


@pytest.fixture
def store():
    return StoreSettings(
        id="store-1",
        store_name="LUE",
        categories=["top", "vestido", "calça"],
        payment_methods=["pix", "cartão"],
        delivery_methods=["correios"],
        service_instructions="Atendimento das 9h às 18h.",
        seller_phone="5511999999999",
        instagram_handle="lue",
    )
