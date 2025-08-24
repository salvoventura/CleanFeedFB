// Popup script for CleanFeedFB
(function() {
    'use strict';

    // Browser compatibility - use browser API with chrome fallback
    const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

    const toggleSwitch = document.getElementById('toggleSwitch');
    const status = document.getElementById('status');
    const hiddenCount = document.getElementById('hiddenCount');
    const optionsLink = document.getElementById('optionsLink');
    const debugInfo = document.getElementById('debugInfo');

    // Debug mode - set to true to see debug info
    const DEBUG_MODE = false;

    function addDebugInfo(message) {
        if (DEBUG_MODE) {
            console.log('[Popup Debug]:', message);
            debugInfo.style.display = 'block';
            debugInfo.innerHTML += message + '<br>';
        }
    }

    // Load current state
    async function loadState() {
        try {
            // Reset daily counter first
            const todayCount = await resetDailyCounterIfNeeded();
            
            const result = await browserAPI.storage.sync.get({
                enabled: true,
                hiddenCount: todayCount
            });

            updateUI(result.enabled, result.hiddenCount);
        } catch (error) {
            console.error('Error loading state:', error);
            updateUI(true, 0); // Default values
        }
    }

    // Update the UI based on current state
    function updateUI(enabled, count) {
        addDebugInfo(`updateUI: enabled=${enabled}, count=${count}`);
        
        // Update toggle switch
        if (enabled) {
            toggleSwitch.classList.add('enabled');
            status.className = 'status enabled';
            status.textContent = '✅ Active - Hiding follow posts';
        } else {
            toggleSwitch.classList.remove('enabled');
            status.className = 'status disabled';
            status.textContent = '⏸️ Disabled - Posts will show normally';
        }

        // Update hidden count
        hiddenCount.textContent = count || 0;
    }

    // Toggle the extension state
    async function toggleExtension() {
        try {
            addDebugInfo('Toggle clicked');
            
            // Get current state
            const result = await browserAPI.storage.sync.get({ 
                enabled: true,
                hiddenCount: 0 
            });
            
            const newEnabled = !result.enabled;
            addDebugInfo(`Toggling from ${result.enabled} to ${newEnabled}`);

            // Save new state
            await browserAPI.storage.sync.set({ enabled: newEnabled });
            addDebugInfo('State saved successfully');

            // Update UI immediately
            updateUI(newEnabled, result.hiddenCount || 0);

            // Notify content script of the change
            try {
                const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
                addDebugInfo(`Active tab: ${tab ? tab.url : 'none'}`);
                
                if (tab && tab.url && tab.url.includes('facebook.com')) {
                    addDebugInfo('Sending message to content script');
                    const response = await browserAPI.tabs.sendMessage(tab.id, {
                        type: 'TOGGLE_EXTENSION',
                        enabled: newEnabled
                    });
                    addDebugInfo(`Content script response: ${JSON.stringify(response)}`);
                } else {
                    addDebugInfo('Not on Facebook or no active tab');
                }
            } catch (messageError) {
                addDebugInfo(`Message failed: ${messageError.message}`);
            }

        } catch (error) {
            addDebugInfo(`Toggle error: ${error.message}`);
            console.error('Error toggling extension:', error);
        }
    }

    // Open options page
    function openOptionsPage(event) {
        event.preventDefault();
        addDebugInfo('Options link clicked');
        
        try {
            // Open the options page in a new tab
            browserAPI.runtime.openOptionsPage();
            
            // Close the popup
            window.close();
        } catch (error) {
            console.error('Error opening options page:', error);
            addDebugInfo(`Options error: ${error.message}`);
            
            // Fallback: try to open options.html directly
            try {
                browserAPI.tabs.create({
                    url: browserAPI.runtime.getURL('options.html')
                });
                window.close();
            } catch (fallbackError) {
                console.error('Fallback options open failed:', fallbackError);
                addDebugInfo(`Fallback error: ${fallbackError.message}`);
            }
        }
    }
    
    // Reset daily counter if needed
    async function resetDailyCounterIfNeeded() {
        const today = new Date().toDateString();
        const result = await browserAPI.storage.sync.get({ lastResetDate: '', hiddenCount: 0 });
        
        if (result.lastResetDate !== today) {
            await browserAPI.storage.sync.set({
                lastResetDate: today,
                hiddenCount: 0
            });
            return 0;
        }
        return result.hiddenCount;
    }

    // Listen for storage changes (in case state is changed from another tab)
    if (browserAPI.storage && browserAPI.storage.onChanged) {
        browserAPI.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync') {
                if (changes.enabled || changes.hiddenCount) {
                    // Re-load state to get current values
                    loadState();
                }
            }
        });
    }

    // Event listeners
    toggleSwitch.addEventListener('click', toggleExtension);
    optionsLink.addEventListener('click', openOptionsPage);

    // Initialize
    document.addEventListener('DOMContentLoaded', async () => {
        await resetDailyCounterIfNeeded();
        loadState();
    });

    // Also initialize immediately if DOM is already loaded
    if (document.readyState === 'loading') {
        // Already handled by DOMContentLoaded
    } else {
        resetDailyCounterIfNeeded().then(() => loadState());
    }

    // Listen for messages from content script (for count updates)
    if (browserAPI.runtime && browserAPI.runtime.onMessage) {
        browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'UPDATE_HIDDEN_COUNT') {
                hiddenCount.textContent = message.count;
            }
            return true; // Keep message channel open
        });
    }

})();