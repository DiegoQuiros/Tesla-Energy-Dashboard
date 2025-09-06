
// Auto-refresh every 5 minutes
function startAutoRefresh() {
    setInterval(() => {
        console.log('Auto-refreshing data...');
        loadEnergyData();
    }, 15 * 60 * 1000); // 15 minutes
}

// Start timer for refreshing stale data labels every minute
function startStaleDataTimer() {
    setInterval(() => {
        refreshStaleDataLabels();
    }, 60 * 1000); // 1 minute
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function () {
    // Wait a bit for Chart.js to fully load
    setTimeout(() => {
        loadEnergyData();
        startAutoRefresh();
        startStaleDataTimer(); // Start the stale data refresh timer
        startSmartAutoRefresh(); // Start the smart auto-refresh mechanism
    }, 100);
});

let smartRefreshTimeout = null;

// Calculate next refresh time based on last data timestamp
function scheduleSmartRefresh() {
    // Clear any existing timeout
    if (smartRefreshTimeout) {
        clearTimeout(smartRefreshTimeout);
        smartRefreshTimeout = null;
    }

    if (!lastDataTimestamp) {
        console.log('No last data timestamp available, using fallback refresh');
        return;
    }

    // Calculate when the next data update should occur
    // Data updates every 15 minutes, so find the next 15-minute interval after the last update
    const lastUpdate = new Date(lastDataTimestamp);
    const nextUpdateTime = new Date(lastUpdate);

    // Round up to the next 15-minute interval
    const minutes = nextUpdateTime.getMinutes();
    const nextQuarter = Math.ceil(minutes / 15) * 15;
    nextUpdateTime.setMinutes(nextQuarter, 0, 0); // Set to next quarter hour

    // Add 10 seconds buffer to ensure data is available
    const refreshTime = new Date(nextUpdateTime.getTime() + 25000); // +25 seconds

    const now = new Date();
    const timeUntilRefresh = refreshTime.getTime() - now.getTime();

    // If the calculated time is in the past or too soon, wait for the next 15-minute interval
    if (timeUntilRefresh <= 0) {
        nextUpdateTime.setMinutes(nextUpdateTime.getMinutes() + 15);
        const newRefreshTime = new Date(nextUpdateTime.getTime() + 15000);
        const newTimeUntilRefresh = newRefreshTime.getTime() - now.getTime();

        console.log(`Smart refresh scheduled for ${newRefreshTime.toLocaleTimeString()} (in ${Math.round(newTimeUntilRefresh / 1000 / 60)} minutes)`);

        smartRefreshTimeout = setTimeout(() => {
            console.log('Smart refresh triggered - fetching latest data...');
            loadEnergyData().then(() => {
                // Schedule the next refresh after successful data load
                scheduleSmartRefresh();
            });
        }, newTimeUntilRefresh);
    } else {
        console.log(`Smart refresh scheduled for ${refreshTime.toLocaleTimeString()} (in ${Math.round(timeUntilRefresh / 1000 / 60)} minutes)`);

        smartRefreshTimeout = setTimeout(() => {
            console.log('Smart refresh triggered - fetching latest data...');
            loadEnergyData().then(() => {
                // Schedule the next refresh after successful data load
                scheduleSmartRefresh();
            });
        }, timeUntilRefresh);
    }
}

// Modified auto-refresh function to use smart refresh
function startSmartAutoRefresh() {
    // Initial schedule
    scheduleSmartRefresh();

    // Keep the existing 15-minute fallback timer as backup
    setInterval(() => {
        console.log('Fallback refresh triggered...');
        loadEnergyData().then(() => {
            // Reschedule smart refresh in case it got out of sync
            scheduleSmartRefresh();
        });
    }, 15 * 60 * 1000); // 15 minutes fallback
}