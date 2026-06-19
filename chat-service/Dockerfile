FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir .
COPY app ./app
# Roda como usuário sem privilégio: se houver RCE no app, o atacante não é root
# no container. Não muda nada funcional (porta 8000 > 1024, não precisa de root).
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
# Shell-form para expandir $PORT (Railway/Render/Cloud Run injetam porta dinâmica);
# cai em 8000 quando não definido (EasyPanel/local).
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
