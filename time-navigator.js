// Time Navigation System
class TimeNavigator {
    constructor() {
        this.selectedTime = null; // null means "current time" (live mode)
        this.isLiveMode = true;
        this.timeStep = 15; // minutes
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

        container.innerHTML = `
            <div class="time-navigator-controls">
                <button id="timeNavBack" class="time-nav-btn" title="Go back 15 minutes">
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
                <button id="timeNavForward" class="time-nav-btn" title="Go forward 15 minutes">
                    <span>⏩</span>
                </button>
                <button id="timeNavLive" class="time-nav-btn live-btn" title="Return to live mode">
                    <span>🔴 LIVE</span>
                </button>
            </div>
        `;

        // Insert after the header
        const header = document.querySelector('.header');
        if (header) {
            header.parentNode.insertBefore(container, header.nextSibling);
        } else {
            document.body.insertBefore(container, document.body.firstChild);
        }
    }

    bindEvents() {
        document.getElementById('timeNavBack').addEventListener('click', () => this.stepTime(-this.timeStep));
        document.getElementById('timeNavBackFast').addEventListener('click', () => this.stepTime(-60));
        document.getElementById('timeNavForward').addEventListener('click', () => this.stepTime(this.timeStep));
        document.getElementById('timeNavForwardFast').addEventListener('click', () => this.stepTime(60));
        document.getElementById('timeNavLive').addEventListener('click', () => this.goToLiveMode());

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

    updateDisplay() {
        const timeDisplay = document.getElementById('timeDisplay');
        const modeIndicator = document.getElementById('timeModeIndicator');
        const controls = document.querySelector('.time-navigator-controls');

        if (this.isLiveMode) {
            timeDisplay.textContent = 'Live Mode';
            modeIndicator.textContent = '🔴 LIVE';
            modeIndicator.className = 'time-mode-indicator live';
            controls.classList.remove('historical-mode');
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

    // Get filtered data up to the selected time
    getFilteredData() {
        if (!energyData || energyData.length === 0) return [];

        if (this.isLiveMode) {
            return energyData; // Return all data in live mode
        }

        // Filter data up to selected time
        return energyData.filter(point => {
            const pointTime = convertToPDT(point.LocalTimestamp);
            return pointTime <= this.selectedTime;
        });
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

        return filteredData.filter(point => {
            const pointDate = convertToPDT(point.LocalTimestamp);
            return pointDate >= startOfDay && pointDate <= currentTime;
        });
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