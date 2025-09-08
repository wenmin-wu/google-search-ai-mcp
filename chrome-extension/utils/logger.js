/**
 * Shared Logger utility for Google Search AI MCP Chrome Extension
 * Used by both background and content scripts
 */

export class Logger {
  constructor(component = 'Extension') {
    this.component = component;
    this.levels = {
      ERROR: 0,
      WARN: 1, 
      INFO: 2,
      DEBUG: 3,
      TRACE: 4
    };
    this.currentLevel = this.levels.INFO; // Set to INFO for production
  }

  setLevel(level) {
    if (typeof level === 'string' && this.levels[level.toUpperCase()] !== undefined) {
      this.currentLevel = this.levels[level.toUpperCase()];
    } else if (typeof level === 'number') {
      this.currentLevel = level;
    }
  }

  error(...args) {
    if (this.currentLevel >= this.levels.ERROR) {
      console.error(`❌ [${this.component}]`, ...args);
    }
  }

  warn(...args) {
    if (this.currentLevel >= this.levels.WARN) {
      console.warn(`⚠️ [${this.component}]`, ...args);
    }
  }

  info(...args) {
    if (this.currentLevel >= this.levels.INFO) {
      console.log(`ℹ️ [${this.component}]`, ...args);
    }
  }

  debug(...args) {
    if (this.currentLevel >= this.levels.DEBUG) {
      console.log(`🐛 [${this.component}]`, ...args);
    }
  }

  trace(...args) {
    if (this.currentLevel >= this.levels.TRACE) {
      console.log(`🔍 [${this.component}]`, ...args);
    }
  }
}
