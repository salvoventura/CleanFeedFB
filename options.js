// Options page script for CleanFeedFB
(function() {
    'use strict';

    // Browser compatibility
    const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

    // Default settings
    const DEFAULT_SETTINGS = {
        enabled: true,
        hiddenCount: 0,
        totalHidden: 0,
        lastResetDate: new Date().toDateString(),
        firstInstallDate: new Date().toDateString(),
        scanInterval: 3,
        hideDelay: 100,
        debugMode: false
    };

    // Default settings for just the configurable options
    const DEFAULT_CONFIG_SETTINGS = {
        scanInterval: 3,
        hideDelay: 100,
        debugMode: false
    };

    // DOM elements
    const elements = {
        // Statistics
        todayCount: document.getElementById('todayCount'),
        totalCount: document.getElementById('totalCount'),
        avgPerDay: document.getElementById('avgPerDay'),
        resetStats: document.getElementById('resetStats'),
        resetMessage: document.getElementById('resetMessage'),
        
        // Settings
        scanInterval: document.getElementById('scanInterval'),
        hideDelay: document.getElementById('hideDelay'),
        debugMode: document.getElementById('debugMode'),
        saveSettings: document.getElementById('saveSettings'),
        resetSettings: document.getElementById('resetSettings'),
        settingsMessage: document.getElementById('settingsMessage')
    };

    // Show status message
    function showMessage(element, message, type = 'success', duration = 3000) {
        element.textContent = message;
        element.className = `status-message ${type}`;
        element.style.display = 'block';
        
        setTimeout(() => {
            element.style.display = 'none';
        }, duration);
    }

    // Load settings from storage
    async function loadSettings() {
        try {
            const settings = await browserAPI.storage.sync.get(DEFAULT_SETTINGS);
            
            // Reset daily counter if needed
            const today = new Date().toDateString();
            if (settings.lastResetDate !== today) {
                settings.hiddenCount = 0;
                settings.lastResetDate = today;
                await browserAPI.storage.sync.set({
                    hiddenCount: 0,
                    lastResetDate: today
                });
            }
            
            return settings;
        } catch (error) {
            console.error('Error loading settings:', error);
            return DEFAULT_SETTINGS;
        }
    }

    // Save settings to storage
    async function saveSettings(settings) {
        try {
            await browserAPI.storage.sync.set(settings);
            return true;
        } catch (error) {
            console.error('Error saving settings:', error);
            return false;
        }
    }

    // Update statistics display
    function updateStatistics(settings) {
        elements.todayCount.textContent = settings.hiddenCount || 0;
        elements.totalCount.textContent = settings.totalHidden || 0;
        
        // Calculate average per day
        const firstInstall = new Date(settings.firstInstallDate || new Date().toDateString());
        const now = new Date();
        const daysSinceInstall = Math.max(1, Math.ceil((now - firstInstall) / (1000 * 60 * 60 * 24)));
        const avgPerDay = Math.round((settings.totalHidden || 0) / daysSinceInstall);
        elements.avgPerDay.textContent = avgPerDay;
    }

    // Update settings form
    function updateSettingsForm(settings) {
        elements.scanInterval.value = settings.scanInterval || DEFAULT_CONFIG_SETTINGS.scanInterval;
        elements.hideDelay.value = settings.hideDelay || DEFAULT_CONFIG_SETTINGS.hideDelay;
        elements.debugMode.checked = settings.debugMode || DEFAULT_CONFIG_SETTINGS.debugMode;
    }

    // Get settings from form
    function getSettingsFromForm() {
        return {
            scanInterval: parseInt(elements.scanInterval.value) || DEFAULT_CONFIG_SETTINGS.scanInterval,
            hideDelay: parseInt(elements.hideDelay.value) || DEFAULT_CONFIG_SETTINGS.hideDelay,
            debugMode: elements.debugMode.checked
        };
    }

    // Notify content scripts of settings changes
    async function notifyContentScripts(changes) {
        try {
            const tabs = await browserAPI.tabs.query({ url: "*://*.facebook.com/*" });
            
            for (const tab of tabs) {
                try {
                    await browserAPI.tabs.sendMessage(tab.id, {
                        type: 'SETTINGS_UPDATED',
                        settings: changes
                    });
                } catch (error) {
                    // Tab might not have content script loaded
                    console.log(`Could not notify tab ${tab.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error('Error notifying content scripts:', error);
        }
    }

    // Reset all statistics
    async function resetAllStatistics() {
        if (!confirm('Are you sure you want to reset all statistics? This action cannot be undone.')) {
            return;
        }

        try {
            const currentSettings = await loadSettings();
            const resetData = {
                ...currentSettings, // Keep all current settings
                hiddenCount: 0,
                totalHidden: 0,
                lastResetDate: new Date().toDateString(),
                firstInstallDate: new Date().toDateString()
            };

            const success = await saveSettings(resetData);
            
            if (success) {
                updateStatistics(resetData);
                showMessage(elements.resetMessage, 'Statistics reset successfully!', 'success');
            } else {
                showMessage(elements.resetMessage, 'Failed to reset statistics', 'error');
            }
        } catch (error) {
            console.error('Error resetting statistics:', error);
            showMessage(elements.resetMessage, 'Error resetting statistics', 'error');
        }
    }

    // Reset settings form to defaults (UI only)
    function resetSettingsToDefaults() {
        elements.scanInterval.value = DEFAULT_CONFIG_SETTINGS.scanInterval;
        elements.hideDelay.value = DEFAULT_CONFIG_SETTINGS.hideDelay;
        elements.debugMode.checked = DEFAULT_CONFIG_SETTINGS.debugMode;
        
        showMessage(elements.settingsMessage, 'Settings reset to defaults in form. Click Save to apply.', 'success');
    }

    // Save settings
    async function saveMainSettings() {
        try {
            const formSettings = getSettingsFromForm();
            const currentSettings = await loadSettings();
            const updatedSettings = { ...currentSettings, ...formSettings };

            const success = await saveSettings(updatedSettings);
            
            if (success) {
                showMessage(elements.settingsMessage, 'Settings saved successfully!', 'success');
                await notifyContentScripts(formSettings);
            } else {
                showMessage(elements.settingsMessage, 'Failed to save settings', 'error');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            showMessage(elements.settingsMessage, 'Error saving settings', 'error');
        }
    }

    // Initialize the options page
    async function initialize() {
        console.log('Initializing options page...');
        
        try {
            const settings = await loadSettings();
            updateStatistics(settings);
            updateSettingsForm(settings);
            
            // Add event listeners
            elements.resetStats.addEventListener('click', resetAllStatistics);
            elements.saveSettings.addEventListener('click', saveMainSettings);
            elements.resetSettings.addEventListener('click', resetSettingsToDefaults);
            
            // Add input validation
            elements.scanInterval.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (value < 1) e.target.value = 1;
                if (value > 30) e.target.value = 30;
            });
            
            elements.hideDelay.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (value < 0) e.target.value = 0;
                if (value > 1000) e.target.value = 1000;
            });
            
            console.log('Options page initialized successfully');
        } catch (error) {
            console.error('Error initializing options page:', error);
        }
    }

    // Listen for storage changes to update UI
    if (browserAPI.storage && browserAPI.storage.onChanged) {
        browserAPI.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync') {
                // Update statistics if counts changed
                if (changes.hiddenCount || changes.totalHidden) {
                    loadSettings().then(updateStatistics);
                }
            }
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();