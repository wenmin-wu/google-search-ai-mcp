/**
 * Popup Script for Google Search AI MCP Chrome Extension (Community Version)
 * 
 * Provides user interface for:
 * - Connection status monitoring
 * - WebSocket server configuration
 * - Opening Google Search AI tabs
 * - Extension management
 */

class PopupManager {
  constructor() {
    this.isInitialized = false;
    this.refreshInterval = null;
    this.currentStatus = null;

    this.elements = {};
  }

  async init() {
    console.log('🚀 Popup initializing...');

    // Cache DOM elements
    this.cacheElements();

    // Set up event listeners
    this.setupEventListeners();
    
    // Listen for status updates from background
    this.setupBackgroundListener();

    // Trigger connection attempt in background (if not connected)
    await this.sendMessageToBackground({ type: 'RECONNECT' }).catch(() => {});
    
    // Wait a moment then load initial data
    setTimeout(async () => {
      await this.refreshData();
    }, 500);

    // Set up auto-refresh
    this.startAutoRefresh();

    this.isInitialized = true;
    console.log('✅ Popup initialized successfully');
  }

  cacheElements() {
    this.elements = {
      connectionStatus: document.getElementById('connection-status'),
      serverUrl: document.getElementById('server-url'),
      refreshBtn: document.getElementById('refresh-btn'),
      openGoogleAiBtn: document.getElementById('open-google-ai'),
      configureBtn: document.getElementById('configure-btn'),
      configSection: document.getElementById('config-section'),
      websocketUrl: document.getElementById('websocket-url'),
      saveConfigBtn: document.getElementById('save-config-btn'),
      cancelConfigBtn: document.getElementById('cancel-config-btn')
    };
  }

  setupEventListeners() {
    this.elements.refreshBtn.addEventListener('click', async () => {
      console.log('🔄 Manual refresh triggered');
      await this.refreshData();
    });

    this.elements.openGoogleAiBtn.addEventListener('click', () => {
      this.openGoogleAI();
    });

    this.elements.configureBtn.addEventListener('click', () => {
      this.showConfigSection();
    });

    this.elements.saveConfigBtn.addEventListener('click', async () => {
      await this.saveConfiguration();
    });

    this.elements.cancelConfigBtn.addEventListener('click', () => {
      this.hideConfigSection();
    });
  }

  setupBackgroundListener() {
    // Listen for status updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'CONNECTION_STATUS_UPDATE') {
        console.log('📡 Received status update:', message);
        
        // Update current status
        this.currentStatus = {
          ...this.currentStatus,
          isConnected: message.isConnected,
          mcpServerUrl: message.mcpServerUrl
        };
        
        // Update display
        this.updateDisplay();
        
        sendResponse({ received: true });
      }
      return true;
    });
    
    console.log('👂 Background listener setup complete');
  }

  async refreshData() {
    try {
      console.log('🔄 Refreshing popup data...');

      // Get status from background script
      const response = await this.sendMessageToBackground({ type: 'GET_STATUS' });

      if (response && !response.error) {
        this.currentStatus = response;
        console.log('📊 Received status from background:', response);
        console.log('📊 isConnected value:', response.isConnected, typeof response.isConnected);
        this.updateDisplay();
        console.log('📊 Status updated successfully');
      } else {
        console.error('❌ Bad response from background:', response);
        throw new Error(response?.error || 'No response from background script');
      }

    } catch (error) {
      console.error('❌ Error refreshing data:', error);
      this.showDisconnectedState();
    }
  }

  updateDisplay() {
    if (!this.currentStatus) return;

    // Connection status
    this.updateConnectionStatus();

    // Server URL
    this.elements.serverUrl.textContent = this.currentStatus.mcpServerUrl || 'ws://localhost:8761';
  }

  updateConnectionStatus() {
    const statusElement = this.elements.connectionStatus;
    
    // Check if currentStatus exists and has isConnected property
    if (this.currentStatus && typeof this.currentStatus.isConnected === 'boolean') {
      const { isConnected } = this.currentStatus;
      
      if (isConnected) {
        statusElement.innerHTML = `
          <span class="status-indicator connected"></span>
          Connected
        `;
        console.log('✅ Status: Connected');
      } else {
        statusElement.innerHTML = `
          <span class="status-indicator disconnected"></span>
          Disconnected
        `;
        console.log('❌ Status: Disconnected');
      }
    } else {
      // Fallback for missing status
      statusElement.innerHTML = `
        <span class="status-indicator disconnected"></span>
        Unknown
      `;
      console.log('⚠️ Status: Unknown', this.currentStatus);
    }
  }

  showDisconnectedState() {
    this.elements.connectionStatus.innerHTML = `
      <span class="status-indicator disconnected"></span>
      Disconnected
    `;
  }

  async openGoogleAI() {
    try {
      console.log('🔗 Opening Google Search AI...');

      // Open Google Search AI in new tab
      await chrome.tabs.create({
        url: 'https://www.google.com/search?udm=50',
        active: true
      });

      console.log('✅ Google Search AI tab opened');

      // Close popup
      window.close();

    } catch (error) {
      console.error('❌ Error opening Google AI:', error);
    }
  }

  sendMessageToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Background script error:', chrome.runtime.lastError);
          resolve({ error: chrome.runtime.lastError.message || chrome.runtime.lastError });
        } else {
          resolve(response);
        }
      });
    });
  }

  startAutoRefresh() {
    // Refresh every 5 seconds
    this.refreshInterval = setInterval(async () => {
      await this.refreshData();
    }, 5000);

    console.log('⏰ Auto-refresh started (5s interval)');
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('⏹️ Auto-refresh stopped');
    }
  }

  async showConfigSection() {
    this.elements.configSection.classList.add('show');
    
    // Load current WebSocket URL from storage and current status
    try {
      const [storageResult, statusResponse] = await Promise.all([
        chrome.storage.local.get(['google_search_ai_mcp_websocket_url']),
        this.sendMessageToBackground({ type: 'GET_CONNECTION_STATUS' })
      ]);
      
      const savedUrl = storageResult.google_search_ai_mcp_websocket_url || statusResponse?.mcpServerUrl || 'ws://localhost:8761';
      this.elements.websocketUrl.value = savedUrl;
      console.log('💾 Loaded WebSocket URL:', savedUrl);
    } catch (error) {
      console.warn('⚠️ Failed to load WebSocket URL:', error);
      this.elements.websocketUrl.value = 'ws://localhost:8761';
    }
    
    console.log('⚙️ Configuration section opened');
  }

  hideConfigSection() {
    this.elements.configSection.classList.remove('show');
    console.log('⚙️ Configuration section closed');
  }

  async saveConfiguration() {
    try {
      const newUrl = this.elements.websocketUrl.value.trim();
      
      if (!newUrl) {
        console.log('❌ WebSocket URL cannot be empty');
        return;
      }

      // Validate URL format
      try {
        new URL(newUrl);
      } catch (e) {
        console.log('❌ Invalid WebSocket URL format');
        return;
      }

      // Save to storage first
      await chrome.storage.local.set({ google_search_ai_mcp_websocket_url: newUrl });
      console.log('💾 Saved WebSocket URL to storage:', newUrl);

      // Update the WebSocket URL in background script
      const response = await this.sendMessageToBackground({ 
        type: 'UPDATE_WEBSOCKET_URL', 
        url: newUrl 
      });

      if (response && response.success) {
        console.log(`✅ WebSocket URL updated to: ${newUrl}`);
        this.hideConfigSection();
        
        // Refresh data to show new connection status
        setTimeout(() => this.refreshData(), 1000);
      } else {
        console.log('❌ Failed to update WebSocket URL:', response?.error || 'Unknown error');
      }

    } catch (error) {
      console.error('Error saving configuration:', error);
    }
  }

  // Cleanup when popup closes
  cleanup() {
    this.stopAutoRefresh();
    console.log('👋 Popup cleanup complete');
  }
}

// Initialize popup when DOM is ready
let popupManager;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Popup DOM loaded');

  try {
    popupManager = new PopupManager();
    await popupManager.init();
  } catch (error) {
    console.error('❌ Popup initialization failed:', error);
  }
});

// Cleanup when popup is unloaded
window.addEventListener('beforeunload', () => {
  if (popupManager) {
    popupManager.cleanup();
  }
});

// Handle visibility changes
document.addEventListener('visibilitychange', () => {
  if (popupManager) {
    if (document.hidden) {
      popupManager.stopAutoRefresh();
    } else {
      popupManager.startAutoRefresh();
    }
  }
});

console.log('🚀 Google Search AI MCP Extension (Community Version) - Popup Script Loaded');
