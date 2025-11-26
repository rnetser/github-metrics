# GitHub Metrics Service Dockerfile
# Lightweight Python image for metrics collection and dashboard

FROM python:3.13-slim

EXPOSE 8080

ENV HOME_DIR="/app"
ENV PATH="$HOME_DIR/.local/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    UV_PYTHON=python3.13 \
    UV_COMPILE_BYTECODE=1 \
    UV_NO_SYNC=1

WORKDIR $HOME_DIR

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Copy project files
COPY entrypoint.py pyproject.toml uv.lock alembic.ini README.md $HOME_DIR/
COPY github_metrics $HOME_DIR/github_metrics/

# Install dependencies
RUN uv sync --frozen

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl --fail http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["tini", "--", "uv", "run", "entrypoint.py"]
