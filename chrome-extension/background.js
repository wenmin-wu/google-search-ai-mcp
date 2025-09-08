/**
 * Background Script for Google Search AI MCP Chrome Extension
 * Handles WebSocket connection to MCP server and coordinates with content scripts.
 */

import { Logger } from './utils/logger.js';

// Configuration
const DEFAULT_MCP_SERVER_URL = 'ws://localhost:8761';


// Simple WebSocket Connection Manager
class SimpleConnectionManager {
  constructor() {
    this.logger = new Logger('ConnectionManager');
    this.mcpServerUrl = DEFAULT_MCP_SERVER_URL;
    this.websocket = null;
    this.isConnected = false;
    this.persistentTab = null; // Single persistent tab for all conversations
    
    // Load saved WebSocket URL from storage
    this.loadSavedUrl();

    // Generate unique client ID for this browser instance
    this.clientId = this.generateClientId();
    this.logger.info(`🆔 Client ID generated: ${this.clientId}`);

    // Request processing to prevent duplicates
    this.processedRequestIds = new Set();
    this.requestCleanupTimers = new Map();

    // Statistics
    this.stats = {
      successfulMessages: 0,
      failedMessages: 0,
      totalConnections: 0
    };

    // Connection retry logic
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
  }

  generateClientId() {
    // Generate unique client ID for this browser instance
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 8);
    return `client_${timestamp}_${randomStr}`;
  }

  async init() {
    this.logger.info('🚀 Initializing Simple Connection Manager...');
    await this.loadSavedUrl(); // Ensure URL is loaded first
    await this.connect();
    this.setupContentScriptMessageHandlers();
    this.logger.info('✅ Simple Connection Manager initialized');
  }

  async connect() {
    if (this.websocket && this.isConnected) {
      this.logger.info('✅ Already connected to MCP server');
      return;
    }

    try {
      this.logger.info(`🔌 Connecting to MCP server: ${this.mcpServerUrl}`);

      this.websocket = new WebSocket(this.mcpServerUrl);

      this.setupWebSocketEventHandlers();

      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);

        this.websocket.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };

        this.websocket.onerror = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      });

    } catch (error) {
      this.logger.error('❌ Connection failed:', error);
      this.scheduleReconnect();
      throw error;
    }
  }

  setupWebSocketEventHandlers() {
    this.websocket.onopen = () => {
      this.logger.info(`✅ Connected to MCP server`);
      this.isConnected = true;
      this.stats.totalConnections++;
      this.reconnectAttempts = 0; // Reset on successful connection
      
      // Notify popup about connection status change
      this.broadcastStatusUpdate();
    };

    this.websocket.onclose = (event) => {
      this.logger.warn(`🔌 Disconnected from MCP server: ${event.reason}`);
      this.isConnected = false;
      this.scheduleReconnect();
      
      // Notify popup about connection status change
      this.broadcastStatusUpdate();
    };

    this.websocket.onerror = (error) => {
      this.logger.error('❌ WebSocket error:', error);
    };

    this.websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleServerMessage(data);
      } catch (error) {
        this.logger.error('❌ Error parsing server message:', error);
      }
    };
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    this.logger.info(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    setTimeout(() => {
      this.connect().catch(error => {
        this.logger.error('❌ Reconnection failed:', error);
      });
    }, delay);
  }

  handleServerMessage(data) {
    this.logger.info('🔔 Received message from server:', data.type);

    switch (data.type) {
      case 'connection_established':
        this.logger.info(`✅ Server confirmed connection: ${data.connection_id}`);
        // Update connection status and broadcast to popup
        this.isConnected = true;
        this.broadcastStatusUpdate();
        break;
      case 'CONVERSATION_START':
        this.handleConversationStart(data);
        break;
      case 'CONVERSATION_MESSAGE':
        this.handleConversationMessage(data);
        break;
      case 'END_CONVERSATION':
        this.handleEndConversation(data);
        break;
      default:
        this.logger.warn(`⚠️ Unknown message type: ${data.type}`);
    }
  }

  // Request deduplication methods
  isRequestProcessed(requestId) {
    return this.processedRequestIds.has(requestId);
  }

  markRequestAsProcessing(requestId, instanceId = 'unknown') {
    this.processedRequestIds.add(requestId);
    this.logger.debug(`✅ Marked ${requestId} as processing by ${instanceId}`);

    // Auto cleanup after 15 seconds
    const cleanupTimer = setTimeout(() => {
      this.processedRequestIds.delete(requestId);
      this.requestCleanupTimers.delete(requestId);
      this.logger.trace(`🧹 Cleaned up ${requestId} from background tracking`);
    }, 15000);

    this.requestCleanupTimers.set(requestId, cleanupTimer);
  }

  // Content script message handlers
  setupContentScriptMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'CHECK_REQUEST_PROCESSED') {
        const { requestId } = message;
        const processed = this.isRequestProcessed(requestId);
        this.logger.debug(`🎭 Background check: ${requestId} processed=${processed}`);
        sendResponse({ processed });
        return true;
      }

      if (message.type === 'MARK_REQUEST_PROCESSING') {
        const { requestId, instanceId } = message;
        this.markRequestAsProcessing(requestId, instanceId);
        sendResponse({ marked: true });
        return true;
      }

      return false;
    });
  }

  async createPersistentTab() {
    this.logger.info('🆕 Creating persistent tab for all conversations...');

    try {
      const tab = await chrome.tabs.create({
        url: 'https://www.google.com/search?udm=50',
        active: true  // Keep active so it can receive messages
      });

      this.persistentTab = tab.id;
      this.logger.info(`✅ Created persistent tab ${this.persistentTab}`);

      // Wait for tab to be ready
      await this.waitForTabReady(this.persistentTab);
      this.logger.info(`✅ Persistent tab ${this.persistentTab} is ready`);

    } catch (error) {
      this.logger.error('❌ Failed to create persistent tab:', error);
      throw error;
    }
  }

  async ensurePersistentTabExists() {
    // First try to find any existing Google Search tab
    const existingTab = await this.findGoogleSearchTab();
    if (existingTab) {
      this.persistentTab = existingTab.id;
      this.logger.info(`✅ Found existing Google Search tab ${this.persistentTab}`);
      return { success: true, tabId: this.persistentTab };
    }

    // Check if our persistent tab still exists
    if (this.persistentTab && await this.isTabValid(this.persistentTab)) {
      return { success: true, tabId: this.persistentTab };
    }

    // No tab available - return message instead of throwing error
    if (!this.persistentTab) {
      this.logger.info('🚫 No persistent tab available - user needs to click extension icon first');
      return {
        success: false,
        message: '🚫 No Google Search tab available. Please click the extension icon to create a tab first.'
      };
    } else {
      this.logger.warn('⚠️ Persistent tab invalid, recreating...');
      await this.createPersistentTab();
      return { success: true, tabId: this.persistentTab };
    }
  }

  async findGoogleSearchTab() {
    try {
      // Find any active tab with Google Search URL
      const tabs = await chrome.tabs.query({
        url: "https://www.google.com/search*",
        active: true
      });
      return tabs.length > 0 ? tabs[0] : null;
    } catch (error) {
      this.logger.warn('⚠️ Error finding Google Search tab:', error);
      return null;
    }
  }

  async handleConversationStart(data) {
    const request_id = data.request_id;
    const { conversation_id, message } = data.data;

    this.logger.info(`🚀 Starting conversation ${conversation_id}`);

    try {
      // Check if tab is available
      const tabResult = await this.ensurePersistentTabExists();

      if (!tabResult.success) {
        // No tab available - send helpful message to MCP client
        this.sendResponse('conversation_response', {
          request_id,
          data: {
            conversation_id,
            message_id: `msg_${Date.now()}`,
            content: tabResult.message,
            needs_tab: true  // Flag to indicate user action needed
          }
        });
        this.stats.successfulMessages++;
        this.logger.info(`✅ Sent tab creation message for ${conversation_id}`);
        return;
      }

      // Send message to content script
      const response = await this.sendToContentScript(tabResult.tabId, {
        type: 'START_CONVERSATION',
        request_id: request_id,
        data: {
          conversation_id,
          message
        }
      });

      // Send response back to server
      this.sendResponse('conversation_response', {
        request_id,
        data: response
      });

      this.stats.successfulMessages++;
      this.logger.info(`✅ Completed conversation start for ${conversation_id}`);

    } catch (error) {
      this.logger.error('❌ Error starting conversation:', error);

      // Send error back to server
      this.sendResponse('conversation_error', {
        request_id,
        error: error.message,
        data: {
          error: error.message,
          conversation_id
        }
      });

      this.stats.failedMessages++;
    }
  }

  async handleConversationMessage(data) {
    const request_id = data.request_id;
    const { conversation_id, message } = data.data;

    this.logger.info(`💬 Sending message in conversation ${conversation_id}`);

    try {
      // Check if tab is available
      const tabResult = await this.ensurePersistentTabExists();

      if (!tabResult.success) {
        // No tab available - send helpful message to MCP client
        this.sendResponse('conversation_response', {
          request_id,
          data: {
            conversation_id,
            message_id: `msg_${Date.now()}`,
            content: tabResult.message,
            needs_tab: true  // Flag to indicate user action needed
          }
        });
        this.stats.successfulMessages++;
        this.logger.info(`✅ Sent tab creation message for ${conversation_id}`);
        return;
      }

      // Send message to content script
      const response = await this.sendToContentScript(tabResult.tabId, {
        type: 'SEND_MESSAGE',
        request_id: request_id,
        data: {
          conversation_id,
          message
        }
      });

      // Send response back to server
      this.sendResponse('conversation_response', {
        request_id,
        data: response
      });

      this.stats.successfulMessages++;
      this.logger.info(`✅ Completed message send for ${conversation_id}`);

    } catch (error) {
      this.logger.error('❌ Error sending message:', error);

      // Send error back to server
      this.sendResponse('conversation_error', {
        request_id,
        error: error.message,
        data: {
          error: error.message,
          conversation_id
        }
      });

      this.stats.failedMessages++;
    }
  }

  async handleEndConversation(data) {
    const request_id = data.request_id;
    const { conversation_id } = data.data;

    this.logger.info(`🔚 Ending conversation ${conversation_id}`);

    try {
      // Navigate persistent tab back to start page instead of closing
      if (this.persistentTab && await this.isTabValid(this.persistentTab)) {
        await chrome.tabs.update(this.persistentTab, {
          url: 'https://www.google.com/search?udm=50',
          active: true
        });
        this.logger.info(`✅ Reset persistent tab ${this.persistentTab} to start page`);
      }

      // Send confirmation back to server
      this.sendResponse('conversation_response', {
        request_id,
        data: {
          conversation_id,
          status: 'ended'
        }
      });

      this.stats.successfulMessages++;

    } catch (error) {
      this.logger.error('❌ Error ending conversation:', error);

      this.sendResponse('conversation_error', {
        request_id,
        error: error.message,
        data: {
          error: error.message,
          conversation_id
        }
      });

      this.stats.failedMessages++;
    }
  }

  sendResponse(type, data) {
    if (this.websocket && this.isConnected) {
      const message = { type, ...data };
      this.websocket.send(JSON.stringify(message));
      this.logger.debug(`📤 Sent ${type} to server`);
    } else {
      this.logger.error('❌ Cannot send response - WebSocket not connected');
    }
  }

  async isTabValid(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      return tab && !tab.discarded;
    } catch {
      return false;
    }
  }

  async waitForTabReady(tabId, maxWaitTime = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          // Try to ping content script
          try {
            await new Promise((resolve, reject) => {
              chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              });
            });
            this.logger.info(`✅ Tab ${tabId} is ready and content script loaded`);
            return true;
          } catch {
            // Content script not ready, inject it
            await this.ensureContentScriptLoaded(tabId);
          }
        }
      } catch (error) {
        this.logger.warn(`⚠️ Error checking tab ${tabId}:`, error.message);
      }

      await this.sleep(500);
    }

    this.logger.warn(`⚠️ Tab ${tabId} not ready after ${maxWaitTime}ms`);
    return false;
  }

  async ensureContentScriptLoaded(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });

      // Wait a bit for script to initialize
      await this.sleep(1000);
      this.logger.info(`✅ Content script injected into tab ${tabId}`);
    } catch (error) {
      this.logger.warn(`⚠️ Failed to inject content script into tab ${tabId}:`, error.message);
    }
  }

  async sendToContentScript(tabId, message, timeout = 30000) {
    this.logger.debug(`📤 Sending message to tab ${tabId}:`, message.type);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Content script communication timeout'));
      }, timeout);

      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timeoutId);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  async updateServerUrl(newUrl) {
    try {
      this.logger.info(`🔄 Updating server URL from ${this.mcpServerUrl} to ${newUrl}`);

      // Validate URL format
      new URL(newUrl); // This will throw if URL is invalid

      // Disconnect current WebSocket if connected
      if (this.websocket && this.isConnected) {
        this.websocket.close();
        this.isConnected = false;
      }

      // Update URL
      this.mcpServerUrl = newUrl;
      
      // Save URL to storage
      await this.saveUrl(newUrl);

      // Reconnect with new URL
      await this.connect();

      this.logger.info(`✅ Successfully updated server URL to ${newUrl}`);
    } catch (error) {
      this.logger.error(`❌ Failed to update server URL: ${error.message}`);
      throw error;
    }
  }

  getStats() {
    return {
      ...this.stats,
      connected: this.isConnected,
      persistentTabId: this.persistentTab,
      processedRequests: this.processedRequestIds.size,
    };
  }

  // URL Persistence methods
  async loadSavedUrl() {
    try {
      const result = await chrome.storage.local.get(['google_search_ai_mcp_websocket_url']);
      if (result.google_search_ai_mcp_websocket_url) {
        this.mcpServerUrl = result.google_search_ai_mcp_websocket_url;
        this.logger.info(`📁 Loaded saved WebSocket URL: ${this.mcpServerUrl}`);
      } else {
        this.logger.info(`📁 No saved URL found, using default: ${this.mcpServerUrl}`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ Failed to load saved URL: ${error.message}`);
    }
  }

  async saveUrl(url) {
    try {
      await chrome.storage.local.set({ google_search_ai_mcp_websocket_url: url });
      this.logger.info(`💾 Saved WebSocket URL: ${url}`);
    } catch (error) {
      this.logger.warn(`⚠️ Failed to save URL: ${error.message}`);
    }
  }

  // Status broadcasting for popup updates
  broadcastStatusUpdate() {
    // Send message to all listening tabs/popups
    chrome.runtime.sendMessage({
      type: 'CONNECTION_STATUS_UPDATE',
      isConnected: this.isConnected,
      mcpServerUrl: this.mcpServerUrl
    }).catch(() => {
      // Ignore errors - popup might not be open
    });
  }

  // Utility methods
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global connection manager
let connectionManager = null;

// Initialize when extension starts
chrome.runtime.onStartup.addListener(async () => {
  console.log('🚀 Extension startup - initializing connection manager');
  connectionManager = new SimpleConnectionManager();
  await connectionManager.init();
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log('🚀 Extension installed/updated - initializing connection manager');

  connectionManager = new SimpleConnectionManager();
  await connectionManager.init();
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    // Return status info for popup display
    const stats = connectionManager ? {
      isConnected: connectionManager.isConnected,
      clientId: connectionManager.clientId,
      persistentTabId: connectionManager.persistentTab,
      stats: connectionManager.stats,
      mcpServerUrl: connectionManager.mcpServerUrl
    } : {
      isConnected: false,
      error: 'Not initialized'
    };
    
    // Debug logging
    console.log('📊 GET_STATUS request - returning:', {
      hasConnectionManager: !!connectionManager,
      isConnected: connectionManager?.isConnected,
      fullStats: stats
    });
    
    sendResponse(stats);
    return true;
  }

  if (message.type === 'CREATE_TAB') {
    // Create persistent tab when user opens popup
    if (connectionManager && !connectionManager.persistentTab) {
      connectionManager.createPersistentTab().then(() => {
        sendResponse({ success: true, tabId: connectionManager.persistentTab });
      }).catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    } else {
      sendResponse({ success: true, tabId: connectionManager?.persistentTab || null });
    }
    return true;
  }

  if (message.type === 'GET_CONNECTION_STATUS') {
    // Return connection details
    const status = connectionManager ? {
      connected: connectionManager.isConnected,
      mcpServerUrl: connectionManager.mcpServerUrl
    } : {
      connected: false,
      mcpServerUrl: DEFAULT_MCP_SERVER_URL
    };
    sendResponse(status);
    return true;
  }

  if (message.type === 'UPDATE_WEBSOCKET_URL') {
    // Update WebSocket URL
    if (connectionManager && message.url) {
      connectionManager.updateServerUrl(message.url).then(() => {
        sendResponse({ success: true });
      }).catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    } else {
      sendResponse({ success: false, error: 'Manager not initialized or no URL provided' });
    }
    return true;
  }

  if (message.type === 'GET_STATS') {
    const stats = connectionManager ? connectionManager.getStats() : { error: 'Not initialized' };
    sendResponse(stats);
    return true;
  }

  if (message.type === 'RECONNECT') {
    if (connectionManager) {
      connectionManager.connect().then(() => {
        sendResponse({ success: true });
      }).catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    } else {
      sendResponse({ success: false, error: 'Manager not initialized' });
    }
    return true;
  }

  return false;
});

// Initialize connection manager immediately
async function initializeConnectionManager() {
  if (!connectionManager) {
    console.log('🚀 Initializing connection manager on startup...');
    connectionManager = new SimpleConnectionManager();
    try {
      await connectionManager.init();
      console.log('✅ Connection manager initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize connection manager:', error);
    }
  }
}

// Initialize immediately
initializeConnectionManager();
