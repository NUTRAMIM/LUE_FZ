# app/agent/tools.py
import json

KEEP_CORES = 8


def summarize_cores(cores: list[str], keep: int = KEEP_CORES) -> str:
    if not cores:
        return ""
    if len(cores) <= keep:
        return ", ".join(cores)
    visiveis = cores[:keep]
    return f"{', '.join(visiveis)} (+{len(cores) - keep} de {len(cores)})"
