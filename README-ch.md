# Google Search AI MCP

[English Version](README.md)

一个 MCP 服务器和 Chrome 扩展，使 AI 代理能够通过浏览器自动化与 Google Search AI 进行对话。

## 📸 演示

![Google Search AI MCP 演示](screenshots/cursor-google-search.gif)

## 🌟 功能特性

✅ **简单设置**: 基于 WebSocket 的通信  
✅ **FastMCP 集成**: 使用 stdio 传输进行无缝 MCP 客户端集成  
✅ **Chrome 扩展**: 自动化 Google Search AI 交互  
✅ **HTML 解析**: 将 Google Search AI 响应转换为干净的 markdown  
✅ **多轮对话**: 支持带上下文的持续对话  

## 🚀 快速开始

### 1. 安装 Python 依赖

```bash
cd google-search-ai-mcp
pip install -r requirements.txt
```

### 2. 启动 MCP 服务器

```bash
# 使用默认 WebSocket 端口 8761 启动服务器
python server.py

# 或者指定自定义 WebSocket 端口
WEBSOCKET_PORT=9000 python server.py
```

您应该看到如下输出：
```
🚀 Starting Google Search AI MCP Server (Community Version)
🔌 WebSocket Server: ws://0.0.0.0:8761
📡 FastMCP: stdio transport
✅ WebSocket server running on ws://0.0.0.0:8761
```

### 3. 安装 Chrome 扩展

1. 打开 Chrome 并访问 `chrome://extensions/`
2. 启用"开发者模式"（右上角的开关）
3. 点击"加载已解压的扩展程序"
4. 选择 `google-search-ai-mcp/chrome-extension/` 文件夹
5. 扩展应该会出现并显示 Google AI 图标

### 4. 配置扩展

1. 点击 Chrome 工具栏中的扩展图标
2. 如果需要更改 WebSocket URL，请点击"配置"
3. 点击"打开 Google AI"来打开 Google Search AI 标签页
4. 扩展将自动连接到 MCP 服务器

## 🧪 与 AI 代理一起使用

### MCP 客户端配置

添加到您的 MCP 客户端配置：

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

> **💡 提示**: 使用完整的 Python 路径（例如 `/opt/anaconda3/envs/py310/bin/python3`）而不是 `python` 来确保使用正确的 Python 环境和已安装的包。运行 `which python` 来查找您的 Python 路径。

### 可用的 MCP 工具

系统提供一个强大的工具：

#### `chat_search_ai`
与 Google Search AI 聊天，自动管理对话。

**参数:**
- `message`: 发送给 Google Search AI 的消息。说 'done' 结束对话。


## 📁 项目结构

```
google-search-ai-mcp/
├── server.py              # 带 WebSocket 支持的 FastMCP 服务器
├── requirements.txt       # Python 依赖
├── README.md              # 英文文档
├── README-ch.md           # 中文文档
└── chrome-extension/      # Chrome 扩展文件
    ├── manifest.json      # 扩展清单
    ├── background.js      # WebSocket 客户端和标签页管理
    ├── content.js         # Google Search AI 自动化
    ├── popup.html         # 扩展弹出界面
    ├── popup.js           # 弹出逻辑
    └── icon*.png          # 扩展图标
```

## 🔧 配置

### WebSocket 服务器

服务器接受以下环境变量：

- `WEBSOCKET_PORT`: WebSocket 服务器端口（默认：8761）

### Chrome 扩展

在扩展弹出窗口中配置 WebSocket URL：

1. 点击扩展图标 → "配置"
2. 输入您的 WebSocket URL（默认：`ws://localhost:8761`）
3. 点击"保存"

## 🐛 故障排除

### 常见问题

#### 扩展无法连接
- **问题**: 弹出窗口显示"已断开连接"
- **解决方案**: 
  - 确保 MCP 服务器在 8761 端口上运行
  - 检查 Chrome 控制台的 WebSocket 错误
  - 验证防火墙没有阻止连接

#### 找不到 Google Search AI
- **问题**: 内容脚本关于缺少元素的错误
- **解决方案**:
  - 手动导航到 `https://www.google.com/search?udm=50`
  - 确保您已登录 Google
  - 检查 Google Search AI 在您的地区是否可用

#### MCP 服务器无法启动
- **问题**: 导入错误或依赖问题
- **解决方案**:
  ```bash
  # 重新安装依赖
  pip install --force-reinstall -r requirements.txt
  
  # 检查 Python 版本（需要 3.8+）
  python --version
  ```

#### MCP 配置中的 Python 路径错误
- **问题**: MCP 客户端使用系统 Python 而不是安装了包的环境
- **解决方案**: 在 MCP 配置中使用完整的 Python 路径：
  ```bash
  # 查找您的 Python 路径
  which python
  # 或者专门查找 Python 3
  which python3
  ```
  
  然后更新您的 MCP 配置以使用完整路径：
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
  
  **常见 Python 路径:**
  - Conda: `/opt/anaconda3/envs/your-env/bin/python3`
  - Homebrew: `/opt/homebrew/bin/python3`
  - 系统: `/usr/bin/python3`
  - 虚拟环境: `/path/to/venv/bin/python3`

### 调试模式

在服务器中启用调试日志记录：

```bash
# 设置调试级别
LOG_LEVEL=DEBUG python server.py
```

### 测试 WebSocket 连接

```bash
# 如果没有 wscat，请先安装
npm install -g wscat

# 连接到 WebSocket 服务器
wscat -c ws://localhost:8761

# 发送测试消息
{"type": "connection_test", "data": {"ping": "test"}}
```
