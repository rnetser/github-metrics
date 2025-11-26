"""
Tests for MetricsDashboardController class.

Tests dashboard functionality including:
- WebSocket connection management
- Real-time metrics streaming
- HTML page serving
- Database polling
- Graceful shutdown
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, Mock, mock_open, patch

import pytest
from fastapi import HTTPException, WebSocket, WebSocketDisconnect

from github_metrics.web.dashboard import MetricsDashboardController


class TestMetricsDashboardController:
    """Tests for MetricsDashboardController class."""

    @pytest.fixture
    def mock_db_manager(self) -> Mock:
        """Create mock database manager."""
        mock = AsyncMock()
        mock.fetch = AsyncMock(return_value=[])
        return mock

    @pytest.fixture
    def mock_logger(self) -> Mock:
        """Create mock logger."""
        return Mock(spec=logging.Logger)

    @pytest.fixture
    def dashboard_controller(
        self,
        mock_db_manager: Mock,
        mock_logger: Mock,
    ) -> MetricsDashboardController:
        """Create MetricsDashboardController instance."""
        return MetricsDashboardController(db_manager=mock_db_manager, logger=mock_logger)

    async def test_shutdown_with_active_connections(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_logger: Mock,
    ) -> None:
        """Test shutdown closes all active WebSocket connections."""
        # Create mock WebSocket connections
        mock_ws1 = AsyncMock(spec=WebSocket)
        mock_ws2 = AsyncMock(spec=WebSocket)
        dashboard_controller._websocket_connections = {mock_ws1, mock_ws2}

        await dashboard_controller.shutdown()

        # Verify both connections were closed
        mock_ws1.close.assert_called_once_with(code=1001, reason="Server shutdown")
        mock_ws2.close.assert_called_once_with(code=1001, reason="Server shutdown")

        # Verify connections were cleared
        assert len(dashboard_controller._websocket_connections) == 0

        # Verify logging
        mock_logger.info.assert_called()

    async def test_shutdown_with_no_connections(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_logger: Mock,
    ) -> None:
        """Test shutdown completes successfully with no connections."""
        assert len(dashboard_controller._websocket_connections) == 0

        await dashboard_controller.shutdown()

        assert len(dashboard_controller._websocket_connections) == 0
        mock_logger.info.assert_called()

    async def test_shutdown_handles_websocket_close_error(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_logger: Mock,
    ) -> None:
        """Test shutdown handles errors when closing WebSocket connections."""
        mock_ws = AsyncMock(spec=WebSocket)
        mock_ws.close.side_effect = Exception("Connection already closed")
        dashboard_controller._websocket_connections = {mock_ws}

        await dashboard_controller.shutdown()

        # Verify exception was logged
        mock_logger.exception.assert_called_once()
        assert len(dashboard_controller._websocket_connections) == 0

    def test_get_dashboard_page_success(
        self,
        dashboard_controller: MetricsDashboardController,
    ) -> None:
        """Test get_dashboard_page returns HTML response."""
        with patch.object(
            dashboard_controller,
            "_get_dashboard_html",
            return_value="<html>Dashboard</html>",
        ):
            response = dashboard_controller.get_dashboard_page()

            assert response.body == b"<html>Dashboard</html>"
            assert response.status_code == 200

    def test_get_dashboard_page_template_error(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_logger: Mock,
    ) -> None:
        """Test get_dashboard_page raises HTTPException on template error."""
        with patch.object(
            dashboard_controller,
            "_get_dashboard_html",
            side_effect=Exception("Template error"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                dashboard_controller.get_dashboard_page()

            assert exc_info.value.status_code == 500
            mock_logger.exception.assert_called_once()

    async def test_handle_websocket_accepts_connection(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_db_manager: Mock,
    ) -> None:
        """Test handle_websocket accepts connection and adds to tracking set."""
        mock_ws = AsyncMock(spec=WebSocket)
        mock_db_manager.fetch = AsyncMock(return_value=[])

        # Patch asyncio.sleep to raise WebSocketDisconnect immediately
        # (since no events means send_json is never called)
        with patch("asyncio.sleep", side_effect=WebSocketDisconnect()):
            await dashboard_controller.handle_websocket(mock_ws)

        mock_ws.accept.assert_called_once()
        # Connection should be removed from set after disconnect
        assert mock_ws not in dashboard_controller._websocket_connections

    async def test_handle_websocket_streams_new_events(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_db_manager: Mock,
        _mock_logger: Mock,
    ) -> None:
        """Test handle_websocket streams new events to client."""
        mock_ws = AsyncMock(spec=WebSocket)

        # First poll returns events, second poll raises disconnect
        test_event = {
            "delivery_id": "test-123",
            "repository": "testorg/testrepo",
            "event_type": "pull_request",
            "action": "opened",
            "pr_number": 42,
            "sender": "testuser",
            "status": "success",
            "duration_ms": 150,
            "created_at": datetime.now(UTC),
            "processed_at": datetime.now(UTC),
            "error_message": None,
            "api_calls_count": 3,
            "token_spend": 3,
            "token_remaining": 4997,
        }

        call_count = 0

        async def mock_fetch(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [test_event]
            return []

        mock_db_manager.fetch = mock_fetch

        # Disconnect after first send
        mock_ws.send_json.side_effect = WebSocketDisconnect()

        await dashboard_controller.handle_websocket(mock_ws)

        # Verify event was sent
        mock_ws.send_json.assert_called_once()
        sent_message = mock_ws.send_json.call_args[0][0]
        assert sent_message["type"] == "metric_update"
        assert sent_message["data"]["event"]["delivery_id"] == "test-123"

    async def test_handle_websocket_with_filters(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_db_manager: Mock,
    ) -> None:
        """Test handle_websocket applies filters to database query."""
        mock_ws = AsyncMock(spec=WebSocket)
        mock_db_manager.fetch = AsyncMock(return_value=[])

        # Patch asyncio.sleep to raise WebSocketDisconnect immediately
        # (since no events means send_json is never called)
        with patch("asyncio.sleep", side_effect=WebSocketDisconnect()):
            await dashboard_controller.handle_websocket(
                websocket=mock_ws,
                repository="testorg/testrepo",
                event_type="pull_request",
                status="success",
            )

        # Verify database fetch was called with filters
        mock_db_manager.fetch.assert_called()
        query_args = mock_db_manager.fetch.call_args[0]
        query = query_args[0]
        params = query_args[1:]

        assert "WHERE" in query
        assert "testorg/testrepo" in params
        assert "pull_request" in params
        assert "success" in params

    async def test_handle_websocket_handles_runtime_error(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_db_manager: Mock,
        _mock_logger: Mock,
    ) -> None:
        """Test handle_websocket handles RuntimeError during send."""
        mock_ws = AsyncMock(spec=WebSocket)

        test_event = {
            "delivery_id": "test-123",
            "repository": "testorg/testrepo",
            "event_type": "pull_request",
            "action": "opened",
            "pr_number": 42,
            "sender": "testuser",
            "status": "success",
            "duration_ms": 150,
            "created_at": datetime.now(UTC),
            "processed_at": datetime.now(UTC),
            "error_message": None,
            "api_calls_count": 3,
            "token_spend": 3,
            "token_remaining": 4997,
        }

        mock_db_manager.fetch = AsyncMock(return_value=[test_event])

        # RuntimeError during send
        mock_ws.send_json.side_effect = RuntimeError("Connection closed")

        await dashboard_controller.handle_websocket(mock_ws)

        # Verify connection was cleaned up
        assert mock_ws not in dashboard_controller._websocket_connections

    async def test_handle_websocket_handles_general_exception(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_db_manager: Mock,
        mock_logger: Mock,
    ) -> None:
        """Test handle_websocket handles general exceptions during monitoring."""
        mock_ws = AsyncMock(spec=WebSocket)

        # First fetch raises exception, second disconnects
        call_count = 0

        async def mock_fetch(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Database error")
            return []

        mock_db_manager.fetch = mock_fetch

        # Disconnect on second iteration
        with patch("asyncio.sleep", side_effect=[None, WebSocketDisconnect()]):
            await dashboard_controller.handle_websocket(mock_ws)

        # Verify exception was logged but monitoring continued
        mock_logger.exception.assert_called()

    async def test_handle_websocket_sets_last_seen_timestamp(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_db_manager: Mock,
    ) -> None:
        """Test handle_websocket sets last_seen_timestamp when no events."""
        mock_ws = AsyncMock(spec=WebSocket)

        call_count = 0

        async def mock_fetch(*args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First poll returns no events - should set timestamp
                return []
            if call_count == 2:
                # Second poll should include timestamp filter
                query = args[0]
                params = args[1:]
                assert "created_at >" in query
                assert len(params) > 0
            return []

        mock_db_manager.fetch = mock_fetch

        # Disconnect after two polls
        with patch("asyncio.sleep", side_effect=[None, WebSocketDisconnect()]):
            await dashboard_controller.handle_websocket(mock_ws)

        assert call_count >= 2

    async def test_fetch_new_events_with_no_filters(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_db_manager: Mock,
    ) -> None:
        """Test _fetch_new_events without filters."""
        test_events = [
            {
                "delivery_id": "test-123",
                "repository": "testorg/testrepo",
                "event_type": "pull_request",
                "action": "opened",
                "pr_number": 42,
                "sender": "testuser",
                "created_at": datetime.now(UTC),
                "processed_at": datetime.now(UTC),
                "duration_ms": 150,
                "status": "success",
                "error_message": None,
                "api_calls_count": 3,
                "token_spend": 3,
                "token_remaining": 4997,
            }
        ]

        mock_db_manager.fetch = AsyncMock(return_value=test_events)

        result = await dashboard_controller._fetch_new_events(
            last_seen_timestamp=None,
            repository=None,
            event_type=None,
            status=None,
        )

        assert len(result) == 1
        assert result[0]["delivery_id"] == "test-123"

        # Verify query has no WHERE clause
        query = mock_db_manager.fetch.call_args[0][0]
        assert "WHERE" not in query

    async def test_fetch_new_events_with_all_filters(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_db_manager: Mock,
    ) -> None:
        """Test _fetch_new_events with all filters applied."""
        mock_db_manager.fetch = AsyncMock(return_value=[])

        last_seen = datetime.now(UTC)

        await dashboard_controller._fetch_new_events(
            last_seen_timestamp=last_seen,
            repository="testorg/testrepo",
            event_type="pull_request",
            status="success",
        )

        query = mock_db_manager.fetch.call_args[0][0]
        params = mock_db_manager.fetch.call_args[0][1:]

        # Verify all filters in query
        assert "WHERE" in query
        assert "created_at > $1" in query
        assert "repository = $2" in query
        assert "event_type = $3" in query
        assert "status = $4" in query

        # Verify all parameters passed
        assert params[0] == last_seen
        assert params[1] == "testorg/testrepo"
        assert params[2] == "pull_request"
        assert params[3] == "success"

    def test_build_metric_update_message_success_status(
        self,
        dashboard_controller: MetricsDashboardController,
    ) -> None:
        """Test _build_metric_update_message with success status."""
        event = {
            "delivery_id": "test-123",
            "repository": "testorg/testrepo",
            "event_type": "pull_request",
            "action": "opened",
            "pr_number": 42,
            "sender": "testuser",
            "status": "success",
            "duration_ms": 150,
            "created_at": datetime.now(UTC),
            "processed_at": datetime.now(UTC),
            "error_message": None,
            "api_calls_count": 3,
            "token_spend": 3,
            "token_remaining": 4997,
        }

        message = dashboard_controller._build_metric_update_message(event)

        assert message["type"] == "metric_update"
        assert "timestamp" in message
        assert message["data"]["event"]["delivery_id"] == "test-123"
        assert message["data"]["event"]["status"] == "success"
        assert message["data"]["summary_delta"]["successful_events"] == 1
        assert message["data"]["summary_delta"]["failed_events"] == 0
        assert message["data"]["summary_delta"]["partial_events"] == 0

    def test_build_metric_update_message_error_status(
        self,
        dashboard_controller: MetricsDashboardController,
    ) -> None:
        """Test _build_metric_update_message with error status."""
        event = {
            "delivery_id": "test-456",
            "repository": "testorg/testrepo",
            "event_type": "issue_comment",
            "action": "created",
            "pr_number": None,
            "sender": "testuser",
            "status": "error",
            "duration_ms": 250,
            "created_at": datetime.now(UTC),
            "processed_at": datetime.now(UTC),
            "error_message": "API error",
            "api_calls_count": 1,
            "token_spend": 1,
            "token_remaining": 4999,
        }

        message = dashboard_controller._build_metric_update_message(event)

        assert message["data"]["summary_delta"]["successful_events"] == 0
        assert message["data"]["summary_delta"]["failed_events"] == 1
        assert message["data"]["summary_delta"]["partial_events"] == 0
        assert message["data"]["event"]["error_message"] == "API error"

    def test_build_metric_update_message_partial_status(
        self,
        dashboard_controller: MetricsDashboardController,
    ) -> None:
        """Test _build_metric_update_message with partial status."""
        event = {
            "delivery_id": "test-789",
            "repository": "testorg/testrepo",
            "event_type": "push",
            "action": "",
            "pr_number": None,
            "sender": "testuser",
            "status": "partial",
            "duration_ms": 300,
            "created_at": datetime.now(UTC),
            "processed_at": None,
            "error_message": None,
            "api_calls_count": 0,
            "token_spend": 0,
            "token_remaining": 5000,
        }

        message = dashboard_controller._build_metric_update_message(event)

        assert message["data"]["summary_delta"]["successful_events"] == 0
        assert message["data"]["summary_delta"]["failed_events"] == 0
        assert message["data"]["summary_delta"]["partial_events"] == 1

    def test_serialize_datetime_with_datetime(
        self,
        dashboard_controller: MetricsDashboardController,
    ) -> None:
        """Test _serialize_datetime with datetime object."""
        dt = datetime(2024, 1, 15, 12, 30, 45, tzinfo=UTC)

        result = dashboard_controller._serialize_datetime(dt)

        assert result is not None
        assert "2024-01-15" in result
        assert "12:30:45" in result

    def test_serialize_datetime_with_none(
        self,
        dashboard_controller: MetricsDashboardController,
    ) -> None:
        """Test _serialize_datetime with None."""
        result = dashboard_controller._serialize_datetime(None)

        assert result is None

    def test_get_dashboard_html_success(
        self,
        dashboard_controller: MetricsDashboardController,
    ) -> None:
        """Test _get_dashboard_html returns template content."""
        mock_template_content = "<html><body>Test Dashboard</body></html>"

        with patch("builtins.open", mock_open(read_data=mock_template_content)):
            result = dashboard_controller._get_dashboard_html()

            assert result == mock_template_content

    def test_get_dashboard_html_file_not_found(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_logger: Mock,
    ) -> None:
        """Test _get_dashboard_html returns fallback on FileNotFoundError."""
        with patch("builtins.open", side_effect=FileNotFoundError("Template not found")):
            result = dashboard_controller._get_dashboard_html()

            assert "Metrics Dashboard Template Error" in result
            assert "<!DOCTYPE html>" in result
            mock_logger.exception.assert_called_once()

    def test_get_dashboard_html_os_error(
        self,
        dashboard_controller: MetricsDashboardController,
        mock_logger: Mock,
    ) -> None:
        """Test _get_dashboard_html returns fallback on OSError."""
        with patch("builtins.open", side_effect=OSError("Permission denied")):
            result = dashboard_controller._get_dashboard_html()

            assert "Metrics Dashboard Template Error" in result
            mock_logger.exception.assert_called()

    def test_get_fallback_html(
        self,
        dashboard_controller: MetricsDashboardController,
    ) -> None:
        """Test _get_fallback_html returns valid HTML."""
        result = dashboard_controller._get_fallback_html()

        assert "<!DOCTYPE html>" in result
        assert "Metrics Dashboard Template Error" in result
        assert "<html lang=" in result
        assert "window.location.reload()" in result
