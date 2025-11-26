# GitHub Metrics Service Dockerfile
# Lightweight Python image for metrics collection and dashboard

# Build arguments for version pinning (must be in global scope before any FROM)
ARG UV_VERSION=0.5.14

# Create a named stage for uv
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM python:3.13-slim

EXPOSE 8080

ENV HOME_DIR="/app" \
    HOME="/app"
ENV PATH="$HOME_DIR/.local/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    UV_PYTHON=python3.13 \
    UV_COMPILE_BYTECODE=1 \
    UV_NO_SYNC=1

WORKDIR $HOME_DIR

# Install system dependencies
# Note: Exact version pinning for Debian packages would require checking
# the python:3.13-slim repository at build time. For production builds,
# consider using apt-cache policy <package> to find available versions
# and pin to specific versions (e.g., curl=7.88.1-10+deb12u8)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Install uv with pinned version
COPY --from=uv /uv /uvx /usr/local/bin/

# Copy project files
COPY entrypoint.py pyproject.toml uv.lock alembic.ini README.md $HOME_DIR/
COPY github_metrics $HOME_DIR/github_metrics/

# Install dependencies
RUN uv sync --frozen

# Create non-root user and set ownership
RUN groupadd --gid 1000 appuser && \
    useradd --uid 1000 --gid 1000 --no-create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser $HOME_DIR

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl --fail http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["tini", "--", "uv", "run", "entrypoint.py"]
