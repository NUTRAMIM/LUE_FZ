# app/buffer.py
from app.models import BufferResult


async def resolve_window(db, conversation_id, my_message_id, original_input) -> BufferResult:
    items = await db.get_user_messages_in_window(conversation_id)
    if not items:
        return BufferResult(should_process=True, chat_input=original_input)

    latest = items[-1]
    if latest["id"] != my_message_id:
        return BufferResult(should_process=False)

    joined = "\n".join(m["content"] for m in items)
    return BufferResult(should_process=True, chat_input=joined)
