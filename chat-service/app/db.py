# app/db.py
import json
import asyncpg


class Database:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    @classmethod
    async def create(cls, dsn: str) -> "Database":
        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
        return cls(pool)

    async def close(self):
        await self._pool.close()

    async def get_user_messages_in_window(self, conversation_id):
        rows = await self._pool.fetch(
            """SELECT id::text, content FROM messages
               WHERE conversation_id = $1 AND role = 'user'
                 AND created_at >= now() - interval '8 seconds'
               ORDER BY created_at ASC""", conversation_id)
        return [dict(r) for r in rows]

    async def get_store_settings(self, store_id):
        from app.models import StoreSettings
        r = await self._pool.fetchrow(
            """SELECT id::text, store_name, categories, payment_methods,
                      delivery_methods, service_instructions, seller_phone,
                      instagram_handle, service_steps, faq, min_order_enabled
               FROM store_settings WHERE id = $1""", store_id)
        if r is None:
            return None
        faq = r["faq"]
        if isinstance(faq, str):
            faq = json.loads(faq)
        return StoreSettings(
            id=r["id"], store_name=r["store_name"],
            categories=list(r["categories"] or []),
            payment_methods=list(r["payment_methods"] or []),
            delivery_methods=list(r["delivery_methods"] or []),
            service_instructions=r["service_instructions"] or "",
            seller_phone=r["seller_phone"] or "",
            instagram_handle=r["instagram_handle"] or "",
            service_steps=list(r["service_steps"] or []),
            faq=list(faq or []),
            min_order_enabled=bool(r["min_order_enabled"]))

    async def get_shown_products(self, conversation_id):
        r = await self._pool.fetchrow(
            """SELECT COALESCE(string_agg(DISTINCT p.name, ', '), '') AS shown_list
               FROM product_mentions pm JOIN products p ON p.id = pm.product_id
               WHERE pm.conversation_id = $1 AND pm.source = 'ai_shown'""",
            conversation_id)
        return r["shown_list"] if r else ""

    async def get_recent_messages(self, conversation_id, limit=10):
        rows = await self._pool.fetch(
            """SELECT role, content FROM messages
               WHERE conversation_id = $1
               ORDER BY created_at DESC LIMIT $2""", conversation_id, limit)
        return [dict(r) for r in rows]

    async def match_documents(self, embedding, match_count, user_id, category):
        flt = {"user_id": user_id}
        if category:
            flt["category"] = category
        vec = "[" + ",".join(str(x) for x in embedding) + "]"
        rows = await self._pool.fetch(
            "SELECT id, content, metadata, similarity FROM match_documents($1::vector, $2, $3::jsonb, 0.3)",
            vec, match_count, json.dumps(flt))
        out = []
        for r in rows:
            md = r["metadata"]
            out.append({"content": r["content"],
                        "metadata": json.loads(md) if isinstance(md, str) else md,
                        "similarity": r["similarity"]})
        return out

    async def get_catalog(self, store_id):
        rows = await self._pool.fetch(
            "SELECT id::text, name FROM products WHERE user_id = $1", store_id)
        return [dict(r) for r in rows]

    async def get_product_prices(self, store_id):
        rows = await self._pool.fetch(
            "SELECT name, price FROM products WHERE user_id = $1 AND price IS NOT NULL",
            store_id)
        return {r["name"].strip().lower(): float(r["price"])
                for r in rows if r["name"]}

    async def get_products_by_category(self, store_id, category):
        rows = await self._pool.fetch(
            """SELECT id::text, name, price, brand, tamanhos, cores, image_urls
               FROM products
               WHERE user_id = $1 AND lower(category) = lower($2)
                 AND is_available = true
               ORDER BY name""", store_id, category)
        return [dict(r) for r in rows]

    async def insert_message(self, conversation_id, role, content, store_id=None):
        await self._pool.execute(
            """INSERT INTO messages (conversation_id, role, content, message_type)
               VALUES ($1, $2, $3, 'text')""", conversation_id, role, content)

    async def get_lead(self, conversation_id, store_id):
        r = await self._pool.fetchrow(
            """SELECT id::text, name, whatsapp, email, cep,
                      tipo_cliente, carro_chefe,
                      pedido, forma_pagamento, forma_entrega, valor_total
               FROM leads
               WHERE conversation_id = $1 AND store_id = $2 LIMIT 1""",
            conversation_id, store_id)
        if not r:
            return None
        d = dict(r)
        pedido = d.get("pedido")
        if isinstance(pedido, str):
            d["pedido"] = json.loads(pedido)
        elif pedido is None:
            d["pedido"] = []
        return d

    async def create_lead(self, conversation_id, store_id, name, whatsapp,
                          email, cep, tipo_cliente="varejo", carro_chefe=None,
                          source="chat"):
        await self._pool.execute(
            """INSERT INTO leads (conversation_id, store_id, name, whatsapp,
                                  email, cep, tipo_cliente, carro_chefe, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
            conversation_id, store_id, name, whatsapp, email, cep,
            tipo_cliente, carro_chefe, source)

    async def update_lead(self, lead_id, name, whatsapp, email, cep,
                          tipo_cliente="varejo", carro_chefe=None):
        await self._pool.execute(
            """UPDATE leads SET name=$2, whatsapp=$3, email=$4, cep=$5,
                                tipo_cliente=$6, carro_chefe=$7,
                                last_seen_at=now() WHERE id=$1""",
            lead_id, name, whatsapp, email, cep, tipo_cliente, carro_chefe)

    async def update_lead_interest(self, conversation_id, store_id, interest_summary):
        await self._pool.execute(
            """UPDATE leads SET interest_summary=$3
               WHERE conversation_id=$1 AND store_id=$2""",
            conversation_id, store_id, interest_summary)

    async def upsert_lead_order(self, conversation_id, store_id, pedido,
                                forma_pagamento, forma_entrega, valor_total=None):
        await self._pool.execute(
            """INSERT INTO leads (conversation_id, store_id, pedido,
                                  forma_pagamento, forma_entrega, valor_total, source)
               VALUES ($1, $2, $3::jsonb, $4, $5, $6, 'chat')
               ON CONFLICT (conversation_id) DO UPDATE SET
                 pedido = EXCLUDED.pedido,
                 forma_pagamento = COALESCE(EXCLUDED.forma_pagamento, leads.forma_pagamento),
                 forma_entrega   = COALESCE(EXCLUDED.forma_entrega, leads.forma_entrega),
                 valor_total     = EXCLUDED.valor_total,
                 last_seen_at = now()""",
            conversation_id, store_id, json.dumps(pedido),
            forma_pagamento, forma_entrega, valor_total)

    async def insert_knowledge_gap(self, store_id, conversation_id, question, tag):
        await self._pool.execute(
            """INSERT INTO knowledge_gaps (store_id, conversation_id, question, tag)
               VALUES ($1, $2, $3, $4)""", store_id, conversation_id, question, tag)

    async def insert_product_mention(self, store_id, conversation_id, product_id, source):
        await self._pool.execute(
            """INSERT INTO product_mentions (store_id, conversation_id, product_id, source)
               VALUES ($1, $2, $3, $4)""", store_id, conversation_id, product_id, source)
