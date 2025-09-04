
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
    }, 100);
});