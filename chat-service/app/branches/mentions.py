# app/branches/mentions.py
import re


def _find_matches(text: str, products: list[dict]) -> list[str]:
    buffer = text
    found = []
    for p in products:
        pattern = r"\b" + re.escape(p["name"]) + r"\b"
        if re.search(pattern, buffer, flags=re.IGNORECASE):
            found.append(p["id"])
            buffer = re.sub(pattern, lambda m: " " * len(m.group()),
                            buffer, flags=re.IGNORECASE)
    return found


async def run_mentions(db, ctx) -> None:
    catalog = await db.get_catalog(ctx.store.id)
    products = sorted(
        [p for p in catalog if p.get("id") and p.get("name")],
        key=lambda p: len(p["name"]), reverse=True)

    rows = [(pid, "ai_shown") for pid in _find_matches(ctx.ai_output, products)]
    rows += [(pid, "customer_asked") for pid in _find_matches(ctx.chat_input, products)]

    for product_id, source in rows:
        await db.insert_product_mention(
            ctx.store.id, ctx.conversation_id, product_id, source)
