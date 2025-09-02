// Configuration - Update this URL to your Azure Blob Storage public URL
const AZURE_BLOB_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/energy-data.json';

let energyData = [];
let solarChart = null;
let batteryChart = null;

// Battery capacities in kWh
const BATTERY_CAPACITIES = {
    MODEL_3: 52.4, // kWh - Model 3 Standard Range Plus
    MODEL_X: 100, // kWh - Model X
    POWERWALL: 13.5 // kWh - Tesla Powerwall
};

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

async function loadEnergyData() {
    try {
        console.log('Loading energy data from:', AZURE_BLOB_URL);

        // Add cache busting parameter to avoid browser cache issues
        const url = `${AZURE_BLOB_URL}?t=${Date.now()}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Data is not in expected array format');
        }

        energyData = data.sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));

        console.log(`Loaded ${energyData.length} data points`);

        if (energyData.length === 0) {
            throw new Error('No data available');
        }

        updateDashboard();

        // Wait for Chart.js to be loaded before creating charts
        if (typeof Chart !== 'undefined') {
            createCharts();
        } else {
            console.error('Chart.js not loaded');
            setTimeout(() => {
                if (typeof Chart !== 'undefined') {
                    createCharts();
                }
            }, 1000);
        }

    } catch (error) {
        console.error('Error loading energy data:', error);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = 'block';
        document.getElementById('errorMessage').textContent = error.message;
    }
}

function updateDashboard() {
    if (energyData.length === 0) return;

    const latest = energyData[energyData.length - 1];
    console.log('Latest data point:', latest);
    const now = new Date();
    const lastUpdated = convertToPDT(latest.LocalTimestamp);

    // Update timestamp
    document.getElementById('lastUpdated').textContent = `Last updated: ${lastUpdated.toLocaleString()}`;

    // Update weather
    document.getElementById('weatherTemp').textContent = `${latest.WeatherTemperatureF || '--'}°F`;
    document.getElementById('weatherCondition').textContent = latest.WeatherConditions || 'Unknown';
    document.getElementById('weatherHumidity').textContent = `${latest.WeatherHumidity || '--'}%`;
    document.getElementById('weatherSolarImpact').textContent = latest.WeatherSolarImpact ? `${(latest.WeatherSolarImpact * 100).toFixed(0)}%` : '--';

    // Update Thermostat
    updateThermostatCard(latest, now);

    // Update Powerwall
    const batteryPercent = latest.BatteryPercentage || 0;
    document.getElementById('powerwallPercent').textContent = `${batteryPercent.toFixed(1)}%`;
    document.getElementById('powerwallKwh').textContent = `${calculateKwh(batteryPercent, BATTERY_CAPACITIES.POWERWALL)} kWh`;
    document.getElementById('powerwallBar').style.width = `${100 - batteryPercent}%`; // Invert for gradient effect

    // Add stale info for Powerwall
    const powerwallAge = formatTimeDifference(lastUpdated, now);
    const powerwallStaleInfo = document.getElementById('powerwallStaleInfo');
    powerwallStaleInfo.textContent = powerwallAge;
    powerwallStaleInfo.style.display = 'block';

    // Update power flow
    document.getElementById('solarPower').textContent = `${(latest.SolarPowerKw || 0).toFixed(1)} kW`;

    const batteryPower = latest.BatteryPowerKw || 0;
    const batteryElement = document.getElementById('batteryPower');
    batteryElement.textContent = `${Math.abs(batteryPower).toFixed(1)} kW`;
    batteryElement.className = `power-value ${batteryPower < 0 ? 'battery-charging' : batteryPower > 0 ? 'battery-discharging' : ''}`;

    const gridPower = latest.GridPowerKw || 0;
    const gridElement = document.getElementById('gridPower');
    gridElement.textContent = `${Math.abs(gridPower).toFixed(1)} kW`;
    gridElement.className = `power-value ${gridPower > 0 ? 'grid-positive' : gridPower < 0 ? 'grid-negative' : ''}`;

    // Update Model 3
    updateVehicleCard('Model3', 'model3', latest, now, BATTERY_CAPACITIES.MODEL_3);

    // Update Model X
    updateVehicleCard('ModelX', 'modelX', latest, now, BATTERY_CAPACITIES.MODEL_X);

    // Show dashboard
    document.getElementById('loading').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
}

function updateThermostatCard(latest, currentTime) {
    const tempElement = document.getElementById('thermostatTemp');
    const modeDisplayElement = document.getElementById('thermostatModeDisplay');
    const targetElement = document.getElementById('thermostatTarget');
    const modeElement = document.getElementById('thermostatMode');
    const statusElement = document.getElementById('thermostatStatus');
    const humidityElement = document.getElementById('thermostatHumidity');
    const staleInfoElement = document.getElementById('thermostatStaleInfo');
    const ecoLeafElement = document.getElementById('ecoLeaf');

    if (latest.ThermostatIsOnline) {
        const temp = latest.ThermostatCurrentTempF || 0;
        const targetTemp = latest.ThermostatTargetTempF || 0;
        const mode = latest.ThermostatMode || 'OFF';
        const status = latest.ThermostatStatus || 'OFF';

        tempElement.textContent = `${temp.toFixed(0)}`;
        modeDisplayElement.textContent = mode === 'OFF' ? 'Off' : 'Comfort';
        targetElement.textContent = targetTemp > 0 ? `Target: ${targetTemp.toFixed(0)}°F` : 'Target: --°F';
        modeElement.textContent = mode;
        statusElement.textContent = status;
        humidityElement.textContent = `${latest.ThermostatHumidity || '--'}%`;

        // Show/hide eco leaf based on mode
        ecoLeafElement.style.display = mode !== 'OFF' && !latest.ThermostatIsActivelyRunning ? 'block' : 'none';

        // Always show data age for thermostat
        const dataAge = formatTimeDifference(convertToPDT(latest.LocalTimestamp), currentTime);
        staleInfoElement.textContent = dataAge;
        staleInfoElement.style.display = 'block';
    } else {
        tempElement.textContent = '--';
        modeDisplayElement.textContent = 'Offline';
        targetElement.textContent = 'Target: --°F';
        modeElement.textContent = 'Offline';
        statusElement.textContent = 'Offline';
        humidityElement.textContent = '--%';
        ecoLeafElement.style.display = 'none';
        staleInfoElement.style.display = 'none';
    }
}

function updateVehicleCard(vehiclePrefix, cardPrefix, latest, currentTime, batteryCapacity) {
    const cardElement = document.getElementById(`${cardPrefix}Card`);
    const percentElement = document.getElementById(`${cardPrefix}Percent`);
    const kwhElement = document.getElementById(`${cardPrefix}Kwh`);
    const barElement = document.getElementById(`${cardPrefix}Bar`);
    const statusElement = document.getElementById(`${cardPrefix}Status`);
    const rangeElement = document.getElementById(`${cardPrefix}Range`);
    const chargingDiv = document.getElementById(`${cardPrefix}Charging`);
    const chargingRateElement = document.getElementById(`${cardPrefix}ChargingRate`);
    const staleInfoElement = document.getElementById(`${cardPrefix}StaleInfo`);

    let dataToUse = null;
    let dataTimestamp = null;

    if (latest[`${vehiclePrefix}IsAvailable`]) {
        // Vehicle is currently available
        cardElement.classList.remove('offline-data');
        dataToUse = latest;
        dataTimestamp = convertToPDT(latest.LocalTimestamp);
    } else {
        // Vehicle is offline, find last available data
        const lastData = findLastVehicleData(vehiclePrefix);
        if (lastData) {
            cardElement.classList.add('offline-data');
            dataToUse = lastData.data;
            dataTimestamp = convertToPDT(lastData.data.LocalTimestamp);
        }
    }

    if (dataToUse && dataTimestamp) {
        const batteryPercent = dataToUse[`${vehiclePrefix}Battery`] || 0;
        percentElement.textContent = `${batteryPercent}%`;
        kwhElement.textContent = `${calculateKwh(batteryPercent, batteryCapacity)} kWh`;
        barElement.style.width = `${100 - batteryPercent}%`; // Invert for gradient effect

        if (latest[`${vehiclePrefix}IsAvailable`]) {
            statusElement.textContent = dataToUse[`${vehiclePrefix}ChargingState`] || 'Unknown';
        } else {
            statusElement.textContent = 'Offline';
        }

        rangeElement.textContent = `${Math.round(dataToUse[`${vehiclePrefix}EstimatedRangeMiles`] || 0)} mi`;

        if (dataToUse[`${vehiclePrefix}IsCharging`] && latest[`${vehiclePrefix}IsAvailable`]) {
            chargingDiv.style.display = 'block';
            chargingRateElement.textContent = `${dataToUse[`${vehiclePrefix}ChargerPowerKw`] || 0} kW`;
        } else {
            chargingDiv.style.display = 'none';
        }

        // Always show data age
        const dataAge = formatTimeDifference(dataTimestamp, currentTime);
        staleInfoElement.textContent = dataAge;
        staleInfoElement.style.display = 'block';
    } else {
        // No data available at all
        percentElement.textContent = '--%';
        kwhElement.textContent = '-- kWh';
        barElement.style.width = '100%'; // Full coverage when no data
        statusElement.textContent = 'No Data';
        rangeElement.textContent = '-- mi';
        chargingDiv.style.display = 'none';
        staleInfoElement.style.display = 'none';
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

function createCharts() {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded');
        return;
    }

    const todayData = getTodayData();
    console.log(`Creating charts with ${todayData.length} today's data points`);

    if (todayData.length === 0) {
        console.warn('No data for today to display in charts');
        return;
    }

    createSolarChart(todayData);
    createBatteryChart(todayData);
}

function createSolarChart(todayData) {
    const ctx = document.getElementById('solarChart').getContext('2d');

    // Destroy existing chart
    if (solarChart) {
        solarChart.destroy();
    }

    const timeLabels = todayData.map(point => {
        const date = convertToPDT(point.LocalTimestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    });

    const solarData = todayData.map(point => Math.max(0, point.SolarPowerKw || 0));

    solarChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: 'Solar Production (kW)',
                data: solarData,
                borderColor: '#ffcc00',
                backgroundColor: 'rgba(255, 204, 0, 0.2)',
                fill: true,
                tension: 0.4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff'
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 12
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + ' kW';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function createBatteryChart(todayData) {
    const ctx = document.getElementById('batteryChart').getContext('2d');

    // Destroy existing chart
    if (batteryChart) {
        batteryChart.destroy();
    }

    const timeLabels = todayData.map(point => {
        const date = convertToPDT(point.LocalTimestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    });

    const powerwallData = todayData.map(point => point.BatteryPercentage || 0);
    const model3Data = todayData.map(point => point.Model3IsAvailable ? (point.Model3Battery || 0) : null);
    const modelXData = todayData.map(point => point.ModelXIsAvailable ? (point.ModelXBattery || 0) : null);

    // Generate predictions for the rest of the day
    const predictions = generateBatteryPredictions(todayData);

    // Get the current time in PDT to determine split point
    const currentPDT = new Date();
    const latestDataTime = convertToPDT(todayData[todayData.length - 1].LocalTimestamp);
    const actualDataCount = todayData.length;

    const datasets = [
        // Actual Powerwall data
        {
            label: 'Powerwall',
            data: powerwallData,
            borderColor: '#00cc00',
            backgroundColor: 'rgba(0, 204, 0, 0.1)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 3
        },
        // Predicted Powerwall data
        {
            label: 'Powerwall (Predicted)',
            data: Array(actualDataCount).fill(null).concat(predictions.powerwall),
            borderColor: 'transparent', // No connecting lines
            backgroundColor: 'rgba(0, 204, 0, 0.3)',
            pointStyle: 'circle',
            pointRadius: 3,
            pointBorderColor: '#00cc00',
            pointBackgroundColor: 'rgba(0, 204, 0, 0.6)',
            showLine: false // This prevents connecting lines between prediction points
        },
        // Actual Model 3 data
        {
            label: 'Model 3',
            data: model3Data,
            borderColor: '#ff4444',
            backgroundColor: 'rgba(255, 68, 68, 0.1)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 3
        },
        // Predicted Model 3 data
        {
            label: 'Model 3 (Predicted)',
            data: Array(actualDataCount).fill(null).concat(predictions.model3),
            borderColor: 'transparent',
            backgroundColor: 'rgba(255, 68, 68, 0.3)',
            pointStyle: 'circle',
            pointRadius: 3,
            pointBorderColor: '#ff4444',
            pointBackgroundColor: 'rgba(255, 68, 68, 0.6)',
            showLine: false
        },
        // Actual Model X data
        {
            label: 'Model X',
            data: modelXData,
            borderColor: '#4477ff',
            backgroundColor: 'rgba(68, 119, 255, 0.1)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 3
        },
        // Predicted Model X data
        {
            label: 'Model X (Predicted)',
            data: Array(actualDataCount).fill(null).concat(predictions.modelX),
            borderColor: 'transparent',
            backgroundColor: 'rgba(68, 119, 255, 0.3)',
            pointStyle: 'circle',
            pointRadius: 3,
            pointBorderColor: '#4477ff',
            pointBackgroundColor: 'rgba(68, 119, 255, 0.6)',
            showLine: false
        }
    ];

    batteryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels.concat(predictions.labels),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff'
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 12
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + '%';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function generateBatteryPredictions(todayData) {
    if (todayData.length === 0) {
        return { labels: [], powerwall: [], model3: [], modelX: [] };
    }

    const latest = todayData[todayData.length - 1];
    const now = convertToPDT(latest.LocalTimestamp);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59);

    const predictions = {
        labels: [],
        powerwall: [],
        model3: [],
        modelX: []
    };

    // Generate hourly predictions until end of day
    let currentTime = new Date(now);
    currentTime.setMinutes(0, 0, 0); // Round to next hour
    currentTime.setHours(currentTime.getHours() + 1);

    let currentPowerwallLevel = latest.BatteryPercentage || 0;
    let currentModel3Level = latest.Model3Battery || 0;
    let currentModelXLevel = latest.ModelXBattery || 0;

    while (currentTime <= endOfDay) {
        predictions.labels.push(currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

        // Simple prediction logic - you can make this more sophisticated
        if (latest.Model3IsCharging && latest.Model3ChargerPowerKw > 0) {
            // Calculate charging rate per hour
            const chargingRateKw = latest.Model3ChargerPowerKw;
            const percentagePerHour = (chargingRateKw / BATTERY_CAPACITIES.MODEL_3) * 100;
            currentModel3Level = Math.min(100, currentModel3Level + percentagePerHour);
        }

        if (latest.ModelXIsCharging && latest.ModelXChargerPowerKw > 0) {
            const chargingRateKw = latest.ModelXChargerPowerKw;
            const percentagePerHour = (chargingRateKw / BATTERY_CAPACITIES.MODEL_X) * 100;
            currentModelXLevel = Math.min(100, currentModelXLevel + percentagePerHour);
        }

        // Powerwall prediction based on solar/load patterns
        const hour = currentTime.getHours();
        if (hour >= 6 && hour <= 18 && latest.SolarPowerKw > 0) {
            // Daytime - might charge from solar
            currentPowerwallLevel = Math.min(100, currentPowerwallLevel + 2);
        } else {
            // Nighttime - might discharge
            currentPowerwallLevel = Math.max(0, currentPowerwallLevel - 1);
        }

        predictions.powerwall.push(currentPowerwallLevel);
        predictions.model3.push(latest.Model3IsAvailable ? currentModel3Level : null);
        predictions.modelX.push(latest.ModelXIsAvailable ? currentModelXLevel : null);

        currentTime.setHours(currentTime.getHours() + 1);
    }

    return predictions;
}

// Auto-refresh every 5 minutes
function startAutoRefresh() {
    //    setInterval(() => {
    //        console.log('Auto-refreshing data...');
    //        loadEnergyData();
    //    }, 5 * 60 * 1000); // 5 minutes
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function () {
    // Wait a bit for Chart.js to fully load
    setTimeout(() => {
        loadEnergyData();
        startAutoRefresh();
    }, 100);
});