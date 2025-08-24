// CleanFeedFB - Content Script with Toggle Support
// This script dynamically finds and hides posts with Follow/Join buttons
(function() {
    'use strict';

    // Browser compatibility - use browser API with chrome fallback
    const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

    // Default configuration
    const DEFAULT_CONFIG = {
        checkInterval: 3000, // Check every 3 seconds
        debug: false, // Set to false to disable console logs
        hideDelay: 100, // Small delay before initiating hide transition
        filterStrings: ['follow', 'join'] // Fixed filter strings (lowercase)
    };

    // Current configuration (will be loaded from storage)
    let CONFIG = { ...DEFAULT_CONFIG };

    // State management
    let extensionEnabled = true;
    let hiddenPostsCount = 0;
    let observer = null;
    let scanInterval = null;
    let scanTimeout = null; // For debouncing mutation observer scans

    // Track processed posts to avoid re-processing
    let processedPosts = new WeakSet();
    const hiddenPosts = new Set(); // Keep track of hidden posts for show/hide

    // Function to log debug messages
    function debug(message, element = null) {
        if (CONFIG.debug) {
            console.log('[CleanFeedFB]:', message);
            if (element) console.log('Element:', element);
        }
    }

    // Function to load extension state and settings from storage
    async function loadExtensionState() {
        try {
            // Reset daily counter if needed
            const today = new Date().toDateString();
            let result = await browserAPI.storage.sync.get({
                enabled: true,
                hiddenCount: 0,
                totalHidden: 0,
                lastResetDate: '',
                scanInterval: 3,
                hideDelay: 100,
                debugMode: false
            });

            // Reset daily counter if it's a new day
            if (result.lastResetDate !== today) {
                await browserAPI.storage.sync.set({
                    lastResetDate: today,
                    hiddenCount: 0
                });
                result.hiddenCount = 0;
            }

            // Update configuration from storage
            CONFIG.checkInterval = (result.scanInterval || 3) * 1000; // Convert to milliseconds
            CONFIG.hideDelay = result.hideDelay || 100;
            CONFIG.debug = result.debugMode || false;
            // Filter strings are now hardcoded
            CONFIG.filterStrings = DEFAULT_CONFIG.filterStrings;

            extensionEnabled = result.enabled;
            hiddenPostsCount = result.hiddenCount;

            debug(`Extension state loaded: enabled=${extensionEnabled}, hiddenCount=${hiddenPostsCount}`);
            debug(`Config updated: interval=${CONFIG.checkInterval}ms, delay=${CONFIG.hideDelay}ms, debug=${CONFIG.debug}`);
            debug(`Filter strings: [${CONFIG.filterStrings.join(', ')}]`);

            return result;
        } catch (error) {
            debug('Error loading extension state:', error);
            extensionEnabled = true;
            hiddenPostsCount = 0;
            CONFIG = { ...DEFAULT_CONFIG };
            return { enabled: true, hiddenCount: 0, totalHidden: 0 };
        }
    }

    // Function to update hidden posts count
    async function updateHiddenCount() {
        hiddenPostsCount++;
        try {
            const today = new Date().toDateString();

            // Get current totalHidden count
            const currentData = await browserAPI.storage.sync.get(['totalHidden']);
            const newTotalHidden = (currentData.totalHidden || 0) + 1;

            await browserAPI.storage.sync.set({
                hiddenCount: hiddenPostsCount,
                totalHidden: newTotalHidden,
                lastResetDate: today
            });

            debug(`Updated hidden count - today: ${hiddenPostsCount}, total: ${newTotalHidden}`);

            // Notify popup of count update
            try {
                await browserAPI.runtime.sendMessage({
                    type: 'UPDATE_HIDDEN_COUNT',
                    count: hiddenPostsCount,
                    total: newTotalHidden
                });
            } catch (error) {
                debug('Popup not available for count update:', error.message);
            }
        } catch (error) {
            debug('Error updating hidden count:', error);
        }
    }

    // Function to check if text contains any of the hardcoded filter strings
    function containsFilteredText(text) {
        if (!text || CONFIG.filterStrings.length === 0) return false;

        const trimmed = text.trim().toLowerCase();

        // Check each filter string
        return CONFIG.filterStrings.some(filterString => {
            // Direct string comparison for exact matches (fastest)
            if (trimmed === filterString) {
                return true;
            }
            
            // Check if it starts with "filterString " (for extended matches)
            return trimmed.startsWith(filterString + ' ');
        });
    }

    // Function to find all clickable elements that might contain filtered strings
    function findFilteredButtons(container) {
        if (!extensionEnabled || CONFIG.filterStrings.length === 0) return [];

        const buttons = [];

        // Get all potentially clickable elements
        const clickableSelectors = [
            '[role="button"]',
            '[tabindex="0"]',
            'div[style*="cursor"]',
            'span[style*="cursor"]',
            'div[data-testid]',
            'span[data-testid]'
        ];

        clickableSelectors.forEach(selector => {
            const elements = container.querySelectorAll(selector);
            elements.forEach(el => {
                const text = (el.innerText || el.textContent || '').trim();
                const ariaLabel = el.getAttribute('aria-label') || '';

                // Check if this element contains any filtered text
                if (containsFilteredText(text) || containsFilteredText(ariaLabel)) {
                    debug(`Found button candidate: text="${text}", aria-label="${ariaLabel}", selector="${selector}"`);
                    buttons.push({
                        element: el,
                        text: text,
                        ariaLabel: ariaLabel
                    });
                }
            });
        });

        return buttons;
    }

    // Function to find News Feed Posts Root
    function findNewsFeedRoot() {
        try {
            const target = Array.from(document.querySelectorAll('h3.html-h3')).find(el => 
                el.textContent.trim() === 'News Feed posts'
            );
            
            if (!target) {
                debug('News Feed posts header not found');
                return null;
            }
            
            debug('Found News Feed posts header');
            return target;
        } catch (error) {
            debug('Error finding News Feed root:', error);
            return null;
        }
    }

    // Function to get all posts from the News Feed
    function getAllPosts() {
        const target = findNewsFeedRoot();
        if (!target) {
            debug('Cannot find News Feed root, falling back to old method');
            return [];
        }

        try {
            const postsContainer = target.parentElement.childNodes[2];
            if (!postsContainer || !postsContainer.children) {
                debug('Posts container not found or has no children');
                return [];
            }

            const posts = Array.from(postsContainer.children);
            debug(`Found ${posts.length} posts in News Feed`);
            return posts;
        } catch (error) {
            debug('Error getting posts from News Feed:', error);
            return [];
        }
    }

    // Function to hide a post smoothly
    function hidePost(postContainer, reason) {
        if (!postContainer || processedPosts.has(postContainer) || !extensionEnabled) {
            return;
        }

        // Add the transition class
        postContainer.classList.add('cleanfeed-hide-transition');

        // After a small delay, add the 'hide' class to trigger the transition
        setTimeout(() => {
            postContainer.classList.add('hide');

            // Listen for the end of the transition to set display: none
            const transitionEndHandler = () => {
                postContainer.style.display = 'none';
                postContainer.setAttribute('data-follow-hidden', 'true');
                processedPosts.add(postContainer);
                hiddenPosts.add(postContainer);
                debug(`Hidden post: ${reason}`);

                // Update count
                updateHiddenCount();

                // Remove the event listener and the transition classes
                postContainer.removeEventListener('transitionend', transitionEndHandler);
                postContainer.classList.remove('cleanfeed-hide-transition', 'hide');

                // Add a placeholder in debug mode
                if (CONFIG.debug) {
                    const placeholder = document.createElement('div');
                    placeholder.style.cssText = `
                        background: #e3f2fd;
                        border: 1px solid #1976d2;
                        padding: 8px 12px;
                        margin: 8px 0;
                        border-radius: 4px;
                        color: #1976d2;
                        font-size: 12px;
                        text-align: center;
                    `;
                    placeholder.innerHTML = `🚫 Hidden: ${reason}`;
                    placeholder.setAttribute('data-follow-placeholder', 'true');
                    postContainer.parentNode?.insertBefore(placeholder, postContainer);
                }
            };
            postContainer.addEventListener('transitionend', transitionEndHandler, { once: true });
        }, CONFIG.hideDelay); // Small delay before starting the fade
    }

    // Function to show all hidden posts
    function showAllHiddenPosts() {
        debug('Showing all hidden posts...');
        hiddenPosts.forEach(postContainer => {
            if (postContainer && postContainer.parentNode) {
                // Remove the 'hide' class and the transition class first
                postContainer.classList.remove('hide');
                postContainer.classList.remove('cleanfeed-hide-transition');
                postContainer.style.display = ''; // Restore display
                postContainer.removeAttribute('data-follow-hidden');

                // Remove debug placeholder if it exists
                const placeholder = postContainer.parentNode.querySelector('[data-follow-placeholder="true"]');
                if (placeholder) {
                    placeholder.remove();
                }
            }
        });
        hiddenPosts.clear();
        // Create new WeakSet for processed posts to allow re-processing
        processedPosts = new WeakSet();
    }

    // Function to hide all previously found posts
    function hideAllFilteredPosts() {
        debug('Re-hiding filtered posts...');
        scanForFilteredPosts();
    }

    // Main function to scan for posts with filtered buttons
    function scanForFilteredPosts() {
        if (!extensionEnabled || CONFIG.filterStrings.length === 0) {
            debug('Extension disabled or no filter strings configured, skipping scan...');
            return;
        }

        debug(`Scanning for posts with filtered buttons: [${CONFIG.filterStrings.join(', ')}]`);

        // Get all posts using the new method
        const posts = getAllPosts();
        
        if (posts.length === 0) {
            debug('No posts found, trying fallback method...');
            // Fallback to old method if new method fails
            const feedContainer = document.querySelector('[role="main"], [role="feed"], #stream_pagelet') || document.body;
            const filteredButtons = findFilteredButtons(feedContainer);
            
            debug(`Fallback: Found ${filteredButtons.length} potential filtered buttons`);
            
            filteredButtons.forEach((buttonInfo, index) => {
                debug(`Processing fallback button ${index + 1}: "${buttonInfo.text || buttonInfo.ariaLabel}"`);
                
                // For fallback, we need to find the post container
                const postContainer = findPostContainerLegacy(buttonInfo.element);
                
                if (postContainer && !processedPosts.has(postContainer)) {
                    const reason = `Filtered button "${buttonInfo.text || buttonInfo.ariaLabel}"`;
                    hidePost(postContainer, reason);
                } else if (!postContainer) {
                    debug(`❌ No container found for fallback button: "${buttonInfo.text || buttonInfo.ariaLabel}"`);
                }
            });
            return;
        }

        // Process each post individually
        let foundFilteredPosts = 0;
        
        posts.forEach((post, index) => {
            if (processedPosts.has(post)) {
                debug(`⏭️ Post ${index + 1} already processed, skipping`);
                return;
            }

            // Look for filtered buttons within this specific post
            const filteredButtons = findFilteredButtons(post);
            
            if (filteredButtons.length > 0) {
                foundFilteredPosts++;
                debug(`📍 Post ${index + 1} contains ${filteredButtons.length} filtered button(s)`);
                
                // Hide this post since it contains filtered buttons
                const buttonTexts = filteredButtons.map(b => b.text || b.ariaLabel).join(', ');
                const reason = `Filtered buttons: ${buttonTexts}`;
                hidePost(post, reason);
            }
        });

        debug(`Scan complete: Found ${foundFilteredPosts} posts with filtered buttons out of ${posts.length} total posts`);
    }

    // Legacy function to find the post container for a given element (fallback only)
    function findPostContainerLegacy(element) {
        let current = element;
        let attempts = 0;
        const maxAttempts = 20; // Prevent infinite loops

        debug(`Looking for post container starting from element with text: "${(element.textContent || '').substring(0, 50)}"`);

        // Walk up the DOM tree to find the post container
        while (current && current !== document.body && attempts < maxAttempts) {
            attempts++;

            const tagName = current.tagName?.toLowerCase();
            const classList = Array.from(current.classList || []);

            // Primary, more reliable indicators for a Facebook post
            const isReliablePostContainer = (
                current.getAttribute('role') === 'article' ||
                (current.hasAttribute('data-pagelet') && current.getAttribute('data-pagelet').includes('FeedUnit')) ||
                (current.hasAttribute('data-ft') && current.querySelector('[role="article"]'))
            );

            if (isReliablePostContainer) {
                debug(`🎯 Reliable container found! Element: ${tagName}`);
                return current;
            }

            // Fallback to broader, but still somewhat specific patterns
            const isPotentialPostContainer = (
                classList.includes('userContentWrapper') ||
                classList.includes('story_body_container') ||
                (tagName === 'div' && classList.some(cls => cls.startsWith('x') && cls.length > 10)) // Newer Facebook classes (e.g., 'x1yztbdb', 'x1c4vsro')
            );

            if (isPotentialPostContainer) {
                const rect = current.getBoundingClientRect();
                // Ensure it's reasonably sized to be a post, not just a small div
                if (rect.height > 80 && rect.width > 300) {
                    debug(`✅ Potential container accepted! Size: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
                    return current;
                } else {
                    debug(`❌ Potential container too small: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
                }
            }
            current = current.parentElement;
        }

        debug(`🔍 Fallback search for any large ancestor as a last resort`);
        // Last resort: If no specific Facebook container is found, look for a large div
        current = element;
        for (let i = 0; i < 15; i++) {
            if (!current || current === document.body) break;

            const rect = current.getBoundingClientRect();
            if (current.tagName?.toLowerCase() === 'div' && rect.height > 100 && rect.width > 200) {
                debug(`✅ FALLBACK container accepted (large div): ${Math.round(rect.width)}x${Math.round(rect.height)}`);
                return current;
            }
            current = current.parentElement;
        }

        debug(`💀 Absolutely no container found after ${attempts} attempts`);
        return null;
    }

    // Enhanced mutation observer to catch dynamically loaded content
    function startMutationObserver() {
        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver((mutations) => {
            if (!extensionEnabled) return;

            let shouldScan = false;

            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    // Check if any added nodes contain substantial content
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const text = node.textContent || '';
                            if (text.length > 50) { // Substantial content added
                                shouldScan = true;
                            }
                        }
                    });
                }
            });

            if (shouldScan) {
                debug('DOM changed, debouncing scan...');
                // Clear any existing timeout
                if (scanTimeout) {
                    clearTimeout(scanTimeout);
                }
                // Set a new timeout to debounce the scan
                scanTimeout = setTimeout(() => {
                    scanForFilteredPosts();
                    scanTimeout = null; // Clear timeout ID after execution
                }, 500); // Adjust debounce delay as needed (e.g., 500ms)
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });

        return observer;
    }

    // Function to restart scanning with new interval
    function restartScanning() {
        // Stop current interval
        if (scanInterval) {
            clearInterval(scanInterval);
            scanInterval = null;
        }

        // Start new interval with updated config
        if (extensionEnabled) {
            debug(`Starting scan interval with ${CONFIG.checkInterval}ms interval`);
            scanInterval = setInterval(scanForFilteredPosts, CONFIG.checkInterval);
        }
    }

    // Function to start the extension
    function startExtension() {
        debug('Starting extension...');

        // Initial scan
        scanForFilteredPosts();

        // Start mutation observer
        startMutationObserver();

        // Start periodic scanning
        restartScanning();
    }

    // Function to stop the extension
    function stopExtension() {
        debug('Stopping extension...');

        // Stop mutation observer
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        // Stop periodic scanning
        if (scanInterval) {
            clearInterval(scanInterval);
            scanInterval = null;
        }

        // Show all hidden posts
        showAllHiddenPosts();
    }

    // Function to force refresh extension state
    async function refreshExtensionState() {
        debug('Refreshing extension state...');

        // First, ensure we stop everything cleanly
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        if (scanInterval) {
            clearInterval(scanInterval);
            scanInterval = null;
        }
        if (scanTimeout) { // Also clear the debounce timeout
            clearTimeout(scanTimeout);
            scanTimeout = null;
        }

        // Clear processed posts to allow re-processing (WeakSet doesn't have clear method)
        // We'll create a new WeakSet reference instead
        processedPosts = new WeakSet();

        // Clear hidden posts set
        hiddenPosts.clear();

        // Reload settings from storage
        await loadExtensionState();

        if (extensionEnabled) {
            debug('Extension enabled after refresh - starting fresh scan');

            // Remove any existing hidden attributes to start fresh
            document.querySelectorAll('[data-follow-hidden="true"]').forEach(el => {
                el.style.display = '';
                el.removeAttribute('data-follow-hidden');
            });

            // Remove any transition classes that might be stuck
            document.querySelectorAll('.cleanfeed-hide-transition, .hide').forEach(el => {
                el.classList.remove('cleanfeed-hide-transition', 'hide');
                el.style.cssText = ''; // Clear any inline styles that might interfere
            });

            // Remove debug placeholders
            document.querySelectorAll('[data-follow-placeholder="true"]').forEach(el => {
                el.remove();
            });

            // Give DOM a moment to settle, then start fresh
            setTimeout(() => {
                debug('Starting fresh extension after state refresh');
                startExtension();
            }, 200);
        }
    }

    // Function to inject CSS into the page
    function injectCSS() {
        const style = document.createElement('style');
        style.textContent = `
            /* Ensure hidden posts are completely removed from layout */
            [data-follow-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
            }

            /* Optional: Add smooth transition for posts being hidden */
            .cleanfeed-hide-transition {
                opacity: 1;
                max-height: 1000px; /* A large enough value to accommodate most posts */
                transition: opacity 0.5s ease-out, max-height 0.5s ease-out; /* Smooth transition for both opacity and height */
                overflow: hidden;
            }

            /* This class will be added to trigger the actual fade-out and collapse */
            .cleanfeed-hide-transition.hide {
                opacity: 0;
                max-height: 0;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Listen for messages from popup and options page
    if (browserAPI.runtime && browserAPI.runtime.onMessage) {
        browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
            debug('Received message:', message);

            if (message.type === 'TOGGLE_EXTENSION') {
                const wasEnabled = extensionEnabled;
                extensionEnabled = message.enabled;
                debug(`Extension toggled from ${wasEnabled} to ${extensionEnabled}`);

                if (extensionEnabled && !wasEnabled) {
                    // Just enabled - refresh state and start extension
                    debug('Starting extension after toggle');
                    refreshExtensionState().then(() => {
                        sendResponse({ success: true, enabled: extensionEnabled });
                    });
                    return true; // Keep message channel open for async response
                } else if (!extensionEnabled && wasEnabled) {
                    // Just disabled - stop extension
                    debug('Stopping extension after toggle');
                    stopExtension();
                }

                sendResponse({ success: true, enabled: extensionEnabled });
                return true; // Keep message channel open
            }

            if (message.type === 'SETTINGS_UPDATED') {
                debug('Settings updated:', message.settings);

                // Update configuration
                if (message.settings.scanInterval !== undefined) {
                    CONFIG.checkInterval = message.settings.scanInterval * 1000; // Convert to milliseconds
                    debug(`Updated scan interval to ${CONFIG.checkInterval}ms`);
                }

                if (message.settings.hideDelay !== undefined) {
                    CONFIG.hideDelay = message.settings.hideDelay;
                    debug(`Updated hide delay to ${CONFIG.hideDelay}ms`);
                }

                if (message.settings.debugMode !== undefined) {
                    CONFIG.debug = message.settings.debugMode;
                    debug(`Updated debug mode to ${CONFIG.debug}`);
                }

                // Filter strings are now hardcoded - no need to update them

                // Restart scanning with new settings if enabled
                if (extensionEnabled) {
                    restartScanning();
                }

                sendResponse({ success: true });
                return true;
            }

            // Add a new message type for manual refresh
            if (message.type === 'REFRESH_STATE') {
                debug('Manual refresh requested');
                refreshExtensionState().then(() => {
                    sendResponse({ success: true, enabled: extensionEnabled });
                });
                return true; // Keep message channel open for async response
            }
        });
    }

    // Initialize the extension
    async function initialize() {
        debug('CleanFeedFB initializing...');

        // Inject the CSS styles
        injectCSS();

        // Load state and settings from storage
        await loadExtensionState();

        // Wait for page to be somewhat ready - look for the News Feed header
        const waitForReady = () => {
            const newsFeedRoot = findNewsFeedRoot();
            if (newsFeedRoot || document.querySelector('[role="main"], [role="feed"]')) {
                debug('Feed container found, starting...');

                if (extensionEnabled) {
                    startExtension();
                } else {
                    debug('Extension is disabled, not starting');
                }

            } else {
                debug('Waiting for feed container...');
                setTimeout(waitForReady, 1000);
            }
        };

        waitForReady();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Handle SPA navigation
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            debug('Navigation detected, reinitializing...');
            // Debounce the reinitialization slightly to avoid issues on rapid navigation
            setTimeout(initialize, 1000);
        }
    }).observe(document, { subtree: true, childList: true });

})();