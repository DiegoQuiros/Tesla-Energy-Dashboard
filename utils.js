// Helper function to convert UTC to Pacific Daylight Time
function convertToPDT(dateString) {
    const date = new Date(dateString);
    // Convert to Pacific Time (handles PDT/PST automatically)
    return new Date(date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
}

// Helper function to format time difference
function formatTimeDifference(date1, date2) {
    const diffMs = Math.abs(date2 - date1);
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const remainingMinutes = diffMinutes % 60;

    if (diffHours > 0) {
        return remainingMinutes > 0 ? `${diffHours}h ${remainingMinutes}m ago` : `${diffHours}h ago`;
    } else {
        return `${diffMinutes}m ago`;
    }
}

// Helper function to calculate kWh from percentage
function calculateKwh(percentage, capacity) {
    return ((percentage / 100) * capacity).toFixed(1);
}

// Function to find the last available data for a vehicle
function findLastVehicleData(vehiclePrefix) {
    for (let i = energyData.length - 1; i >= 0; i--) {
        const point = energyData[i];
        if (point[`${vehiclePrefix}IsAvailable`]) {
            return {
                data: point,
                age: new Date() - convertToPDT(point.LocalTimestamp)
            };
        }
    }
    return null;
}

// Function to refresh all stale data labels
function refreshStaleDataLabels() {
    if (!energyData.length || !lastDataTimestamp) return;

    const now = new Date();
    const latest = energyData[energyData.length - 1];

    // Update Powerwall stale info
    const powerwallAge = formatTimeDifference(lastDataTimestamp, now);
    const powerwallStaleInfo = document.getElementById('powerwallStaleInfo');
    if (powerwallStaleInfo) {
        powerwallStaleInfo.textContent = powerwallAge;
    }

    // Update Thermostat stale info
    const thermostatAge = formatTimeDifference(lastDataTimestamp, now);
    const thermostatStaleInfo = document.getElementById('thermostatStaleInfo');
    if (thermostatStaleInfo) {
        thermostatStaleInfo.textContent = thermostatAge;
    }

    // Update Model 3 stale info
    updateVehicleStaleInfo('Model3', 'model3', latest, now);

    // Update Model X stale info
    updateVehicleStaleInfo('ModelX', 'modelX', latest, now);
}

// Helper function to update vehicle stale info
function updateVehicleStaleInfo(vehiclePrefix, cardPrefix, latest, currentTime) {
    const staleInfoElement = document.getElementById(`${cardPrefix}StaleInfo`);
    if (!staleInfoElement) return;

    let dataTimestamp = null;

    if (latest[`${vehiclePrefix}IsAvailable`]) {
        // Vehicle is currently available - use latest timestamp
        dataTimestamp = lastDataTimestamp;
    } else {
        // Vehicle is offline, find last available data timestamp
        const lastData = findLastVehicleData(vehiclePrefix);
        if (lastData) {
            dataTimestamp = convertToPDT(lastData.data.LocalTimestamp);
        }
    }

    if (dataTimestamp) {
        const dataAge = formatTimeDifference(dataTimestamp, currentTime);
        staleInfoElement.textContent = dataAge;
    }
}

function getTodayData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return energyData.filter(point => {
        const pointDate = convertToPDT(point.LocalTimestamp);
        return pointDate >= today;
    });
}
