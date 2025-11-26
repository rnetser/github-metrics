# CLAUDE.md

## Internal API Philosophy

**CRITICAL: This is a self-contained metrics service, NOT a public Python module.**

### Backward Compatibility Policy

**NO backward compatibility required for internal APIs:**

- Internal methods in `github_metrics/` can change freely
- Return types can change (e.g., `Any` → `bool`)
- Method signatures can be modified without deprecation
- No version pinning or deprecation warnings needed

**Backward compatibility ONLY for:**

- Environment variable names (METRICS\_\*)
- REST API endpoints (/api/metrics/\*)
- Webhook payload handling (must follow GitHub webhook spec)

**Rationale:**

- This service is deployed as a single container
- All code is updated together - no external dependencies
- Internal refactoring is safe and encouraged
- Optimize for performance and clarity, not compatibility

### Anti-Defensive Programming

**CRITICAL: Eliminate unnecessary defensive programming overhead.**

**Philosophy:**

- This service fails-fast on startup if critical dependencies are missing
- Required parameters in `__init__()` are ALWAYS provided
- Checking for None on required parameters is pure overhead
- Defensive checks are ONLY acceptable for truly optional parameters
- **Fail-fast is better than hiding bugs with fake data**

---

## WHEN Defensive Checks Are ACCEPTABLE

### 1. Destructors (`__del__`)

**Reason:** Can be called during failed initialization

```python
# ✅ CORRECT - __del__ can be called before __init__ completes
def __del__(self):
    if hasattr(self, "logger"):  # Legitimate - may not exist yet
        self.logger.debug("Cleanup")
```

### 2. Optional Parameters

**Reason:** Parameter explicitly allows None

```python
# ✅ CORRECT - start_time/end_time are optional in API
async def get_metrics(
    start_time: datetime | None = None,
    end_time: datetime | None = None
):
    if start_time:  # Legitimate check - parameter is optional
        query += " AND created_at >= $1"
```

### 3. Lazy Initialization

**Reason:** Attribute explicitly starts as None

```python
# ✅ CORRECT - pool starts as None by design
def __init__(self):
    self.pool: asyncpg.Pool | None = None  # Starts uninitialized

async def connect(self):
    if self.pool is None:  # Legitimate - lazy initialization
        self.pool = await asyncpg.create_pool(...)
```

---

## WHEN Defensive Checks Are VIOLATIONS

### 1. Required Parameters in `__init__()`

**VIOLATION:** Checking for attributes that are ALWAYS provided

```python
# ❌ WRONG - config is required parameter, ALWAYS provided
def __init__(self, config: MetricsConfig, logger: logging.Logger):
    self.config = config

def some_method(self):
    if self.config:  # VIOLATION - config is always present
        value = self.config.database.host

# ✅ CORRECT
def some_method(self):
    value = self.config.database.host  # No check needed
```

### 2. Webhook Payload Fields

**VIOLATION:** Checking for fields that are ALWAYS in GitHub webhooks

GitHub webhook format is stable:

- `sender` always exists in webhook payloads
- `repository.full_name` always exists
- `X-GitHub-Delivery` header always exists

```python
# ❌ WRONG - sender always exists in GitHub webhook
sender = payload.get("sender", {}).get("login", "unknown")

# ✅ CORRECT - Let it fail if data is malformed
sender = payload["sender"]["login"]  # KeyError = legitimate bug
```

---

## Fail-Fast Principle

**CRITICAL:** Fail-fast is better than hiding bugs with fake data.

### ❌ WRONG: Returning Fake Defaults

```python
# ❌ WRONG - Returns fake data hiding bugs
return ""           # Fake empty string
return 0            # Fake zero
return []           # Fake empty list (when data should exist)
return {}           # Fake empty dict (when data should exist)
```

### ✅ CORRECT: Fail-Fast

```python
# ✅ CORRECT - Fail-fast with clear error
raise ValueError("Data not available")  # Clear error
raise KeyError("Required field missing")  # Clear error
```

---

## Architecture Overview

This is a FastAPI-based metrics service that receives GitHub webhooks, stores event data in PostgreSQL, and provides a real-time dashboard for monitoring.

### Core Components

**Application (`github_metrics/app.py`):**

- FastAPI application with async endpoints
- Webhook receiver at POST /metrics
- Dashboard at GET /dashboard
- REST API at /api/metrics/\*
- WebSocket streaming at /metrics/ws

**Configuration (`github_metrics/config.py`):**

- Environment variable-based configuration (METRICS\_\*)
- No config files - all via environment variables
- Fail-fast on missing required variables

**Database (`github_metrics/database.py`):**

- DatabaseManager with asyncpg connection pool
- Async query execution (execute, fetch, fetchrow, fetchval)
- Health check support

**Models (`github_metrics/models.py`):**

- SQLAlchemy 2.0 declarative models
- Tables: webhooks, pull_requests, pr_events, pr_reviews, pr_labels, check_runs, api_usage
- PostgreSQL-specific types (UUID, JSONB)

**Security (`github_metrics/utils/security.py`):**

- GitHub IP allowlist verification
- Cloudflare IP allowlist verification
- Webhook signature validation (HMAC SHA256)

**Metrics Tracker (`github_metrics/metrics_tracker.py`):**

- Stores webhook events with full payload
- Tracks processing time and API usage

---

## Development Commands

### Environment Setup

```bash
# Install dependencies
uv sync

# Install with test dependencies
uv sync --extra tests
```

### Running the Server

```bash
# Set required environment variables
export METRICS_DB_NAME=github_metrics
export METRICS_DB_USER=metrics
export METRICS_DB_PASSWORD=your-password

# Run the server
uv run entrypoint.py
```

### Testing

```bash
# Run all tests (parallel execution)
uv run --group tests pytest tests/ -n auto

# Run with coverage (90% required)
uv run --group tests pytest tests/ -n auto --cov=github_metrics --cov-report=term-missing

# Run specific test file
uv run --group tests pytest tests/test_app.py -v
```

### Code Quality

```bash
# Run all quality checks (pre-commit hooks)
prek run --all-files
```

---

## Critical Implementation Patterns

### Database Query Pattern

All database operations use asyncpg with parameterized queries:

```python
# ✅ CORRECT - Parameterized query
await db_manager.execute(
    "INSERT INTO webhooks (delivery_id, repository) VALUES ($1, $2)",
    delivery_id,
    repository,
)

# ❌ WRONG - SQL injection risk
await db_manager.execute(
    f"INSERT INTO webhooks (delivery_id) VALUES ('{delivery_id}')"
)
```

### Async Pattern

All I/O operations must be async:

```python
# ✅ CORRECT - Async database operations
async def get_webhook_events():
    rows = await db_manager.fetch("SELECT * FROM webhooks")
    return rows

# ❌ WRONG - Blocking call in async context
def get_webhook_events():
    return sync_db.execute("SELECT * FROM webhooks")
```

### Logging Pattern

```python
from simple_logger.logger import get_logger

LOGGER = get_logger(name="github_metrics.app")

# Use appropriate log levels
LOGGER.debug("Detailed technical information")
LOGGER.info("General information")
LOGGER.warning("Warning that needs attention")
LOGGER.exception("Error with full traceback")  # For exceptions
```

---

## Import Organization

**MANDATORY:** All imports must be at the top of files

- No imports in the middle of functions or try/except blocks
- Exceptions: TYPE_CHECKING imports can be conditional
- Pre-commit hooks enforce this

---

## Type Hints

**MANDATORY:** All functions must have complete type hints (mypy strict mode)

```python
# ✅ CORRECT
async def track_webhook_event(
    delivery_id: str,
    repository: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    ...

# ❌ WRONG
async def track_webhook_event(delivery_id, repository, event_type, payload):
    ...
```

---

## Test Coverage

**MANDATORY:** 90% code coverage required

- Use `uv run --extra tests pytest --cov=github_metrics` to check
- New code without tests will fail CI
- Tests must be in `tests/`

---

## Testing Patterns

### Test File Organization

```bash
tests/
├── conftest.py              # Shared fixtures
├── test_app.py              # FastAPI endpoint tests
├── test_config.py           # Configuration tests
├── test_database.py         # Database manager tests
├── test_metrics_tracker.py  # Metrics tracker tests
└── test_security.py         # Security utilities tests
```

### Mock Testing Pattern

```python
from unittest.mock import AsyncMock, Mock, patch

# Mock database manager
mock_db = AsyncMock()
mock_db.fetch.return_value = [{"delivery_id": "test-123"}]

# Mock with patch
with patch("github_metrics.app.db_manager", mock_db):
    response = client.get("/api/metrics/webhooks")
```

### Test Token Pattern

Use centralized test tokens to avoid security warnings:

```python
# At module level
TEST_WEBHOOK_SECRET = "test_secret_for_unit_tests"  # pragma: allowlist secret

# In fixtures
@pytest.fixture
def mock_config():
    """Create mock configuration."""
    return Mock(
        webhook=Mock(secret=TEST_WEBHOOK_SECRET),
        database=Mock(host="localhost", port=5432),
    )
```

### Test File Naming

**MANDATORY:** Test file and test function names must be meaningful and related to the tested functionality.

**Rules:**
- Test file names must reflect the module being tested (e.g., `test_app.py` for `app.py`)
- Do NOT create generic files like `test_*_additional.py`, `test_*_coverage.py`, `test_*_extra.py`
- All tests for a module go in ONE test file (e.g., all app.py tests in `test_app.py`)
- Test function names must describe what is being tested (e.g., `test_webhook_endpoint_validates_signature`)

```python
# ❌ WRONG - Generic/meaningless file names
test_app_additional.py
test_app_coverage.py
test_database_extra.py

# ✅ CORRECT - One file per module
test_app.py          # All app.py tests
test_database.py     # All database.py tests
test_config.py       # All config.py tests
```

---

## Security Considerations

### Dashboard Security

⚠️ **CRITICAL:** Dashboard endpoint (`/dashboard`) is unauthenticated by design

- Deploy only on trusted networks (VPN, internal network)
- Never expose to public internet without authentication
- Use reverse proxy with authentication for external access

### Token Handling

- Store tokens in environment variables
- Never commit tokens to repository
- Use secrets management in production
