# tests/test_runner.py
import json
from app.agent import runner
from app.agent.runner import (run_agent, TOOL_NAME, LISTAR_TOOL_NAME,
                              REGISTRAR_TOOL_NAME)


async def test_returns_text_without_tool_call(db, llm, store):
    llm.chat_responses = [{"content": "oi, tudo bem?"}]
    out = await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    assert out.text == "oi, tudo bem?"
    assert out.product_segments == []
    assert out.shown_product_ids == []


async def test_executes_tool_then_returns_text(db, llm, store):
    db.match_results = [{"content": "Top", "similarity": 0.5,
                         "metadata": {"name": "Top Alça", "category": "top",
                                      "price": 50, "tamanhos": ["P"], "cores": ["rosa"],
                                      "brand": None, "image_url": "http://x"}}]
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "top azul", "category": "top"})}]},
        {"content": "achei isso: Top Alça"},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="quero top azul", history=[])
    assert out.text == "achei isso: Top Alça"
    second_call_msgs = llm.chat_calls[1]["messages"]
    assert any(m.get("role") == "tool" for m in second_call_msgs)


async def test_replayed_tool_calls_use_openai_shape(db, llm, store):
    db.match_results = [{"content": "Top", "similarity": 0.5,
                         "metadata": {"name": "Top Alça", "category": "top",
                                      "price": 50, "tamanhos": ["P"], "cores": ["rosa"],
                                      "brand": None, "image_url": "http://x"}}]
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "top azul", "category": "top"})}]},
        {"content": "achei isso: Top Alça"},
    ]
    await run_agent(llm, db, store, shown_list="", chat_input="quero top azul", history=[])
    second_call_msgs = llm.chat_calls[1]["messages"]
    assistant_msg = next(m for m in second_call_msgs if m.get("role") == "assistant")
    tc = assistant_msg["tool_calls"][0]
    assert tc["type"] == "function"
    assert tc["function"]["name"] == TOOL_NAME
    assert tc["function"]["arguments"] == json.dumps({"consulta": "top azul", "category": "top"})
    assert "name" not in tc


import dataclasses


async def test_buscar_with_bare_category_redirects_to_listar(db, llm, store):
    # "bodies" pelado: mostra a categoria INTEIRA (listar), não 3 via buscar
    s = dataclasses.replace(store, categories=["bodies", "conjuntos"])
    db.category_products = [
        {"id": f"p{i}", "name": f"Body {i}", "category": "bodies", "price": 44.0,
         "brand": None, "tamanhos": ["U"], "cores": ["bege"],
         "image_urls": [f"http://img/p{i}.jpg"], "is_available": True}
        for i in range(1, 6)
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "bodies", "category": "bodies"})}]},
        {"content": "esses são os bodies!"},
    ]
    out = await run_agent(llm, db, s, shown_list="", chat_input="bodies", history=[])
    assert out.shown_product_ids == ["p1", "p2", "p3", "p4", "p5"]
    assert out.product_segments[0].count("[produto]") == 5
    # não passou por busca semântica
    assert llm.embed_calls == []


async def test_buscar_more_options_redirects_to_listar(db, llm, store):
    # "quero ver mais opções" com a categoria no arg vira categoria inteira
    s = dataclasses.replace(store, categories=["bodies"])
    db.category_products = [
        {"id": "p1", "name": "Body 1", "category": "bodies", "price": 44.0,
         "brand": None, "tamanhos": ["U"], "cores": ["bege"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
        {"id": "p2", "name": "Body 2", "category": "bodies", "price": 44.0,
         "brand": None, "tamanhos": ["U"], "cores": ["preto"],
         "image_urls": ["http://img/p2.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "quero ver mais opções",
                                                  "category": "bodies"})}]},
        {"content": "tem esses também!"},
    ]
    out = await run_agent(llm, db, s, shown_list="", chat_input="quero ver mais opções",
                          history=[])
    assert out.shown_product_ids == ["p1", "p2"]
    assert llm.embed_calls == []


async def test_buscar_with_filter_does_not_redirect(db, llm, store):
    # com filtro real (cor), continua na busca semântica (não vira listar)
    s = dataclasses.replace(store, categories=["bodies"])
    db.match_results = [{"id": "999", "content": "Body Preto", "similarity": 0.5,
                         "metadata": {"name": "Body Preto", "category": "bodies",
                                      "price": 44.0, "tamanhos": ["U"], "cores": ["preto"],
                                      "brand": None, "image_urls": ["http://img/p9.jpg"]}}]
    db.product_ids_by_name = {"body preto": "p9"}
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "body preto",
                                                  "category": "bodies"})}]},
        {"content": "achei esse preto!"},
    ]
    out = await run_agent(llm, db, s, shown_list="", chat_input="body preto", history=[])
    assert out.shown_product_ids == ["p9"]
    assert llm.embed_calls == ["body preto"]   # passou pela busca semântica


async def test_listar_again_when_all_shown_does_not_resend(db, llm, store):
    # categoria inteira já mostrada antes: não reenvia, orienta a sugerir outra
    s = dataclasses.replace(store, categories=["bodies"])
    db.category_products = [
        {"id": "p1", "name": "Body 1", "category": "bodies", "price": 44.0,
         "brand": None, "tamanhos": ["U"], "cores": ["bege"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": LISTAR_TOOL_NAME,
                         "arguments": json.dumps({"categoria": "bodies"})}]},
        {"content": "por ora é só isso em bodies, quer ver conjuntos?"},
    ]
    out = await run_agent(llm, db, s, shown_list="Body 1",
                          chat_input="me mostra mais bodies", history=[],
                          shown_ids=["p1"])
    assert out.product_segments == []         # NÃO reenviou os cards
    assert out.shown_product_ids == []
    tool_msg = next(m for m in llm.chat_calls[1]["messages"] if m.get("role") == "tool")
    assert "já mostrou" in tool_msg["content"].lower()


async def test_more_options_when_all_shown_does_not_resend(db, llm, store):
    # "mais opções" (redirect p/ listar) com tudo já mostrado também não reenvia
    s = dataclasses.replace(store, categories=["bodies"])
    db.category_products = [
        {"id": "p1", "name": "Body 1", "category": "bodies", "price": 44.0,
         "brand": None, "tamanhos": ["U"], "cores": ["bege"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "quero ver mais opções",
                                                  "category": "bodies"})}]},
        {"content": "é só isso por enquanto, quer ver outra?"},
    ]
    out = await run_agent(llm, db, s, shown_list="Body 1",
                          chat_input="quero ver mais opções", history=[],
                          shown_ids=["p1"])
    assert out.product_segments == []
    assert llm.embed_calls == []


async def test_listar_categoria_collects_segments_and_ids(db, llm, store):
    db.category_products = [
        {"id": "p1", "name": "Conjunto A", "category": "Conjuntos", "price": 99.9,
         "brand": None, "tamanhos": ["P"], "cores": ["preto"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": LISTAR_TOOL_NAME,
                         "arguments": json.dumps({"categoria": "Conjuntos"})}]},
        {"content": "Esses são nossos conjuntos! Quer ver algum?"},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="me mostra os conjuntos",
                          history=[])
    assert out.text == "Esses são nossos conjuntos! Quer ver algum?"
    assert out.shown_product_ids == ["p1"]
    assert len(out.product_segments) == 1
    assert "[produto]" in out.product_segments[0]
    tool_msg = next(m for m in llm.chat_calls[1]["messages"] if m.get("role") == "tool")
    assert "[produto]" not in tool_msg["content"]
    assert "Mostrei 1 peças de Conjuntos" in tool_msg["content"]


async def test_listar_categoria_no_stock_collects_nothing(db, llm, store):
    db.category_products = []
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": LISTAR_TOOL_NAME,
                         "arguments": json.dumps({"categoria": "Inexistente"})}]},
        {"content": "Não temos peças nessa categoria agora."},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="me mostra X", history=[])
    assert out.product_segments == []
    assert out.shown_product_ids == []
    assert out.text == "Não temos peças nessa categoria agora."


async def test_all_tools_offered_to_llm(db, llm, store):
    llm.chat_responses = [{"content": "oi"}]
    await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    tool_names = {t["function"]["name"] for t in llm.chat_calls[0]["tools"]}
    assert tool_names == {TOOL_NAME, LISTAR_TOOL_NAME, REGISTRAR_TOOL_NAME}


async def test_registrar_pedido_tool_is_routed(db, llm, store):
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": REGISTRAR_TOOL_NAME,
                         "arguments": json.dumps({
                             "itens": [{"produto": "Cropped", "qtd": 1, "tamanho": "P"}],
                             "forma_pagamento": "Pix", "forma_entrega": "Sedex"})}]},
        {"content": "Anotado! Um vendedor te chama."},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="quero fechar",
                          history=[], conversation_id="conv-1")
    assert out.text == "Anotado! Um vendedor te chama."
    assert db.order_upserts[0]["conversation_id"] == "conv-1"
    assert db.order_upserts[0]["forma_pagamento"] == "Pix"
    tool_msg = next(m for m in llm.chat_calls[1]["messages"] if m.get("role") == "tool")
    assert "Pedido atualizado" in tool_msg["content"]


async def test_lead_passed_into_system_prompt(db, llm, store):
    llm.chat_responses = [{"content": "oi Maria!"}]
    await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[],
                    conversation_id="conv-1", lead={"name": "Maria"})
    # o lead vai no bloco dinâmico (não no prefixo estático cacheável), então
    # procura em qualquer mensagem de sistema, não necessariamente na primeira.
    system_contents = [m["content"] for m in llm.chat_calls[0]["messages"]
                       if m["role"] == "system"]
    assert any("Maria" in c for c in system_contents)


async def test_static_prompt_is_first_and_has_no_tenant_data(db, llm, store):
    # o prefixo cacheável (1ª mensagem) deve ser 100% global — sem dado de loja
    # nem de lead, senão o cache quebra e há risco multi-tenant.
    llm.chat_responses = [{"content": "oi"}]
    await run_agent(llm, db, store, shown_list="Top Alça", chat_input="oi", history=[],
                    conversation_id="conv-1", lead={"name": "Maria", "whatsapp": "5511988887777"})
    first = llm.chat_calls[0]["messages"][0]
    assert first["role"] == "system"
    assert "Maria" not in first["content"]
    assert "5511988887777" not in first["content"]
    assert store.store_name not in first["content"]
    assert "Top Alça" not in first["content"]


async def test_foreground_reasoning_effort_default_is_none(db, llm, store):
    llm.chat_responses = [{"content": "oi"}]
    await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    assert llm.chat_calls[0]["reasoning_effort"] is None


async def test_foreground_reasoning_effort_is_passed_when_set(db, llm, store, monkeypatch):
    from app.agent import runner
    monkeypatch.setattr(runner.settings, "foreground_reasoning_effort", "low")
    llm.chat_responses = [{"content": "oi"}]
    await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    assert llm.chat_calls[0]["reasoning_effort"] == "low"


async def test_order_state_reminder_injected_right_before_user(db, llm, store):
    llm.chat_responses = [{"content": "seu pedido é 1x Legging"}]
    lead = {"pedido": [{"produto": "Legging", "qtd": 1, "tamanho": "M"}],
            "forma_pagamento": "Pix", "forma_entrega": None}
    await run_agent(
        llm, db, store, shown_list="", chat_input="qual meu pedido?",
        history=[{"role": "assistant", "content": "você pediu 3x Top rosa"}],
        conversation_id="conv-1", lead=lead)
    msgs = llm.chat_calls[0]["messages"]
    # a última mensagem é a do cliente; a imediatamente anterior é o lembrete de estado
    assert msgs[-1]["role"] == "user"
    reminder = msgs[-2]
    assert reminder["role"] == "system"
    assert "1x Legging" in reminder["content"]
    assert "Pix" in reminder["content"]
    # o lembrete vem DEPOIS do histórico (vence a ancoragem na conversa)
    assert msgs.index(reminder) > 1


async def test_tool_rounds_capped_by_settings(db, llm, store, monkeypatch):
    monkeypatch.setattr(runner.settings, "max_tool_rounds", 3)
    # responde sempre com uma tool call -> nunca encerra pelo conteúdo
    tool_resp = {"tool_calls": [{"id": "1", "name": "LISTAR_CATEGORIA",
                                 "arguments": json.dumps({"categoria": "Tops"})}]}
    llm.chat_responses = [dict(tool_resp) for _ in range(3)] + [{"content": "fim"}]
    await runner.run_agent(llm, db, store, "(nenhum)", "oi", [])
    # 3 rounds no loop + 1 chamada final fora do loop = 4
    assert len(llm.chat_calls) == 4


async def test_registrar_tool_schema_tem_valor_com_desconto(db, llm, store):
    from app.agent.runner import TOOL_SCHEMA_REGISTRAR
    props = TOOL_SCHEMA_REGISTRAR["function"]["parameters"]["properties"]
    assert "valor_com_desconto" in props
    assert props["valor_com_desconto"]["type"] == "number"


async def test_registrar_pedido_repassa_valor_com_desconto(db, llm, store):
    # loja com desconto custom; a LLM manda o total já com desconto
    store.discount_type = "custom"
    store.discount_custom = "5% acima de 10 peças"
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": "REGISTRAR_PEDIDO",
                         "arguments": '{"itens": [{"produto": "Top", "qtd": 20, '
                                      '"preco": 5.0}], "valor_com_desconto": 95.0}'}]},
        {"content": "Fechado!"},
    ]
    await run_agent(llm, db, store, shown_list="", chat_input="pode fechar",
                    history=[], conversation_id="conv-1")
    assert db.order_upserts[0]["valor_total"] == 95.0
    assert db.order_upserts[0]["desconto_aplicado"] == 5.0
