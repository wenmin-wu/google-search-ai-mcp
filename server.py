#!/usr/bin/env python3
"""
Google Search AI MCP Server

A MCP server that enables AI agents to conduct conversations
with Google Search AI through a Chrome extension using WebSocket.

Simplified Architecture:
- FastMCP stdio Server
- WebSocket Server: Port 8761
"""

import asyncio
import json
import logging
import os
import signal
import sys
import threading
import uuid
import websockets
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastmcp import FastMCP
from mcp.types import TextContent

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Initialize FastMCP with stdio
mcp = FastMCP("Google Search AI MCP")

# HTML parsing libraries
try:
    from bs4 import BeautifulSoup
    import markdownify
    HTML_PARSING_AVAILABLE = True
    logger.info("HTML parsing libraries loaded successfully")
except ImportError:
    HTML_PARSING_AVAILABLE = False
    logger.warning(
        "HTML parsing libraries not available. Install with: pip install beautifulsoup4 markdownify"
    )

# Configuration
DEFAULT_WEBSOCKET_PORT = 8761


def truncate_content(content: str, max_length: int = 200) -> str:
    """Truncate content to max_length, showing beginning and end"""
    if not content or len(content) <= max_length:
        return content

    if max_length < 10:
        return content[:max_length]

    # Calculate how much to show from beginning and end
    begin_chars = (max_length - 3) // 2  # Reserve 3 chars for "..."
    end_chars = max_length - begin_chars - 3

    return f"{content[:begin_chars]}...{content[-end_chars:]}"


def parse_html_content(html_content: str) -> Dict[str, Any]:
    """
    Parse HTML content using Python's superior parsing libraries.

    Args:
        html_content: Raw HTML string from Google Search AI

    Returns:
        Dict containing parsed content, metadata, and success status
    """
    if not HTML_PARSING_AVAILABLE:
        logger.warning("HTML parsing libraries not available, returning raw text")
        return {
            "content": BeautifulSoup(html_content, "html.parser").get_text(strip=True)
            if html_content
            else "",
            "metadata": {},
            "success": False,
            "error": "HTML parsing libraries not installed",
        }

    try:
        logger.info(f"🔧 Parsing {len(html_content)} characters of HTML content")

        # Parse HTML and clean unwanted elements
        soup = BeautifulSoup(html_content, "html.parser")

        # Remove scripts, styles, and other unwanted elements
        for element in soup(["script", "style", "noscript", "svg", "path"]):
            element.decompose()

        # Extract metadata
        metadata = {"sources": [], "images": [], "links": []}

        # Extract links
        for link in soup.find_all("a", href=True):
            link_text = link.get_text(strip=True)
            if link_text and len(link_text) > 3:
                metadata["links"].append(
                    {
                        "text": link_text,
                        "url": link["href"],
                        "title": link.get("title", ""),
                    }
                )

        # Extract images
        for img in soup.find_all("img"):
            if img.get("src"):
                metadata["images"].append(
                    {
                        "src": img["src"],
                        "alt": img.get("alt", ""),
                        "width": img.get("width"),
                        "height": img.get("height"),
                    }
                )

        # Convert to markdown
        clean_html = str(soup)
        markdown_content = markdownify.markdownify(
            clean_html,
            heading_style="ATX",
            convert=[
                "p",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "strong",
                "em",
                "a",
                "ul",
                "ol",
                "li",
                "br",
            ],
        )

        # Clean up markdown
        import re

        markdown_content = re.sub(r"\n\s*\n\s*\n", "\n\n", markdown_content)
        markdown_content = re.sub(r"<!--.*?-->", "", markdown_content, flags=re.DOTALL)
        markdown_content = markdown_content.strip()

        logger.info(
            f"✅ Successfully parsed HTML to {len(markdown_content)} characters of markdown"
        )
        logger.debug(
            f"📊 Extracted metadata: {len(metadata['links'])} links, {len(metadata['images'])} images"
        )

        return {
            "content": markdown_content,
            "metadata": metadata,
            "success": True,
            "raw_text": soup.get_text(strip=True),
        }

    except Exception as e:
        logger.error(f"❌ HTML parsing failed: {e}")
        try:
            # Fallback to basic text extraction
            soup = BeautifulSoup(html_content, "html.parser")
            text_content = soup.get_text(strip=True)
            return {
                "content": text_content,
                "metadata": {},
                "success": False,
                "error": str(e),
            }
        except Exception as fallback_error:
            logger.error(f"❌ Even fallback parsing failed: {fallback_error}")
            return {
                "content": "",
                "metadata": {},
                "success": False,
                "error": f"Parsing failed: {e}, Fallback failed: {fallback_error}",
            }


class SessionManager:
    """Session manager for WebSocket connections"""

    def __init__(self):
        self.connections: Dict[str, websockets.WebSocketServerProtocol] = {}
        self.current_conversation_id: Optional[str] = None  # Single conversation
        self.pending_requests: Dict[str, Dict[str, Any]] = {}  # request_id -> request_data
        self.session_lock = threading.Lock()

    def register_connection(self, connection_id: str, websocket: websockets.WebSocketServerProtocol):
        """Register a new WebSocket connection"""
        with self.session_lock:
            self.connections[connection_id] = websocket
            logger.info(f"🔌 Registered connection: {connection_id}")

    def unregister_connection(self, connection_id: str):
        """Remove WebSocket connection"""
        with self.session_lock:
            if connection_id in self.connections:
                del self.connections[connection_id]
                logger.info(f"❌ Unregistered connection: {connection_id}")

    def get_or_create_conversation(self) -> str:
        """Get existing conversation or create new one"""
        with self.session_lock:
            if not self.current_conversation_id:
                conversation_id = f"conv_{uuid.uuid4().hex[:8]}_{int(datetime.now().timestamp())}"
                self.current_conversation_id = conversation_id
                logger.info(f"✅ Created new conversation {conversation_id}")
            else:
                conversation_id = self.current_conversation_id
                logger.info(f"♻️ Using existing conversation {conversation_id}")

        return conversation_id

    def end_conversation(self) -> bool:
        """End current conversation"""
        with self.session_lock:
            if self.current_conversation_id:
                conversation_id = self.current_conversation_id
                self.current_conversation_id = None
                logger.info(f"✅ Ended conversation {conversation_id}")
                return True

        logger.warning("⚠️ No active conversation to end")
        return False

    def add_pending_request(self, request_data: Dict[str, Any]) -> str:
        """Add a pending request and return request ID"""
        request_id = f"req_{uuid.uuid4().hex[:8]}_{int(datetime.now().timestamp())}"
        request_data["request_id"] = request_id
        request_data["created_at"] = datetime.now().isoformat()
        request_data["completed"] = False
        request_data["response"] = None
        self.pending_requests[request_id] = request_data
        return request_id

    def complete_request(self, request_id: str, response_data: Dict[str, Any]):
        """Mark request as completed with response data"""
        if request_id in self.pending_requests:
            self.pending_requests[request_id]["completed"] = True
            self.pending_requests[request_id]["response"] = response_data
            self.pending_requests[request_id]["completed_at"] = datetime.now().isoformat()
            logger.info(f"✅ Completed request {request_id}")
            return True
        return False

    def get_request(self, request_id: str) -> Optional[Dict[str, Any]]:
        """Get pending request data"""
        return self.pending_requests.get(request_id)

    def cleanup_request(self, request_id: str):
        """Remove completed request"""
        if request_id in self.pending_requests:
            del self.pending_requests[request_id]

    async def wait_for_response(self, request_id: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
        """Wait for response to a request with timeout"""
        start_time = datetime.now()

        while True:
            # Check if request is completed
            request_data = self.get_request(request_id)
            if not request_data:
                raise Exception("Request was removed unexpectedly")

            if request_data["completed"]:
                response = request_data["response"]
                return response

            # Check timeout
            elapsed = (datetime.now() - start_time).total_seconds()
            if elapsed > timeout:
                raise Exception(f"Request timed out after {timeout} seconds")

            # Wait a bit before checking again
            await asyncio.sleep(0.5)

    def get_active_connection(self) -> Optional[websockets.WebSocketServerProtocol]:
        """Get any active WebSocket connection"""
        with self.session_lock:
            if self.connections:
                # Return the first available connection
                return next(iter(self.connections.values()))
        return None

    def get_status(self) -> Dict[str, Any]:
        """Get session status"""
        with self.session_lock:
            return {
                "active_connections": len(self.connections),
                "current_conversation": self.current_conversation_id,
                "pending_requests": len(self.pending_requests),
            }


# Global session manager
session_manager = SessionManager()


async def send_to_extension(message_type: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Send message to Chrome extension via WebSocket and wait for response"""

    websocket = session_manager.get_active_connection()
    if not websocket:
        raise RuntimeError("No active WebSocket connection found")

    # Create request
    request_data = {"type": message_type, "data": data}
    request_id = session_manager.add_pending_request(request_data)
    logger.info(f"📤 Sending {message_type} (request: {request_id})")

    try:
        # Send message to WebSocket
        message = {
            "type": message_type,
            "request_id": request_id,
            "data": data
        }
        await websocket.send(json.dumps(message))

        # Wait for response
        response = await session_manager.wait_for_response(request_id, timeout=30)
        logger.info(f"✅ Received response for {request_id}")
        return response

    except Exception as error:
        logger.error(f"❌ Error sending {message_type}: {error}")
        session_manager.cleanup_request(request_id)
        raise error


# FastMCP Tool Implementations
@mcp.tool()
async def chat_search_ai(
    message: str,
) -> List[TextContent]:
    """Chat with Google Search AI. Automatically handles starting, continuing, and ending conversations.

    Args:
        message: Message to send to Google Search AI. Say 'done' to end the conversation.

    - For the first message: automatically starts a new conversation
    - For follow-up messages: continues the existing conversation
    - When message is 'done': ends the conversation and closes the tab
    """
    logger.info(f"💬 Chat request, message: '{message[:50]}{'...' if len(message) > 50 else ''}'")

    try:
        # Check if we have an active WebSocket connection
        if not session_manager.get_active_connection():
            return [
                TextContent(
                    type="text",
                    text="❌ No active WebSocket connection found. Please ensure the Chrome extension is connected.",
                )
            ]

        # Check if user wants to end conversation
        if message.lower().strip() == 'done':
            logger.info("🔚 User requested to end conversation")

            # Check if conversation exists
            if not session_manager.current_conversation_id:
                return [TextContent(type="text", text="✅ No active conversation to end")]

            conversation_id = session_manager.current_conversation_id

            # Send END_CONVERSATION message to extension to close tab
            try:
                await send_to_extension(
                    "END_CONVERSATION",
                    {"conversation_id": conversation_id},
                )
                logger.info("✅ Sent END_CONVERSATION to extension")
            except Exception as ext_error:
                logger.warning(
                    f"⚠️ Failed to notify extension about conversation end: {ext_error}"
                )
                # Continue with server-side cleanup even if extension notification fails

            # Remove conversation from server state
            success = session_manager.end_conversation()

            if success:
                return [
                    TextContent(
                        type="text",
                        text="✅ Conversation ended successfully and tab closed",
                    )
                ]
            else:
                return [TextContent(type="text", text="⚠️ No active conversation to end")]

        # Check if this is a new conversation
        is_new_conversation = not session_manager.current_conversation_id

        if is_new_conversation:
            logger.info("🚀 Starting new conversation")

            # End any existing conversation first (cleanup)
            session_manager.end_conversation()

            # Create new conversation
            conversation_id = session_manager.get_or_create_conversation()

            # Send initial message to extension
            response = await send_to_extension(
                "CONVERSATION_START",
                {
                    "conversation_id": conversation_id,
                    "message": message,
                },
            )
        else:
            logger.info("📤 Continuing conversation")
            conversation_id = session_manager.current_conversation_id

            # Send follow-up message to extension
            response = await send_to_extension(
                "CONVERSATION_MESSAGE",
                {
                    "conversation_id": conversation_id,
                    "message": message,
                },
            )

        if response and response.get("content"):
            return [TextContent(type="text", text=response["content"])]
        elif response and response.get("needs_tab"):
            # Extension is asking user to create a tab - pass message to MCP client
            return [TextContent(type="text", text=response["content"])]
        else:
            return [
                TextContent(
                    type="text", text="❌ No response received from Google Search AI"
                )
            ]

    except Exception as e:
        logger.error(f"❌ Error in chat_search_ai: {e}")
        return [TextContent(type="text", text=f"❌ Error: {str(e)}")]


@mcp.tool()
async def get_status() -> List[TextContent]:
    """Get current server status and statistics."""
    status = session_manager.get_status()

    status_text = f"""📊 MCP Server Status:
• Active connections: {status['active_connections']}
• Current conversation: {status['current_conversation'] or 'None'}
• Pending requests: {status['pending_requests']}
"""

    return [TextContent(type="text", text=status_text)]


# WebSocket Event Handlers
async def handle_websocket_message(websocket, message_data):
    """Handle incoming WebSocket messages"""
    try:
        if message_data.get("type") == "conversation_response":
            request_id = message_data.get("request_id")
            response_data = message_data.get("data", {})

            if request_id:
                # Check if response needs HTML parsing
                if response_data.get("needs_parsing", False) and response_data.get("html_content"):
                    logger.info(f"🔧 Processing HTML content for request {request_id}")
                    parsed_result = parse_html_content(response_data["html_content"])

                    if parsed_result["success"]:
                        response_data["content"] = parsed_result["content"]
                        if "metadata" not in response_data:
                            response_data["metadata"] = {}
                        response_data["metadata"].update(parsed_result["metadata"])
                        response_data["parsing_success"] = True
                        logger.info(f"✅ HTML parsing successful for request {request_id}")
                    else:
                        if parsed_result.get("content"):
                            response_data["content"] = parsed_result["content"]
                        response_data["parsing_success"] = False
                        response_data["parsing_error"] = parsed_result.get("error")
                        logger.warning(
                            f"⚠️ HTML parsing failed for request {request_id}: {parsed_result.get('error')}"
                        )

                session_manager.complete_request(request_id, response_data)

                content = response_data.get("content", "")
                if content:
                    truncated_content = truncate_content(content)
                    logger.info(f"✅ Completed request {request_id} with response: {truncated_content}")
                else:
                    logger.info(f"✅ Completed request {request_id}")

        elif message_data.get("type") == "conversation_error":
            request_id = message_data.get("request_id")
            error_message = message_data.get("error", "Unknown error")

            if request_id:
                logger.error(f"❌ Conversation error for request {request_id}: {error_message}")

                # Complete request with error data
                error_response = {
                    "error": error_message,
                    "conversation_id": message_data.get("conversation_id", "unknown"),
                }
                session_manager.complete_request(request_id, error_response)

    except Exception as e:
        logger.error(f"❌ Error handling WebSocket message: {e}")


async def websocket_handler(websocket):
    """Handle WebSocket connections"""
    connection_id = f"conn_{uuid.uuid4().hex[:8]}"
    logger.info(f"🔌 New WebSocket connection: {connection_id}")

    # Register connection
    session_manager.register_connection(connection_id, websocket)

    try:
        # Send connection confirmation
        await websocket.send(json.dumps({
            "type": "connection_established",
            "connection_id": connection_id
        }))

        # Handle messages
        async for message in websocket:
            try:
                message_data = json.loads(message)
                await handle_websocket_message(websocket, message_data)
            except json.JSONDecodeError:
                logger.error(f"❌ Invalid JSON received from {connection_id}")
            except Exception as e:
                logger.error(f"❌ Error processing message from {connection_id}: {e}")

    except websockets.exceptions.ConnectionClosed:
        logger.info(f"🔌 WebSocket connection {connection_id} closed")
    except Exception as e:
        logger.error(f"❌ WebSocket error for {connection_id}: {e}")
    finally:
        # Unregister connection
        session_manager.unregister_connection(connection_id)


# Global shutdown event
shutdown_event = asyncio.Event()


def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info(f"🛑 Received signal {signum}, initiating shutdown...")
    shutdown_event.set()


async def run_websocket_server(port: int = 8761):
    """Run WebSocket server"""
    logger.info(f"🚀 Starting WebSocket server on port {port}")

    server = await websockets.serve(
        websocket_handler,
        "0.0.0.0",
        port,
        ping_interval=30,
        ping_timeout=10
    )

    logger.info(f"✅ WebSocket server running on ws://0.0.0.0:{port}")

    # Wait for shutdown signal
    await shutdown_event.wait()
    logger.info("🛑 Shutting down WebSocket server...")
    server.close()
    await server.wait_closed()
    logger.info("✅ WebSocket server stopped")


async def main():
    """Main entry point - starts WebSocket server and runs FastMCP stdio"""
    logger.info("🚀 Starting Google Search AI MCP Server (Community Version)")

    # Set up signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    port = int(os.getenv("WEBSOCKET_PORT", DEFAULT_WEBSOCKET_PORT))
    logger.info(f"🔌 WebSocket Server: ws://0.0.0.0:{port}")
    logger.info("📡 FastMCP: stdio transport")

    try:
        # Start WebSocket server in background
        websocket_task = asyncio.create_task(run_websocket_server(port))

        # Start FastMCP stdio server
        logger.info("🚀 Starting FastMCP stdio server...")
        mcp_task = asyncio.create_task(
            asyncio.to_thread(lambda: mcp.run(transport="stdio"))
        )

        # Wait for either server to complete or shutdown signal
        done, pending = await asyncio.wait(
            [websocket_task, mcp_task, asyncio.create_task(shutdown_event.wait())],
            return_when=asyncio.FIRST_COMPLETED,
        )

        # Trigger shutdown for remaining tasks
        shutdown_event.set()

        # Cancel pending tasks
        for task in pending:
            task.cancel()

        # Wait for tasks to complete
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    except Exception as e:
        logger.error(f"❌ Server error: {e}")
        shutdown_event.set()

    finally:
        logger.info("✅ Server shutdown complete")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("👋 Server interrupted")
    except Exception as e:
        logger.error(f"❌ Failed to start server: {e}")
        sys.exit(1)
    finally:
        logger.info("👋 Google Search AI MCP Server shutdown complete")
