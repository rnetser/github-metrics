"""
Entrypoint for GitHub Metrics service.

Runs database migrations, optional webhook setup, and starts the Uvicorn server.
"""

import asyncio
import subprocess
import sys
from pathlib import Path

import uvicorn

from github_metrics.config import get_config
from github_metrics.webhook_setup import setup_webhooks


def run_database_migrations() -> None:
    """Run Alembic database migrations.

    Applies pending migrations with 'alembic upgrade head'.

    Note: Migrations must be generated manually by developers:
        alembic revision --autogenerate -m "Description"

    Raises:
        SystemExit: If migration fails (fail-fast behavior)
    """
    try:
        alembic_ini = Path(__file__).parent / "alembic.ini"

        print("Applying database migrations...")
        result = subprocess.run(
            ["uv", "run", "alembic", "-c", str(alembic_ini), "upgrade", "head"],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
            cwd=Path(__file__).parent,
        )
        print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        print("Database migrations completed successfully")
    except subprocess.CalledProcessError as e:
        print(f"FATAL: Database migration failed: {e}", file=sys.stderr)
        if e.stdout:
            print(f"stdout: {e.stdout}", file=sys.stderr)
        if e.stderr:
            print(f"stderr: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("FATAL: Database migration timed out after 60 seconds", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"FATAL: Unexpected error during database migration: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    # Run database migrations
    run_database_migrations()

    # Setup webhooks if METRICS_SETUP_WEBHOOK=true
    asyncio.run(setup_webhooks())

    # Load configuration
    config = get_config()

    # Start uvicorn server
    uvicorn.run(
        "github_metrics.app:app",
        host=config.server.host,
        port=config.server.port,
        workers=config.server.workers,
        reload=False,
    )
