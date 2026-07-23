// Time Navigation System
class TimeNavigator {
    constructor() {
        this.selectedTime = null; // null means "current time" (live mode)
        this.isLiveMode = true;
        this.timeStep = DATA_INTERVAL_MINUTES; // minutes, matches the collector cadence
        this.observers = []; // Components that need to be notified of time changes

        this.createTimeNavigatorUI();
        this.bindEvents();

        console.log('Time Navigator initialized');
    }

    createTimeNavigatorUI() {
        // Create time navigator container
        const container = document.createElement('div');
        container.id = 'timeNavigator';
        container.className = 'time-navigator-container';
        // Start collapsed by default (small pill); remember the user's choice thereafter
        if (this.readCollapsedPref()) container.classList.add('collapsed');

        container.innerHTML = `
            <div class="time-navigator-controls">
                <button id="timeNavToggle" class="time-nav-toggle" type="button" aria-controls="timeNavigator" aria-expanded="false" title="Show time navigation">
                    <span class="tnt-clock" aria-hidden="true">🕐</span>
                    <span class="tnt-label" id="timeNavToggleLabel">Live Mode</span>
                    <span class="tnt-badge live" id="timeNavToggleBadge">🔴 LIVE</span>
                    <span class="tnt-chevron" aria-hidden="true">▾</span>
                </button>
                <button id="timeNavBack" class="time-nav-btn" title="Go back ${this.timeStep} minutes">
                    <span>⏪</span>
                </button>
                <button id="timeNavBackFast" class="time-nav-btn" title="Go back 1 hour">
                    <span>⏮️</span>
                </button>
                <div class="time-display-container">
                    <div id="timeDisplay" class="time-display">Live Mode</div>
                    <div id="timeModeIndicator" class="time-mode-indicator live">🔴 LIVE</div>
                </div>
                <button id="timeNavForwardFast" class="time-nav-btn" title="Go forward 1 hour">
                    <span>⏭️</span>
                </button>
                <button id="timeNavForward" class="time-nav-btn" title="Go forward ${this.timeStep} minutes">
                    <span>⏩</span>
                </button>
                <button id="timeNavLive" class="time-nav-btn live-btn" title="Return to live mode">
                    <span>🔴 LIVE</span>
                </button>
                <div class="calendar-picker-container">
                    <label for="datePickerInput" class="calendar-label">Jump to date:</label>
                    <input type="date" id="datePickerInput" class="calendar-date-input" title="Select a date before today">
                </div>
                <button id="timeNavCollapse" class="time-nav-collapse" type="button" aria-controls="timeNavigator" aria-expanded="true" title="Collapse time navigation" aria-label="Collapse time navigation">
                    <span aria-hidden="true">▴</span>
                </button>
            </div>
        `;

        // Insert at the top of the page container so position:sticky spans the whole page
        const pageContainer = document.querySelector('.container') || document.body;
        pageContainer.insertBefore(container, pageContainer.firstChild);
    }

    bindEvents() {
        document.getElementById('timeNavBack').addEventListener('click', () => this.stepTime(-this.timeStep));
        document.getElementById('timeNavBackFast').addEventListener('click', () => this.stepTime(-60));
        document.getElementById('timeNavForward').addEventListener('click', () => this.stepTime(this.timeStep));
        document.getElementById('timeNavForwardFast').addEventListener('click', () => this.stepTime(60));
        document.getElementById('timeNavLive').addEventListener('click', () => this.goToLiveMode());

        // Collapse / expand the navigator
        document.getElementById('timeNavToggle').addEventListener('click', () => this.setCollapsed(false));
        document.getElementById('timeNavCollapse').addEventListener('click', () => this.setCollapsed(true));

        // Date picker event
        document.getElementById('datePickerInput').addEventListener('change', (e) => this.jumpToDate(e.target.value));

        // Set max date to yesterday
        this.updateDatePickerConstraints();

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    this.stepTime(e.shiftKey ? -60 : -this.timeStep);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.stepTime(e.shiftKey ? 60 : this.timeStep);
                    break;
                case 'Escape':
                case 'Home':
                    e.preventDefault();
                    this.goToLiveMode();
                    break;
            }
        });
    }

    stepTime(minutes) {
        if (this.isLiveMode) {
            // First step back from live mode
            this.selectedTime = this.getLatestDataTime();
            this.isLiveMode = false;
        }

        if (this.selectedTime) {
            const newTime = new Date(this.selectedTime.getTime() + minutes * 60000);

            // Don't allow going beyond the latest available data
            const latestTime = this.getLatestDataTime();
            if (newTime > latestTime) {
                this.goToLiveMode();
                return;
            }

            // Don't allow going too far back (beyond available data)
            const earliestTime = this.getEarliestDataTime();
            if (newTime < earliestTime) {
                this.selectedTime = earliestTime;
            } else {
                this.selectedTime = newTime;
            }
        }

        this.updateDisplay();
        this.notifyObservers();
    }

    goToLiveMode() {
        this.selectedTime = null;
        this.isLiveMode = true;
        this.updateDisplay();
        this.notifyObservers();
    }

    // Whether the navigator should start collapsed (small pill). Defaults to
    // collapsed on first visit, then remembers the user's last choice.
    readCollapsedPref() {
        try {
            const stored = localStorage.getItem('timeNavCollapsed');
            return stored === null ? true : stored === 'true';
        } catch (e) {
            return true;
        }
    }

    // Collapse to the pill or expand to the full control bar, and persist it
    setCollapsed(collapsed) {
        const container = document.getElementById('timeNavigator');
        if (!container) return;

        container.classList.toggle('collapsed', collapsed);

        const toggleBtn = document.getElementById('timeNavToggle');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(!collapsed));

        try {
            localStorage.setItem('timeNavCollapsed', String(collapsed));
        } catch (e) {
            // ignore storage failures (e.g. private mode)
        }
    }

    jumpToDate(dateString) {
        if (!dateString) return;

        const selectedDate = new Date(dateString + 'T23:59:59');
        const earliestTime = this.getEarliestDataTime();
        const latestTime = this.getLatestDataTime();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Don't allow future dates
        if (selectedDate >= today) {
            alert('Please select a date before today.');
            document.getElementById('datePickerInput').value = '';
            return;
        }

        // Don't allow dates before data availability
        if (selectedDate < earliestTime) {
            alert('No data available for this date.');
            document.getElementById('datePickerInput').value = '';
            return;
        }

        // Jump to end of selected day (or latest data if selected day is partial)
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);

        this.selectedTime = endOfDay > latestTime ? latestTime : endOfDay;
        this.isLiveMode = false;
        this.updateDisplay();
        this.notifyObservers();
    }

    updateDatePickerConstraints() {
        const dateInput = document.getElementById('datePickerInput');
        if (!dateInput) return;

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const maxDate = yesterday.toISOString().split('T')[0];

        const earliestTime = this.getEarliestDataTime();
        const minDate = earliestTime.toISOString().split('T')[0];

        dateInput.max = maxDate;
        dateInput.min = minDate;
    }

    updateDisplay() {
        const timeDisplay = document.getElementById('timeDisplay');
        const modeIndicator = document.getElementById('timeModeIndicator');
        const controls = document.querySelector('.time-navigator-controls');
        const toggleLabel = document.getElementById('timeNavToggleLabel');
        const toggleBadge = document.getElementById('timeNavToggleBadge');

        if (this.isLiveMode) {
            timeDisplay.textContent = 'Live Mode';
            modeIndicator.textContent = '🔴 LIVE';
            modeIndicator.className = 'time-mode-indicator live';
            controls.classList.remove('historical-mode');
            if (toggleLabel) toggleLabel.textContent = 'Live Mode';
            if (toggleBadge) {
                toggleBadge.textContent = '🔴 LIVE';
                toggleBadge.className = 'tnt-badge live';
            }
        } else {
            const displayTime = this.selectedTime.toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            timeDisplay.textContent = displayTime;
            modeIndicator.textContent = '⏸️ HISTORICAL';
            modeIndicator.className = 'time-mode-indicator historical';
            controls.classList.add('historical-mode');
            if (toggleLabel) toggleLabel.textContent = displayTime;
            if (toggleBadge) {
                toggleBadge.textContent = '⏸️ HISTORICAL';
                toggleBadge.className = 'tnt-badge historical';
            }
        }

        // Update button states
        this.updateButtonStates();
    }

    updateButtonStates() {
        const backBtn = document.getElementById('timeNavBack');
        const backFastBtn = document.getElementById('timeNavBackFast');
        const forwardBtn = document.getElementById('timeNavForward');
        const forwardFastBtn = document.getElementById('timeNavForwardFast');

        if (this.isLiveMode) {
            // In live mode, only back buttons are enabled
            backBtn.disabled = false;
            backFastBtn.disabled = false;
            forwardBtn.disabled = true;
            forwardFastBtn.disabled = true;
        } else {
            const earliestTime = this.getEarliestDataTime();
            const latestTime = this.getLatestDataTime();

            // Check if we can go back further
            const canGoBack = this.selectedTime > earliestTime;
            backBtn.disabled = !canGoBack;
            backFastBtn.disabled = !canGoBack;

            // Check if we can go forward further
            const canGoForward = this.selectedTime < latestTime;
            forwardBtn.disabled = !canGoForward;
            forwardFastBtn.disabled = !canGoForward;
        }
    }

    getLatestDataTime() {
        if (!energyData || energyData.length === 0) return new Date();
        return convertToPDT(energyData[energyData.length - 1].LocalTimestamp);
    }

    getEarliestDataTime() {
        if (!energyData || energyData.length === 0) return new Date();
        return convertToPDT(energyData[0].LocalTimestamp);
    }

    // Get the effective "current" time for data filtering
    getCurrentTime() {
        return this.isLiveMode ? new Date() : this.selectedTime;
    }

    // Binary search: first index in sorted data whose timestamp is after `time`
    static upperBound(data, time) {
        let lo = 0, hi = data.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (convertToPDT(data[mid].LocalTimestamp) <= time) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // Get filtered data up to the selected time
    getFilteredData() {
        if (!energyData || energyData.length === 0) return [];

        if (this.isLiveMode) {
            return energyData; // Return all data in live mode
        }

        // Cached: multiple components request the same slice on every time step
        const key = this.selectedTime.getTime();
        if (this._filteredCache && this._filteredCache.key === key && this._filteredCache.source === energyData) {
            return this._filteredCache.data;
        }

        // Data is sorted by timestamp, so binary search + slice instead of a full scan
        const end = TimeNavigator.upperBound(energyData, this.selectedTime);
        const data = energyData.slice(0, end);
        this._filteredCache = { key, source: energyData, data };
        return data;
    }

    // Get the latest data point for the selected time
    getLatestDataPoint() {
        const filteredData = this.getFilteredData();
        return filteredData.length > 0 ? filteredData[filteredData.length - 1] : null;
    }

    // Subscribe to time changes
    subscribe(callback) {
        this.observers.push(callback);
    }

    // Unsubscribe from time changes
    unsubscribe(callback) {
        this.observers = this.observers.filter(obs => obs !== callback);
    }

    // Notify all observers of time change
    notifyObservers() {
        this.observers.forEach(callback => {
            try {
                callback(this.getCurrentTime(), this.isLiveMode);
            } catch (error) {
                console.error('Error notifying time navigator observer:', error);
            }
        });
    }

    // Get today's data relative to selected time
    getTodayDataForSelectedTime() {
        const currentTime = this.getCurrentTime();
        const startOfDay = new Date(currentTime);
        startOfDay.setHours(0, 0, 0, 0);

        const filteredData = this.getFilteredData();

        // filteredData is sorted and already capped at currentTime, so just find the day start
        const startIdx = TimeNavigator.upperBound(filteredData, new Date(startOfDay.getTime() - 1));
        const endIdx = TimeNavigator.upperBound(filteredData, currentTime);
        return filteredData.slice(startIdx, endIdx);
    }

    // Check if we're currently in live mode
    isInLiveMode() {
        return this.isLiveMode;
    }

    // Get the selected timestamp for historical mode
    getSelectedTime() {
        return this.selectedTime;
    }
}

// Global instance
let timeNavigator = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    console.log('Time navigator DOM ready, waiting for energy data...');

    // Wait for energy data to be loaded before initializing
    const initTimeNavigator = () => {
        if (typeof energyData !== 'undefined' && energyData && energyData.length > 0) {
            console.log('Energy data available, initializing time navigator');
            timeNavigator = new TimeNavigator();
            window.timeNavigator = timeNavigator; // Ensure it's available globally
            console.log('Time navigator initialized and available globally');
        } else {
            // Retry after a short delay
            setTimeout(initTimeNavigator, 500);
        }
    };

    initTimeNavigator();
});

// Export for use in other modules
window.timeNavigator = timeNavigator;