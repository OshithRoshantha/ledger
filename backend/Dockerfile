FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
RUN useradd --create-home --uid 10001 ledger

COPY pyproject.toml ./
COPY app ./app
RUN pip install .

USER ledger
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/api/v1/health' % os.environ.get('PORT','8000'), timeout=4).status == 200 else 1)"

# PORT is set by Render (and defaults to 8000 under docker-compose).
# 2 async workers is plenty for one user on a small instance.
CMD exec gunicorn app.main:app \
    --worker-class uvicorn_worker.UvicornWorker \
    --workers "${WEB_CONCURRENCY:-2}" \
    --bind "0.0.0.0:${PORT:-8000}" \
    --forwarded-allow-ips "*" \
    --timeout 60 \
    --access-logfile -
