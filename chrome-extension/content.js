/**
 * Content Script for Google Search AI MCP Chrome Extension
 * 
 * Integrates with Google Search AI interface to:
 * - Send messages to Google Search AI
 * - Wait for response completion
 * - Parse and extract AI responses
 * - Handle multi-round conversations
 * - Convert HTML responses to clean text/markdown
 */

// Global Logger variable - will be set after dynamic import
let Logger = null;

// Import existing Google Search AI interface patterns
// Adapted from notebooks/inspect.ipynb GoogleSearchAIChat implementation

class GoogleSearchAIInterface {
    constructor() {
        this.isInitialized = false;
        this.responseParser = new ResponseParser();
        this.completionDetector = new CompletionDetector();
        this.logger = new Logger('GoogleAI');

        // Configuration
        this.maxWaitTime = 120000; // 2 minutes max wait
        this.pollInterval = 500;   // Check completion every 500ms

        // State management to prevent double submission
        this.isProcessing = false;
        this.lastMessage = null;
        this.lastMessageTime = 0;

        this.logger.info('GoogleSearchAIInterface initialized');
    }

    async initialize() {
        if (this.isInitialized) {
            return true;
        }

        try {
            console.log('🔧 Initializing Google Search AI interface...');

            // Check if we're on a Google Search AI page
            if (!this.isGoogleSearchAIPage()) {
                throw new Error('Not on a Google Search AI page');
            }

            // Wait for page to be fully loaded
            await this.waitForPageLoad();

            this.isInitialized = true;
            console.log('✅ Google Search AI interface initialized');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Google Search AI interface:', error);
            return false;
        }
    }

    isGoogleSearchAIPage() {
        return window.location.hostname === 'www.google.com' &&
            (window.location.pathname.includes('/search') ||
                window.location.search.includes('udm=50'));
    }

    async waitForPageLoad() {
        return new Promise((resolve) => {
            if (document.readyState === 'complete') {
                resolve();
            } else {
                window.addEventListener('load', resolve);
            }
        });
    }

    // Core Google Search AI interaction methods
    // Adapted from notebook implementation

    findTextarea() {
        this.logger.debug('🔍 Looking for textarea element...');

        const selectors = [
            'textarea.ITIRGe[jsname="qyBLR"]',
            'textarea[placeholder*="Ask"]',
            'textarea.ITIRGe',
            'textarea[jsname="qyBLR"]',
            'textarea',  // Fallback to any textarea
            'input[type="text"]' // Even broader fallback
        ];

        this.logger.trace(`Trying ${selectors.length} selectors for textarea`);

        for (let i = 0; i < selectors.length; i++) {
            const selector = selectors[i];
            this.logger.trace(`Selector ${i + 1}/${selectors.length}: ${selector}`);

            try {
                const elements = document.querySelectorAll(selector);
                this.logger.trace(`Found ${elements.length} elements matching: ${selector}`);

                for (let j = 0; j < elements.length; j++) {
                    const element = elements[j];
                    const isVisible = element.offsetParent !== null;
                    const isEnabled = !element.disabled;
                    const hasValidSize = element.offsetWidth > 0 && element.offsetHeight > 0;

                    this.logger.trace(`Element ${j}: visible=${isVisible}, enabled=${isEnabled}, size=${element.offsetWidth}x${element.offsetHeight}`);

                    if (isVisible && isEnabled && hasValidSize) {
                        this.logger.info(`✅ Found textarea using selector: ${selector} (element ${j})`);
                        this.logger.debug(`Textarea details: placeholder="${element.placeholder}", name="${element.name}", id="${element.id}"`);
                        return element;
                    }
                }
            } catch (error) {
                this.logger.trace(`Selector failed: ${selector}`, error.message);
            }
        }

        this.logger.error('❌ No suitable textarea found');
        this.logger.debug('Available textareas on page:', document.querySelectorAll('textarea').length);
        return null;
    }

    findSubmitButton() {
        this.logger.debug('🔍 Looking for submit button...');

        const selectors = [
            'button[jsname="H9tDt"][aria-label="Send"]',
        ];

        this.logger.trace(`Trying ${selectors.length} selectors for submit button`);

        for (let i = 0; i < selectors.length; i++) {
            const selector = selectors[i];
            this.logger.trace(`Selector ${i + 1}/${selectors.length}: ${selector}`);

            try {
                const elements = document.querySelectorAll(selector);
                this.logger.trace(`Found ${elements.length} elements matching: ${selector}`);

                for (let j = 0; j < elements.length; j++) {
                    const element = elements[j];
                    const isVisible = element.offsetParent !== null;
                    const isEnabled = !element.disabled;
                    const hasValidSize = element.offsetWidth > 0 && element.offsetHeight > 0;
                    const text = element.textContent || element.value || element.ariaLabel || element.title || '';

                    this.logger.trace(`Button ${j}: visible=${isVisible}, enabled=${isEnabled}, size=${element.offsetWidth}x${element.offsetHeight}, text="${text}"`);

                    if (isVisible && isEnabled && hasValidSize) {
                        this.logger.info(`✅ Found submit button using selector: ${selector} (element ${j})`);
                        this.logger.debug(`Button details: text="${text}", aria-label="${element.ariaLabel}", type="${element.type}", title="${element.title}"`);
                        return element;
                    }
                }
            } catch (error) {
                this.logger.trace(`Selector failed: ${selector}`, error.message);
            }
        }

        this.logger.error('❌ No suitable submit button found');
        this.logger.debug('Available buttons on page:', document.querySelectorAll('button').length);

        // Debug: Show all button details
        const allButtons = document.querySelectorAll('button');
        this.logger.debug('All buttons details:');
        for (let i = 0; i < Math.min(10, allButtons.length); i++) { // Show first 10
            const btn = allButtons[i];
            this.logger.trace(`Button ${i}: text="${btn.textContent?.trim() || ''}", aria-label="${btn.ariaLabel || ''}", title="${btn.title || ''}", disabled=${btn.disabled}, visible=${btn.offsetParent !== null}`);
        }

        return null;
    }

    async sendMessage(message) {
        this.logger.info(`📤 Sending message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

        // Prevent double submission
        const currentTime = Date.now();
        const timeSinceLastMessage = currentTime - this.lastMessageTime;

        if (this.isProcessing) {
            this.logger.warn('⚠️ Already processing a message, skipping duplicate submission');
            throw new Error('Already processing a message');
        }

        if (this.lastMessage === message && timeSinceLastMessage < 2000) { // 2 second threshold (reduced from 5)
            this.logger.warn('⚠️ Duplicate message detected within 2 seconds, skipping');
            throw new Error('Duplicate message detected');
        }

        // Mark as processing and store message info
        this.isProcessing = true;
        this.lastMessage = message;
        this.lastMessageTime = currentTime;

        try {
            // Step 1: Find textarea first
            this.logger.debug('🔍 Finding textarea...');
            const textarea = this.findTextarea();

            if (!textarea) {
                this.logger.error('❌ Could not find message input textarea');
                throw new Error('Could not find message input textarea');
            }

            this.logger.info('✅ Found textarea, now typing message...');

            // Step 2: Clear existing text and focus
            this.logger.debug('🧹 Clearing existing text and focusing textarea');
            textarea.value = '';
            textarea.focus();

            // Wait for focus
            await this.sleep(100);

            // Step 3: Type message character by character to trigger events
            this.logger.debug(`⌨️ Typing message (${message.length} characters)...`);
            for (let i = 0; i < message.length; i++) {
                textarea.value += message[i];

                // Trigger input events
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('keydown', { bubbles: true }));

                // Small delay to mimic human typing
                await this.sleep(10);

                // Log progress for long messages
                if (message.length > 100 && i % 50 === 0) {
                    this.logger.trace(`Typing progress: ${i + 1}/${message.length}`);
                }
            }

            // Step 4: Final events after typing
            this.logger.debug('🎯 Dispatching final events...');
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('keyup', { bubbles: true }));

            // Verify the text was entered
            if (textarea.value !== message) {
                this.logger.warn(`⚠️ Text verification failed. Expected: "${message}", Got: "${textarea.value}"`);
            }

            // Step 5: NOW find submit button (after text is typed)
            this.logger.debug('🔍 Now looking for submit button (after typing)...');
            await this.sleep(300); // Wait for UI to update

            const submitBtn = this.findSubmitButton();

            if (!submitBtn) {
                this.logger.error('❌ Could not find submit button after typing message');
                throw new Error('Could not find submit button after typing message');
            }

            this.logger.info('✅ Found submit button after typing!');

            // Step 6: Wait for button to become active and check if enabled
            this.logger.debug('⏳ Waiting for button to become active...');
            await this.sleep(500);

            if (submitBtn.disabled) {
                this.logger.warn('⚠️ Submit button is disabled, waiting longer...');
                await this.sleep(1500);

                // Check again if still disabled
                if (submitBtn.disabled) {
                    this.logger.error('❌ Submit button remains disabled after waiting');
                    throw new Error('Submit button is disabled and cannot be clicked');
                }
            }

            // Step 7: Click submit button
            this.logger.info('🖱️ Clicking submit button...');
            this.logger.debug(`Button state: enabled=${!submitBtn.disabled}, visible=${submitBtn.offsetParent !== null}`);

            submitBtn.click();

            // Step 8: Verify the click worked (message should be cleared)
            await this.sleep(200);
            if (textarea.value === message) {
                this.logger.warn('⚠️ Textarea still contains message after submit - click may have failed');
            } else {
                this.logger.debug('✅ Textarea cleared after submit - click successful');
            }

            this.logger.info('✅ Message sent successfully');
            return true;

        } catch (error) {
            this.logger.error('❌ Error sending message:', error);
            throw error;
        } finally {
            // Always reset processing flag
            this.isProcessing = false;
        }
    }

    async waitForCompletion(timeout = 60000, responseIndex = 1) {
        console.log(`⏳ Waiting for AI response #${responseIndex} completion...`);

        const startTime = Date.now();
        const maxWaitTime = Math.min(timeout, this.maxWaitTime);

        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Check completion for the specific response index
                if (this.completionDetector.isComplete(responseIndex)) {
                    console.log(`✅ AI response #${responseIndex} completed`);
                    return true;
                }

                // Log progress periodically
                if ((Date.now() - startTime) % 5000 === 0) {
                    console.log(`⏳ Still waiting for response #${responseIndex}... (${Math.round((Date.now() - startTime) / 1000)}s)`);
                }

                await this.sleep(this.pollInterval);

            } catch (error) {
                console.error(`❌ Error checking completion for response #${responseIndex}:`, error);
                await this.sleep(1000);
            }
        }

        console.log(`⚠️ Response #${responseIndex} completion timeout reached`);
        return false;
    }

    async parseAIReply(responseIndex = 1) {
        console.log(`📖 Parsing AI response #${responseIndex}...`);

        try {
            // Get the response content for the specific index
            const responseData = await this.responseParser.extractResponse(responseIndex);

            if (!responseData) {
                throw new Error(`No response #${responseIndex} content found`);
            }

            console.log(`✅ Parsed response #${responseIndex}: ${responseData.content.length} characters`);
            return responseData;

        } catch (error) {
            console.error(`❌ Error parsing AI reply #${responseIndex}:`, error);
            throw error;
        }
    }

    // Utility methods
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async extractUserMessage() {
        // Extract the user's message from the conversation
        const userMsgSelectors = [
            '[data-test-id="user-message"]',
            '.user-message',
            '[role="user"]'
        ];

        for (const selector of userMsgSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                return element.textContent.trim();
            }
        }

        return null;
    }
}

class CompletionDetector {
    constructor() {
        // Only use the specific completion check
    }

    isComplete(responseIndex = 1) {
        try {
            return this.checkCircledClassWithThumbsDownButton(responseIndex);
        } catch (error) {
            console.debug(`⚠️ Completion detection failed for response #${responseIndex}:`, error);
            return false;
        }
    }

    checkCircledClassWithThumbsDownButton(responseIndex = 1) {
        // Use XPath to find the nth container with circled class that contains thumbs down button
        const xpath = `(//div[contains(@class, 'zkL70c')][.//button[contains(@aria-label, 'Thumbs down') or contains(@aria-label, 'thumbs down')]])[${responseIndex}]//button[contains(@aria-label, 'Thumbs down') or contains(@aria-label, 'thumbs down')]`;

        try {
            const result = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );

            if (result.singleNodeValue) {
                // Found thumbs down button within the nth circled class container
                const thumbsButton = result.singleNodeValue;
                const circledContainer = thumbsButton.closest('.zkL70c');

                if (circledContainer && thumbsButton.offsetParent !== null && !thumbsButton.disabled) {
                    console.log(`✅ Completion detected: zkL70c container #${responseIndex} with enabled thumbs down button found`);
                    console.log(`🎯 Container classes: ${circledContainer.className}`);
                    console.log(`👍 Button aria-label: ${thumbsButton.getAttribute('aria-label')}`);
                    return true;
                }
            }
        } catch (error) {
            console.debug(`XPath evaluation failed for response #${responseIndex}:`, error);

            // Fallback: use querySelector with index
            return this.fallbackCheck(responseIndex);
        }

        return false;
    }

    fallbackCheck(responseIndex = 1) {
        // Fallback method using querySelector with index
        const circledElements = document.querySelectorAll('.zkL70c');

        // Count containers that have thumbs down buttons
        let validContainerCount = 0;

        for (const circledElement of circledElements) {
            // Look for thumbs down button within this circled element
            const thumbsButton = circledElement.querySelector('button[aria-label*="Thumbs down"], button[aria-label*="thumbs down"]');

            if (thumbsButton) {
                validContainerCount++;

                // Check if this is the nth valid container we're looking for
                if (validContainerCount === responseIndex) {
                    if (thumbsButton.offsetParent !== null && !thumbsButton.disabled) {
                        console.log(`✅ Completion detected (fallback): zkL70c container #${responseIndex} with thumbs down button`);
                        return true;
                    }
                }
            }
        }

        console.log(`⏳ Response #${responseIndex} not yet complete (found ${validContainerCount} completed responses)`);
        return false;
    }
}

class ResponseParser {
    constructor() {
        this.markdownConverter = new HTMLToMarkdownConverter();
        this.logger = new Logger('ResponseParser');
    }

    async extractResponse(responseIndex = 1) {
        // Find response content containers - get the nth response
        const responseSelectors = [
            '.pWvJNd',                    // Primary selector
        ];

        let responseElement = null;

        for (const selector of responseSelectors) {
            const elements = document.querySelectorAll(selector);
            this.logger.trace(`Trying selector ${selector}: found ${elements.length} elements for response #${responseIndex}`);

            // Get the nth element that has sufficient content
            let validElementCount = 0;
            for (const element of elements) {
                if (element?.innerHTML && element.innerHTML.trim().length > 50) {
                    validElementCount++;

                    // Check if this is the nth valid element we're looking for
                    if (validElementCount === responseIndex) {
                        this.logger.info(`🎯 Found response #${responseIndex} using selector: ${selector} (${element.innerHTML.length} chars)`);

                        // Check if this element has thumbs down button (for verification)
                        const hasThumbsButton = element.querySelector('button[aria-label*="Thumbs down"], button[aria-label*="thumbs down"]');
                        this.logger.debug(`Thumbs button present in response #${responseIndex}: ${!!hasThumbsButton}`);

                        responseElement = element;
                        break;
                    }
                }
            }

            if (responseElement) break;
        }

        if (!responseElement) {
            this.logger.error(`❌ Could not find response #${responseIndex} content with any selector`);
            this.logger.debug('Available elements on page:');
            for (const selector of responseSelectors) {
                const elements = document.querySelectorAll(selector);
                const validElements = Array.from(elements).filter(el => el?.innerHTML && el.innerHTML.trim().length > 50);
                this.logger.debug(`- ${selector}: ${elements.length} total, ${validElements.length} valid elements`);
            }
            throw new Error(`Could not find response #${responseIndex} content`);
        }

        // Extract content excluding footer elements (cleaner than backend cleanup)
        const cleanedElement = this.removeFooterElements(responseElement.cloneNode(true));
        const htmlContent = cleanedElement.innerHTML;
        const textContent = cleanedElement.textContent || cleanedElement.innerText || '';

        // Extract basic metadata
        const metadata = this.extractMetadata(responseElement);

        this.logger.info(`📤 Sending ${htmlContent.length} chars of raw HTML to backend for parsing`);
        this.logger.debug(`📝 Basic text preview: ${textContent.substring(0, 200)}...`);

        return {
            content: textContent.trim(), // Basic text fallback
            html_content: htmlContent,   // Raw HTML for backend processing
            metadata: metadata,
            completion_time: performance.now() / 1000, // Convert to seconds
            needs_parsing: true          // Flag to indicate backend should parse HTML
        };
    }

    removeFooterElements(element) {
        // Remove footer elements more precisely to avoid removing actual content
        // Only remove elements that are PRIMARILY footer content, not mixed content

        // 1. Remove small divs that are exclusively footer links
        const links = element.querySelectorAll('a[href*="support.google.com"], a[href*="policies.google.com"]');
        links.forEach(link => {
            // Only remove the immediate parent if it's small and mostly footer content
            let parent = link.parentElement;
            if (parent && parent.tagName.toLowerCase() === 'div') {
                const parentText = parent.textContent || '';
                const parentTextLength = parentText.trim().length;

                // Only remove if it's a small div (< 100 chars) and primarily footer content
                if (parentTextLength < 100 &&
                    (parentText.includes('Learn more') ||
                        parentText.includes('Privacy Policy') ||
                        parentText.includes('support.google.com'))) {
                    parent.remove();
                }
            }
        });

        // 2. Remove specific small footer divs (not large content containers)
        const footerTexts = [
            'AI responses may include mistakes',
            'Your feedback helps Google improve',
            'Creating a public link',
            'Share more feedback',
            'Report a problem',
            'Close'  // Often just a close button
        ];

        const allDivs = element.querySelectorAll('div');
        allDivs.forEach(div => {
            const text = (div.textContent || '').trim();
            const textLength = text.length;

            // Only remove small divs (< 200 chars) that match footer patterns exactly
            // This prevents removing large content divs that might contain these phrases
            if (textLength < 200 && footerTexts.some(footerText => {
                // Check if the text is PRIMARILY this footer text (not just contains it)
                const footerRatio = footerText.length / Math.max(textLength, 1);
                return text.includes(footerText) && (footerRatio > 0.3 || textLength < 50);
            })) {
                div.remove();
            }
        });

        // 3. Remove elements that are clearly just action buttons/feedback UI
        const actionElements = element.querySelectorAll('button, [role="button"]');
        actionElements.forEach(button => {
            const buttonText = (button.textContent || '').trim().toLowerCase();
            const buttonActions = ['close', 'share', 'report', 'feedback'];

            if (buttonActions.some(action => buttonText === action)) {
                // Remove the button and its immediate container if it's small
                let container = button.parentElement;
                if (container && container.tagName.toLowerCase() === 'div' &&
                    (container.textContent || '').trim().length < 50) {
                    container.remove();
                } else {
                    button.remove();
                }
            }
        });

        return element;
    }

    extractMetadata(element) {
        const metadata = {
            sources: [],
            images: [],
            links: []
        };

        try {
            // Extract source citations
            const sourceElements = element.querySelectorAll('a[href*="source"], .source, [data-source]');
            metadata.sources = Array.from(sourceElements).map(el => ({
                text: el.textContent.trim(),
                url: el.href || el.dataset.source
            }));

            // Extract images
            const imageElements = element.querySelectorAll('img');
            metadata.images = Array.from(imageElements).map(img => ({
                src: img.src,
                alt: img.alt,
                width: img.width,
                height: img.height
            }));

            // Extract links
            const linkElements = element.querySelectorAll('a[href]');
            metadata.links = Array.from(linkElements).map(link => ({
                text: link.textContent.trim(),
                url: link.href,
                title: link.title
            }));

        } catch (error) {
            console.error('❌ Error extracting metadata:', error);
        }

        return metadata;
    }
}

class HTMLToMarkdownConverter {
    convert(html) {
        // Create a temporary container
        const container = document.createElement('div');
        container.innerHTML = html;

        // Remove script and style elements
        container.querySelectorAll('script, style').forEach(el => {
            el.remove();
        });

        // Convert HTML to markdown-like text
        return this.processNode(container);
    }

    processNode(node) {
        let result = '';

        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                result += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();

                switch (tagName) {
                    case 'h1':
                        result += `\n# ${this.processNode(child)}\n\n`;
                        break;
                    case 'h2':
                        result += `\n## ${this.processNode(child)}\n\n`;
                        break;
                    case 'h3':
                        result += `\n### ${this.processNode(child)}\n\n`;
                        break;
                    case 'p':
                        result += `\n${this.processNode(child)}\n\n`;
                        break;
                    case 'br':
                        result += '\n';
                        break;
                    case 'strong':
                    case 'b':
                        result += `**${this.processNode(child)}**`;
                        break;
                    case 'em':
                    case 'i':
                        result += `*${this.processNode(child)}*`;
                        break;
                    case 'a': {
                        const href = child.getAttribute('href');
                        const text = this.processNode(child);
                        if (href && href !== text) {
                            result += `[${text}](${href})`;
                        } else {
                            result += text;
                        }
                        break;
                    }
                    case 'ul':
                        result += `\n${this.processNode(child)}\n`;
                        break;
                    case 'ol':
                        result += `\n${this.processNode(child)}\n`;
                        break;
                    case 'li':
                        result += `- ${this.processNode(child)}\n`;
                        break;
                    case 'code':
                        result += `\`${this.processNode(child)}\``;
                        break;
                    case 'pre':
                        result += `\n\`\`\`\n${this.processNode(child)}\n\`\`\`\n\n`;
                        break;
                    default:
                        result += this.processNode(child);
                }
            }
        }

        return result;
    }
}

// Main content script logic
class ContentScriptHandler {
    constructor() {
        this.googleAI = new GoogleSearchAIInterface();
        this.isInitialized = false;
        this.logger = new Logger('ContentHandler');

        // Track incoming messages to prevent duplicates at handler level
        this.recentMessages = new Map(); // message_type + conversation_id -> timestamp
        this.duplicateThreshold = 1000; // 1 second (reduced from 3 seconds)

        // Conversation state tracking for response counting
        this.conversationStates = new Map(); // conversation_id -> { responseCount: number, startTime: timestamp }

        // Unique instance identifier
        this.instanceId = Math.random().toString(36).substring(2, 8);
        this.logger.info(`🆔 Content script instance: ${this.instanceId}`);
    }

    // Conversation state management
    initializeConversationState(conversationId) {
        if (!this.conversationStates.has(conversationId)) {
            this.conversationStates.set(conversationId, {
                responseCount: 0,
                startTime: Date.now()
            });
            this.logger.info(`🆕 Initialized conversation state for ${conversationId}`);
        }
        return this.conversationStates.get(conversationId);
    }

    getNextResponseIndex(conversationId) {
        const state = this.initializeConversationState(conversationId);
        state.responseCount += 1;
        this.logger.info(`📊 Conversation ${conversationId}: expecting response #${state.responseCount}`);
        return state.responseCount;
    }

    getCurrentResponseIndex(conversationId) {
        const state = this.conversationStates.get(conversationId);
        return state ? state.responseCount : 1; // Default to 1 if no state
    }

    // Request result sharing methods
    isRequestBeingProcessed(requestId) {
        try {
            const processingData = localStorage.getItem(`mcp_processing_${requestId}`);
            if (processingData) {
                this.logger.debug(`🔄 Found ${requestId} currently being processed`);
                return true;
            }
            return false;
        } catch (error) {
            this.logger.warn('⚠️ localStorage check failed:', error);
            return false; // Fail open - allow processing
        }
    }

    markRequestAsProcessing(requestId) {
        try {
            const processingData = {
                startTime: Date.now(),
                instanceId: this.instanceId,
                status: 'processing'
            };
            localStorage.setItem(`mcp_processing_${requestId}`, JSON.stringify(processingData));
            this.logger.debug(`🔄 Marked ${requestId} as processing by instance ${this.instanceId}`);

            // Set expiration cleanup (30 seconds - longer for AI processing)
            setTimeout(() => {
                try {
                    localStorage.removeItem(`mcp_processing_${requestId}`);
                    localStorage.removeItem(`mcp_result_${requestId}`);
                    this.logger.trace(`🧹 Cleaned up ${requestId} processing data`);
                } catch (error) {
                    this.logger.trace('Clean up error:', error);
                }
            }, 30000);
        } catch (error) {
            this.logger.warn('⚠️ localStorage mark failed:', error);
        }
    }

    storeRequestResult(requestId, response) {
        try {
            const resultData = {
                response: response,
                completedAt: Date.now(),
                instanceId: this.instanceId
            };
            localStorage.setItem(`mcp_result_${requestId}`, JSON.stringify(resultData));
            // Update processing status to completed
            const processingData = JSON.parse(localStorage.getItem(`mcp_processing_${requestId}`) || '{}');
            processingData.status = 'completed';
            processingData.completedAt = Date.now();
            localStorage.setItem(`mcp_processing_${requestId}`, JSON.stringify(processingData));
            this.logger.info(`✅ Stored result for ${requestId}`);
        } catch (error) {
            this.logger.warn('⚠️ Failed to store request result:', error);
        }
    }

    async waitForRequestResult(requestId, sendResponse, maxWaitTime = 60000) {
        this.logger.info(`⏳ Waiting for original request ${requestId} to complete...`);
        const startTime = Date.now();
        const pollInterval = 500; // Check every 500ms

        const checkForResult = () => {
            try {
                // Check if result is available
                const resultData = localStorage.getItem(`mcp_result_${requestId}`);
                if (resultData) {
                    const result = JSON.parse(resultData);
                    this.logger.info(`✅ Got shared result for ${requestId} from instance ${result.instanceId}`);
                    sendResponse(result.response);
                    return true;
                }

                // Check if original request is still processing
                const processingData = localStorage.getItem(`mcp_processing_${requestId}`);
                if (processingData) {
                    const processing = JSON.parse(processingData);
                    if (processing.status === 'completed') {
                        // Should have result, but check anyway
                        return false; // Continue polling for result
                    }
                    if (Date.now() - processing.startTime > maxWaitTime) {
                        this.logger.warn(`⏰ Timeout waiting for ${requestId} after ${maxWaitTime}ms`);
                        sendResponse({
                            error: 'Request timeout - original request took too long',
                            conversation_id: 'unknown',
                            message_id: `timeout_${Date.now()}`
                        });
                        return true;
                    }
                    return false; // Still processing, continue waiting
                } else {
                    // No processing data - original may have failed or completed
                    this.logger.warn(`⚠️ No processing data found for ${requestId}, giving up wait`);
                    sendResponse({
                        error: 'Original request processing data not found',
                        conversation_id: 'unknown',
                        message_id: `missing_${Date.now()}`
                    });
                    return true;
                }
            } catch (error) {
                this.logger.error('❌ Error checking for request result:', error);
                sendResponse({
                    error: `Error waiting for result: ${error.message}`,
                    conversation_id: 'unknown',
                    message_id: `error_${Date.now()}`
                });
                return true;
            }
        };

        // Start polling
        const pollForResult = () => {
            if (checkForResult()) {
                return; // Done - either got result or error
            }

            if (Date.now() - startTime < maxWaitTime) {
                setTimeout(pollForResult, pollInterval);
            } else {
                this.logger.warn(`⏰ Max wait time exceeded for ${requestId}`);
                sendResponse({
                    error: 'Maximum wait time exceeded',
                    conversation_id: 'unknown',
                    message_id: `maxwait_${Date.now()}`
                });
            }
        };

        // Start the polling
        pollForResult();
    }

    // Wrapper to send response and store result for duplicate requests
    sendResponseAndStore(requestId, response, sendResponse) {
        // Store result for duplicate requests
        if (requestId) {
            this.storeRequestResult(requestId, response);
            this.logger.info(`💾 Stored result for requestId ${requestId} - other instances can now access it`);
        }

        // Send the response
        sendResponse(response);
    }

    // Background script coordination methods
    async checkWithBackgroundScript(requestId) {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    type: 'CHECK_REQUEST_PROCESSED',
                    requestId: requestId,
                    instanceId: `content_${this.instanceId || 'unknown'}`
                }, (response) => {
                    resolve(response);
                });
            });

            if (response?.processed) {
                this.logger.debug(`🎭 Background confirmed ${requestId} already processed`);
                return true;
            }
            return false;
        } catch (error) {
            this.logger.warn('⚠️ Background script check failed:', error);
            return false; // Fail open - allow processing
        }
    }

    notifyBackgroundProcessing(requestId) {
        try {
            chrome.runtime.sendMessage({
                type: 'MARK_REQUEST_PROCESSING',
                requestId: requestId,
                instanceId: `content_${this.instanceId || 'unknown'}`
            });
            this.logger.debug(`🎭 Notified background about processing ${requestId}`);
        } catch (error) {
            this.logger.warn('⚠️ Background notification failed:', error);
        }
    }

    async init() {
        this.logger.info('🚀 Content script initializing...');
        this.logger.debug(`Page URL: ${window.location.href}`);
        this.logger.debug(`Page title: ${document.title}`);
        this.logger.debug(`DOM ready state: ${document.readyState}`);

        try {
            // Check if we're on the right page
            if (!window.location.hostname.includes('google.com')) {
                this.logger.warn('⚠️ Not on Google.com - content script may not work properly');
            }

            // Initialize Google Search AI interface
            this.logger.debug('🔧 Initializing Google Search AI interface...');
            await this.googleAI.initialize();
            this.isInitialized = true;

            // Set up message listener
            this.logger.debug('📡 Setting up message listener...');
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                this.handleMessage(message, sender, sendResponse);
                return true; // Keep message channel open for async responses
            });

            this.logger.info('✅ Content script initialized successfully');

        } catch (error) {
            this.logger.error('❌ Content script initialization failed:', error);
        }
    }

    async handleMessage(message, _sender, sendResponse) {
        this.logger.info('📥 Content script received message:', message.type);
        this.logger.debug('Full message structure:', JSON.stringify(message, null, 2));

        // Extract requestId from message (sent by server at top level)
        const requestId = message.request_id || message.data?.request_id;

        if (!requestId) {
            this.logger.warn('⚠️ Message missing request_id, processing anyway');
            this.logger.warn('⚠️ Available message keys:', Object.keys(message));
            this.logger.warn('⚠️ Available message.data keys:', message.data ? Object.keys(message.data) : 'no data');
        } else {
            this.logger.info(`✅ Found request_id: ${requestId}`);

            // CHECK 1: Is this request already being processed by another instance?
            if (this.isRequestBeingProcessed(requestId)) {
                this.logger.warn(`🔄 Request ${requestId} already being processed, waiting for result...`);
                // Don't return fake response - wait for the original to complete
                await this.waitForRequestResult(requestId, sendResponse);
                return;
            }

            // CHECK 2: Background script coordination for extra safety
            const isDuplicateFromBackground = await this.checkWithBackgroundScript(requestId);
            if (isDuplicateFromBackground) {
                this.logger.warn(`🎭 Request ${requestId} detected by background script, waiting...`);
                // Don't return fake response - wait for the original to complete  
                await this.waitForRequestResult(requestId, sendResponse);
                return;
            }

            // This is the ORIGINAL request - mark as processing and continue
            this.markRequestAsProcessing(requestId);
            this.notifyBackgroundProcessing(requestId);
            this.logger.info(`🚀 Processing original request ${requestId}`);
        }

        try {
            if (!this.isInitialized) {
                this.logger.error('❌ Content script not initialized');
                throw new Error('Content script not initialized');
            }

            this.logger.debug(`Routing message type: ${message.type} (requestId: ${requestId})`);

            switch (message.type) {
                case 'PING':
                    this.logger.debug('🏓 Received PING, responding with PONG');
                    sendResponse({ type: 'PONG', status: 'ready' });
                    break;

                case 'START_CONVERSATION':
                    this.logger.info(`🚀 Starting conversation... (ID: ${message.data?.conversation_id})`);
                    await this.handleStartConversation(message.data, sendResponse, requestId);
                    this.logger.info(`✅ Finished handling START_CONVERSATION (ID: ${message.data?.conversation_id})`);
                    break;

                case 'SEND_MESSAGE':
                    this.logger.info(`💬 Sending message... (ID: ${message.data?.conversation_id})`);
                    await this.handleSendMessage(message.data, sendResponse, requestId);
                    this.logger.info(`✅ Finished handling SEND_MESSAGE (ID: ${message.data?.conversation_id})`);
                    break;

                default:
                    this.logger.error(`❌ Unknown message type: ${message.type}`);
                    sendResponse({ error: `Unknown message type: ${message.type}` });
                    return;
            }

        } catch (error) {
            this.logger.error('❌ Error handling message:', error);
            sendResponse({
                error: error.message,
                conversation_id: message.data?.conversation_id
            });
        }
    }

    async handleStartConversation(data, sendResponse, requestId = null) {
        const { conversation_id, message } = data;
        const startTime = Date.now();

        this.logger.info(`🚀 [${startTime}] Starting conversation ${conversation_id} with message: "${message}"`);
        this.logger.debug(`START_CONVERSATION handler entry - ID: ${conversation_id}, Message: "${message?.substring(0, 50)}${message?.length > 50 ? '...' : ''}"`);

        try {
            // Get the response index for this conversation (should be 1 for start)
            const responseIndex = this.getNextResponseIndex(conversation_id);
            this.logger.info(`📊 Expecting response #${responseIndex} for conversation ${conversation_id}`);

            // Send the initial message
            await this.googleAI.sendMessage(message);

            // Wait for completion of the specific response
            const completed = await this.googleAI.waitForCompletion(60000, responseIndex);

            if (!completed) {
                throw new Error(`Response #${responseIndex} timeout - AI may still be processing`);
            }

            // Parse the specific response
            const responseData = await this.googleAI.parseAIReply(responseIndex);

            // Send success response and store for duplicates
            this.sendResponseAndStore(requestId, {
                conversation_id,
                message_id: `msg_${Date.now()}`,
                content: responseData.content,
                html_content: responseData.html_content,
                metadata: responseData.metadata,
                completion_time: responseData.completion_time,
                needs_parsing: responseData.needs_parsing,
                response_index: responseIndex
            }, sendResponse);

            const endTime = Date.now();
            this.logger.info(`✅ [${endTime}] Conversation ${conversation_id} started successfully with response #${responseIndex} (took ${endTime - startTime}ms)`);

        } catch (error) {
            const endTime = Date.now();
            this.logger.error(`❌ [${endTime}] Error starting conversation (took ${endTime - startTime}ms):`, error);

            // Handle duplicate message errors gracefully
            if (error.message?.includes('duplicate') || error.message?.includes('Already processing')) {
                this.logger.info('🔄 Skipping duplicate conversation start request');
                sendResponse({
                    conversation_id,
                    message_id: `msg_${Date.now()}`,
                    content: 'Request already in progress',
                    metadata: { skipped: true, reason: error.message }
                });
                return;
            }

            // Handle response parsing errors gracefully - send partial content
            if (error.message?.includes('Could not find response')) {
                this.logger.warn('⚠️ Response parsing failed, attempting to extract partial content');

                try {
                    // Try to get any content from the page
                    const fallbackContent = this.extractFallbackContent();
                    this.sendResponseAndStore(requestId, {
                        conversation_id,
                        message_id: `msg_${Date.now()}`,
                        content: fallbackContent || 'AI response completed but content extraction failed',
                        html_content: document.body.innerHTML, // Send full page HTML for backend parsing
                        metadata: {
                            parsing_failed: true,
                            error: error.message,
                            fallback_extraction: true
                        },
                        needs_parsing: true
                    }, sendResponse);
                    return;
                } catch (fallbackError) {
                    this.logger.error('❌ Even fallback extraction failed:', fallbackError);
                }
            }

            throw error;
        }
    }

    extractFallbackContent() {
        // Try various fallback selectors to get any AI response content
        const fallbackSelectors = [
            'body', // Last resort - entire page
            '[data-container-id]',
            '.container',
            'main',
            '#main',
            '[role="main"]'
        ];

        for (const selector of fallbackSelectors) {
            const element = document.querySelector(selector);
            if (element?.textContent && element.textContent.trim().length > 100) {
                this.logger.info(`🔄 Using fallback content from: ${selector} (${element.textContent.length} chars)`);
                return element.textContent.trim().substring(0, 1000); // Limit to 1000 chars
            }
        }

        return null;
    }

    async handleSendMessage(data, sendResponse, requestId = null) {
        const { conversation_id, message } = data;

        console.log(`💬 Sending message in conversation ${conversation_id}: "${message}"`);

        try {
            // Get the next response index for this conversation
            const responseIndex = this.getNextResponseIndex(conversation_id);
            this.logger.info(`📊 Expecting response #${responseIndex} for conversation ${conversation_id}`);

            // Send the message
            await this.googleAI.sendMessage(message);

            // Wait for completion of the specific response
            const completed = await this.googleAI.waitForCompletion(60000, responseIndex);

            if (!completed) {
                throw new Error(`Response #${responseIndex} timeout - AI may still be processing`);
            }

            // Parse the specific response
            const responseData = await this.googleAI.parseAIReply(responseIndex);

            // Send success response and store for duplicates
            this.sendResponseAndStore(requestId, {
                conversation_id,
                message_id: `msg_${Date.now()}`,
                content: responseData.content,
                html_content: responseData.html_content,
                metadata: responseData.metadata,
                completion_time: responseData.completion_time,
                needs_parsing: responseData.needs_parsing,
                response_index: responseIndex
            }, sendResponse);

            console.log(`✅ Message sent successfully in conversation ${conversation_id} (response #${responseIndex})`);

        } catch (error) {
            console.error(`❌ Error sending message: ${error}`);

            // Handle duplicate message errors gracefully
            if (error.message?.includes('duplicate') || error.message?.includes('Already processing')) {
                this.logger.info('🔄 Skipping duplicate message send request');
                sendResponse({
                    conversation_id,
                    message_id: `msg_${Date.now()}`,
                    content: 'Request already in progress',
                    metadata: { skipped: true, reason: error.message }
                });
                return;
            }

            throw error;
        }
    }
}

// Prevent multiple initialization with comprehensive checks
if (window.mcpContentScriptLoaded) {
    console.warn('⚠️ Content script already loaded, skipping re-initialization');
} else {
    // Mark as loaded immediately to prevent race conditions
    window.mcpContentScriptLoaded = true;

    // Initialize content script with dynamic import for Logger
    (async () => {
        try {
            // Use dynamic import to load the Logger module
            const { Logger: LoggerClass } = await import(chrome.runtime.getURL('utils/logger.js'));
            
            // Set global Logger variable so classes can use it
            Logger = LoggerClass;
            
            // Initialize content script when DOM is ready
            const logger = new Logger('ContentScript-Main');

            logger.info('🚀 Google Search AI MCP Extension - Content Script Loaded');
            logger.debug(`Current URL: ${window.location.href}`);
            logger.debug(`User agent: ${navigator.userAgent}`);

            const initializeHandler = () => {
                if (window.mcpContentScriptHandler) {
                    logger.warn('⚠️ Handler already exists, skipping initialization');
                    return;
                }

                logger.debug('✅ Initializing content script handler...');
                const handler = new ContentScriptHandler();
                window.mcpContentScriptHandler = handler; // Store reference
                handler.init();
            };

            if (document.readyState === 'loading') {
                logger.debug('⏳ DOM still loading, waiting for DOMContentLoaded...');
                document.addEventListener('DOMContentLoaded', initializeHandler);
            } else {
                logger.debug('✅ DOM already ready, initializing handler immediately...');
                initializeHandler();
            }

        } catch (error) {
            console.error('❌ Failed to load logger module:', error);
        }
    })();
}
