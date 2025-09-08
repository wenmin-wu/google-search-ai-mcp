# Google Search AI MCP

[中文版本 (Chinese Version)](README-ch.md)

A MCP server and Chrome extension that enables AI agents to conduct conversations with Google Search AI through browser automation.

## 📸 Demo

![Google Search AI MCP Demo](screenshots/cursor-google-search.gif)

## 🌟 Features

✅ **Simple Setup**: WebSocket-based communication
✅ **FastMCP Integration**: Uses stdio transport for seamless MCP client integration  
✅ **Chrome Extension**: Automated Google Search AI interaction  
✅ **HTML Parsing**: Converts Google Search AI responses to clean markdown  
✅ **Multi-Round Conversations**: Supports ongoing conversations with context  

## 🚀 Quick Start

### 1. Install Python Dependencies

```bash
cd google-search-ai-mcp
pip install -r requirements.txt
```

### 2. Start the MCP Server

```bash
# Start the server with default WebSocket port 8761
python server.py

# Or specify custom WebSocket port
WEBSOCKET_PORT=9000 python server.py
```

You should see output like:
```
🚀 Starting Google Search AI MCP Server (Community Version)
🔌 WebSocket Server: ws://0.0.0.0:8761
📡 FastMCP: stdio transport
✅ WebSocket server running on ws://0.0.0.0:8761
```

### 3. Install Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked" 
4. Select the `google-search-ai-mcp/chrome-extension/` folder
5. The extension should appear with a Google AI icon

### 4. Configure the Extension

1. Click the extension icon in Chrome toolbar
2. Click "Configure" if you need to change the WebSocket URL
3. Click "Open Google AI" to open a Google Search AI tab
4. The extension will automatically connect to the MCP server

## 🧪 Usage with AI Agents

### MCP Client Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "google-search-ai": {
      "command": "$(which python)",
      "args": ["/path/to/google-search-ai-mcp/server.py"]
    }
  }
}
```

> **💡 Tip**: Use the full Python path (e.g., `/opt/anaconda3/envs/py310/bin/python3`) instead of `python` to ensure the correct Python environment with installed packages is used. Run `which python` to find your Python path.

### Available MCP Tool

The system provides a single, powerful tool:

#### `chat_search_ai`
Chat with Google Search AI with automatic conversation management.

**Parameters:**
- `message`: Message to send to Google Search AI. Say 'done' to end the conversation.


## 📁 Project Structure

```
google-search-ai-mcp/
├── server.py              # FastMCP server with WebSocket support
├── requirements.txt       # Python dependencies
├── README.md              # This file
└── chrome-extension/      # Chrome extension files
    ├── manifest.json      # Extension manifest
    ├── background.js      # WebSocket client & tab management
    ├── content.js         # Google Search AI automation
    ├── popup.html         # Extension popup UI
    ├── popup.js           # Popup logic
    └── icon*.png          # Extension icons
```

## 🔧 Configuration

### WebSocket Server

The server accepts these environment variables:

- `WEBSOCKET_PORT`: WebSocket server port (default: 8761)

### Chrome Extension

Configure the WebSocket URL in the extension popup:

1. Click extension icon → "Configure"
2. Enter your WebSocket URL (default: `ws://localhost:8761`)
3. Click "Save"

## 🐛 Troubleshooting

### Common Issues

#### Extension Won't Connect
- **Problem**: Popup shows "Disconnected"
- **Solution**: 
  - Ensure MCP server is running on port 8761
  - Check Chrome console for WebSocket errors
  - Verify firewall isn't blocking the connection

#### Google Search AI Not Found
- **Problem**: Content script errors about missing elements
- **Solution**:
  - Navigate to `https://www.google.com/search?udm=50` manually
  - Ensure you're logged into Google
  - Check that Google Search AI is available in your region

#### MCP Server Not Starting
- **Problem**: Import errors or dependency issues
- **Solution**:
  ```bash
  # Reinstall dependencies
  pip install --force-reinstall -r requirements.txt
  
  # Check Python version (3.8+ required)
  python --version
  ```

#### Wrong Python Path in MCP Configuration
- **Problem**: MCP client uses system Python instead of environment with installed packages
- **Solution**: Use the full Python path in your MCP configuration:
  ```bash
  # Find your Python path
  which python
  # Or for Python 3 specifically
  which python3
  ```
  
  Then update your MCP configuration to use the full path:
  ```json
  {
    "mcpServers": {
      "google-search-ai": {
        "command": "/opt/anaconda3/envs/py310/bin/python3",
        "args": ["/path/to/google-search-ai-mcp/server.py"]
      }
    }
  }
  ```
  
  **Common Python paths:**
  - Conda: `/opt/anaconda3/envs/your-env/bin/python3`
  - Homebrew: `/opt/homebrew/bin/python3`
  - System: `/usr/bin/python3`
  - Virtual env: `/path/to/venv/bin/python3`

### Debug Mode

Enable debug logging in the server:

```bash
# Set debug level
LOG_LEVEL=DEBUG python server.py
```

### Testing WebSocket Connection

```bash
# Install wscat if you don't have it
npm install -g wscat

# Connect to WebSocket server
wscat -c ws://localhost:8761

# Send test message
{"type": "connection_test", "data": {"ping": "test"}}
```