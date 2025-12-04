"""Shared query builder utilities for API endpoints.

This module provides a unified interface for building SQL query components:
- Time range filtering
- Pagination
- Repository filtering
- Parameter index tracking

All API routes should use these utilities to ensure consistency.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class QueryParams:
    """Tracks query parameters and their indices for SQL parameterization.

    Usage:
        params = QueryParams()

        # Add a time filter
        time_filter = build_time_filter(params, start_dt, end_dt)

        # Add pagination
        pagination_sql = build_pagination_sql(params, page, page_size)

        # Get all params for query execution
        query_params = params.get_params()
    """

    _params: list[Any] = field(default_factory=list)
    _count: int = 0

    def next_index(self) -> int:
        """Get next parameter index (1-based for PostgreSQL)."""
        self._count += 1
        return self._count

    def add(self, value: Any) -> str:
        """Add a parameter and return its placeholder."""
        idx = self.next_index()
        self._params.append(value)
        return f"${idx}"

    def get_params(self) -> list[Any]:
        """Get all parameters for query execution.

        Returns a defensive copy to prevent accidental mutation
        of internal state after retrieval.
        """
        return self._params.copy()

    def get_count(self) -> int:
        """Get current parameter count."""
        return self._count


def build_time_filter(
    params: QueryParams,
    start_time: datetime | None,
    end_time: datetime | None,
    column: str = "created_at",
) -> str:
    """Build time range filter SQL.

    Args:
        params: QueryParams tracker to add parameters to
        start_time: Start of time range (inclusive)
        end_time: End of time range (inclusive)
        column: Column name to filter on (default: created_at)

    Returns:
        SQL WHERE clause fragment (e.g., " AND created_at >= $1 AND created_at <= $2")
        Returns empty string if both times are None
    """
    filter_parts = []

    if start_time:
        placeholder = params.add(start_time)
        filter_parts.append(f"{column} >= {placeholder}")

    if end_time:
        placeholder = params.add(end_time)
        filter_parts.append(f"{column} <= {placeholder}")

    if not filter_parts:
        return ""

    return " AND " + " AND ".join(filter_parts)


def build_repository_filter(
    params: QueryParams,
    repository: str | None,
    column: str = "repository",
) -> str:
    """Build repository filter SQL.

    Args:
        params: QueryParams tracker
        repository: Repository name to filter (org/repo format)
        column: Column name (default: repository)

    Returns:
        SQL WHERE clause fragment or empty string
    """
    if not repository:
        return ""

    placeholder = params.add(repository)
    return f" AND {column} = {placeholder}"


def build_pagination_sql(
    params: QueryParams,
    page: int,
    page_size: int,
) -> str:
    """Build pagination SQL (LIMIT/OFFSET).

    Args:
        params: QueryParams tracker
        page: Page number (1-based)
        page_size: Items per page

    Returns:
        SQL fragment like "LIMIT $3 OFFSET $4"
    """
    offset = (page - 1) * page_size
    limit_placeholder = params.add(page_size)
    offset_placeholder = params.add(offset)
    return f"LIMIT {limit_placeholder} OFFSET {offset_placeholder}"


def calculate_total_pages(total: int, page_size: int) -> int:
    """Calculate total pages from total items and page size."""
    if total <= 0:
        return 0
    return (total + page_size - 1) // page_size
