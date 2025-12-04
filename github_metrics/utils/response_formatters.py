"""Shared response formatting utilities for API endpoints.

Provides consistent response structures across all API routes.
"""

from __future__ import annotations

from typing import Any

from github_metrics.utils.query_builders import calculate_total_pages


def format_pagination_metadata(
    total: int,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    """Format pagination metadata for API responses.

    Args:
        total: Total number of items
        page: Current page (1-based)
        page_size: Items per page

    Returns:
        Dictionary with pagination metadata:
        {
            "total": 100,
            "page": 1,
            "page_size": 10,
            "total_pages": 10,
            "has_next": True,
            "has_prev": False
        }
    """
    total_pages = calculate_total_pages(total, page_size)

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }


def format_paginated_response(
    data: list[Any],
    total: int,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    """Format a standard paginated API response.

    Args:
        data: List of items for current page
        total: Total number of items
        page: Current page
        page_size: Items per page

    Returns:
        Dictionary with data and pagination:
        {
            "data": [...],
            "pagination": {...}
        }
    """
    return {
        "data": data,
        "pagination": format_pagination_metadata(total, page, page_size),
    }
