# tests/test_tools.py
from app.agent.tools import summarize_cores


def test_few_colors_unchanged():
    cores = ["rosa", "branco", "preto"]
    assert summarize_cores(cores) == "rosa, branco, preto"


def test_exactly_eight_unchanged():
    cores = [f"c{i}" for i in range(8)]
    assert summarize_cores(cores) == ", ".join(cores)


def test_many_colors_sampled_with_count():
    cores = [f"c{i}" for i in range(204)]
    out = summarize_cores(cores)
    assert out == "c0, c1, c2, c3, c4, c5, c6, c7 (+196 de 204)"


def test_empty_returns_empty_string():
    assert summarize_cores([]) == ""
