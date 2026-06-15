# app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    openai_api_key: str = ""
    webhook_secret: str = ""
    chat_model: str = "gpt-5-mini"          # foreground: conversa + tool-calling
    # reasoning_effort do agente foreground. None = comportamento atual (default
    # do modelo). O agente gasta ~8k reasoning tokens/conversa (cobrados como
    # output a $2/1M) — "low"/"minimal" cortam isso, mas afetam tool-calling, então
    # só mude após o A/B (scripts/ab_foreground_effort.py). Env: FOREGROUND_REASONING_EFFORT.
    foreground_reasoning_effort: str | None = None
    # Background: classificação de gap e resumo de interesse. Tarefas simples →
    # modelo barato. Sobrescrevível por env (BACKGROUND_MODEL) no EasyPanel.
    background_model: str = "gpt-5-nano"
    # Extração de lead (nome/telefone) é o coração do SaaS e já regrediu com
    # modelo mais fraco (gpt-5.4-mini). Fica separada do resto do background:
    # default mini, e só vai pra nano por env (LEAD_MODEL) após validação A/B.
    lead_model: str = "gpt-5-mini"
    embed_model: str = "text-embedding-3-small"
    buffer_wait_seconds: float = 7.0
    match_count: int = 6
    # Rounds máximos de tool no loop do agente. 3 cobre buscar/listar→registrar→
    # responder; cada round reenvia o prompt, então não inflar. Env: MAX_TOOL_ROUNDS.
    max_tool_rounds: int = 3


settings = Settings()
