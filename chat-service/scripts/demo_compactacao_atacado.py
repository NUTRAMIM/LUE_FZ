#!/usr/bin/env python
"""Demonstra a economia do _compact_shown_cards numa conversa de atacado.
Sem API, sem secrets — só mede o tamanho do histórico enviado ao agente,
com vs sem compactação, usando a função REAL do pipeline.

Uso: python -m scripts.demo_compactacao_atacado
"""
try:
    import tiktoken
    _enc = tiktoken.get_encoding("o200k_base")
    def ntok(s): return len(_enc.encode(s))
    UNIT = "tokens (tiktoken o200k_base)"
except Exception:
    def ntok(s): return max(1, len(s) // 4)
    UNIT = "tokens (estimativa ~chars/4)"

from app.pipeline import _compact_shown_cards


def card(i: int) -> str:
    return (f"[produto]\nConjunto Fitness Modelo {i}\nR$ {79 + i},90\n"
            f"Tamanhos: P, M, G, GG\nCores: preto, rosa, areia\n"
            f"https://loja.exemplo/produto/{i}\n[/produto]")


def dump(n: int) -> str:
    return "\n".join(card(i) for i in range(1, n + 1))


# Conversa de atacado: carro-chefe (despejo 1) + 2ª categoria (despejo 2),
# ~35 cards cada (metade de um catálogo de 70).
history = [
    {"role": "user", "content": "oi, tudo bem?"},
    {"role": "assistant", "content": "Oi! Qual o carro-chefe da sua loja?"},
    {"role": "user", "content": "trabalho com moda fitness"},
    {"role": "assistant", "content": dump(35)},              # despejo 1 (antigo)
    {"role": "assistant", "content": "São esses! Quer ver tamanhos?"},
    {"role": "user", "content": "me mostra os shorts também"},
    {"role": "assistant", "content": dump(35)},              # despejo 2 (mais recente)
    {"role": "assistant", "content": "Esses são os shorts!"},
    {"role": "user", "content": "quanto sai no total?"},
]

orig = sum(ntok(m["content"]) for m in history)
comp = sum(ntok(m["content"]) for m in _compact_shown_cards(history))
red = orig - comp

print(f"unidade: {UNIT}")
print(f"cards por despejo: 35  |  despejos na janela: 2")
print(f"historico SEM compactacao: {orig} tokens")
print(f"historico COM compactacao: {comp} tokens  (mantem o despejo mais recente)")
print(f"reducao por turno enviado: {red} tokens ({100 * red / orig:.0f}%)")

# Esse historico e reenviado em CADA chamada foreground. Estimativa de economia
# no input nao-cacheado (pior caso / cache frio) a $0.25/1M:
print(f"\n~economia por chamada foreground (input nao-cacheado @ $0.25/1M): "
      f"${red * 0.25 / 1e6:.5f}")
print(f"~se reenviado em ~6 chamadas/conversa: ${red * 6 * 0.25 / 1e6:.5f}/conversa")
print(f"~a 50 conversas/dia (30d): ${red * 6 * 0.25 / 1e6 * 50 * 30:.2f}/mes  "
      f"(R$ {red * 6 * 0.25 / 1e6 * 50 * 30 * 5.5:.2f})")
print("\nObs: limite superior (cache frio). Com cache quente a economia em $ e "
      "menor, mas a reducao de tokens reenviados e a mesma — e o ganho real "
      "aparece justamente nos picos de cache frio (lojista some e volta).")
