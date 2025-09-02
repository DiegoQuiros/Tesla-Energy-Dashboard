// Configuration - Update this URL to your Azure Blob Storage public URL
const AZURE_BLOB_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/energy-data.json';

let energyData = [];
let solarChart = null;
let batteryChart = null;
let temperatureChart = null;
let energyCreationChart = null;
let energyUsageChart = null;

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

    // Update energy flow display
    updateEnergyFlowCharts(latest);

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

function updateEnergyFlow(latest) {
    const solarPower = latest.SolarPowerKw || 0;
    const batteryPower = latest.BatteryPowerKw || 0; // Negative = charging, Positive = discharging
    const gridPower = latest.GridPowerKw || 0; // Negative = exporting, Positive = importing
    const loadPower = latest.LoadPowerKw || 0;

    // Calculate approximate energy distribution
    const model3ChargingPower = (latest.Model3IsCharging && latest.Model3ChargerPowerKw) ? latest.Model3ChargerPowerKw : 0;
    const modelXChargingPower = (latest.ModelXIsCharging && latest.ModelXChargerPowerKw) ? latest.ModelXChargerPowerKw : 0;
    const totalVehicleCharging = model3ChargingPower + modelXChargingPower;

    // Calculate thermostat power consumption - only if status is not OFF
    let thermostatPower = 0;
    if (latest.ThermostatIsOnline && latest.ThermostatStatus && latest.ThermostatStatus !== 'OFF') {
        if (latest.ThermostatIsActivelyRunning) {
            thermostatPower = 5.6;
        } else {
            thermostatPower = 1.2; // Air Wave fan running
        }
    }

    // Update solar generation
    document.getElementById('solarGeneration').textContent = `${solarPower.toFixed(1)} kW`;

    // Update thermostat energy
    const thermostatElement = document.getElementById('thermostatEnergy');
    const thermostatStatusElement = document.getElementById('thermostatEnergyStatus');
    thermostatElement.textContent = `${thermostatPower.toFixed(1)} kW`;
    thermostatElement.className = thermostatPower > 0 ? 'energy-value small energy-charging' : 'energy-value small energy-inactive';
    thermostatStatusElement.textContent = latest.ThermostatStatus === 'OFF' ? 'Off' :
        (latest.ThermostatIsActivelyRunning ? latest.ThermostatStatus : 'Fan');

    // Update Powerwall energy
    const powerwallElement = document.getElementById('powerwallEnergy');
    const powerwallStatusElement = document.getElementById('powerwallEnergyStatus');
    powerwallElement.textContent = `${Math.abs(batteryPower).toFixed(1)} kW`;
    if (batteryPower < -0.1) {
        powerwallElement.className = 'energy-value small energy-charging';
        powerwallStatusElement.textContent = 'Charging';
    } else if (batteryPower > 0.1) {
        powerwallElement.className = 'energy-value small energy-discharging';
        powerwallStatusElement.textContent = 'Discharging';
    } else {
        powerwallElement.className = 'energy-value small energy-inactive';
        powerwallStatusElement.textContent = 'Idle';
    }

    // Update Model 3 energy
    const model3Element = document.getElementById('model3Energy');
    const model3StatusElement = document.getElementById('model3EnergyStatus');
    model3Element.textContent = `${model3ChargingPower.toFixed(1)} kW`;
    model3Element.className = model3ChargingPower > 0 ? 'energy-value small energy-charging' : 'energy-value small energy-inactive';
    model3StatusElement.textContent = latest.Model3IsCharging ? 'Charging' : (latest.Model3IsAvailable ? 'Ready' : 'Offline');

    // Update Model X energy
    const modelXElement = document.getElementById('modelxEnergy');
    const modelXStatusElement = document.getElementById('modelxEnergyStatus');
    modelXElement.textContent = `${modelXChargingPower.toFixed(1)} kW`;
    modelXElement.className = modelXChargingPower > 0 ? 'energy-value small energy-charging' : 'energy-value small energy-inactive';
    modelXStatusElement.textContent = latest.ModelXIsCharging ? 'Charging' : (latest.ModelXIsAvailable ? 'Ready' : 'Offline');

    // Update Grid energy
    const gridElement = document.getElementById('gridEnergy');
    const gridStatusElement = document.getElementById('gridEnergyStatus');
    gridElement.textContent = `${Math.abs(gridPower).toFixed(1)} kW`;
    if (gridPower > 0.1) {
        gridElement.className = 'energy-value small energy-grid-import';
        gridStatusElement.textContent = 'Importing';
    } else if (gridPower < -0.1) {
        gridElement.className = 'energy-value small energy-grid-export';
        gridStatusElement.textContent = 'Exporting';
    } else {
        gridElement.className = 'energy-value small energy-inactive';
        gridStatusElement.textContent = 'Balanced';
    }
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

    createTemperatureChart(todayData);
    createSolarChart(todayData);
    createBatteryChart(todayData);
}

function updateEnergyFlowCharts(latest) {
    const solarPower = latest.SolarPowerKw || 0;
    const batteryPower = latest.BatteryPowerKw || 0; // Negative = charging, Positive = discharging
    const gridPower = latest.GridPowerKw || 0; // Negative = exporting, Positive = importing

    // Energy Creation Sources
    const energyCreation = [];
    const creationLabels = [];
    const creationColors = [];

    if (solarPower > 0) {
        energyCreation.push(solarPower);
        creationLabels.push('Solar Panels');
        creationColors.push('#ffcc00');
    }

    if (batteryPower > 0) {
        energyCreation.push(batteryPower);
        creationLabels.push('Powerwall Discharge');
        creationColors.push('#ff4444');
    }

    if (gridPower > 0) {
        energyCreation.push(gridPower);
        creationLabels.push('Grid Import');
        creationColors.push('#ff6b35');
    }

    // Calculate total energy creation
    const totalCreation = solarPower + (batteryPower > 0 ? batteryPower : 0) + (gridPower > 0 ? gridPower : 0);

    // Energy Usage Destinations
    const energyUsage = [];
    const usageLabels = [];
    const usageColors = [];

    // Powerwall charging (negative battery power)
    if (batteryPower < 0) {
        energyUsage.push(Math.abs(batteryPower));
        usageLabels.push('Powerwall Charging');
        usageColors.push('#00cc00');
    }

    // Grid export (negative grid power)
    if (gridPower < 0) {
        energyUsage.push(Math.abs(gridPower));
        usageLabels.push('Grid Export');
        usageColors.push('#00ff88');
    }

    // Thermostat power consumption - only if thermostat status is not OFF
    let thermostatPower = 0;
    if (latest.ThermostatIsOnline && latest.ThermostatStatus && latest.ThermostatStatus !== 'OFF') {
        // Check if actively running (full 5.6kW) or just fan running (~1.2kW for Air Wave)
        if (latest.ThermostatIsActivelyRunning) {
            thermostatPower = 5.6;
        } else {
            // Thermostat is ON but not actively heating/cooling - could be fan running (Air Wave)
            thermostatPower = 1.2;
        }
    }

    if (thermostatPower > 0) {
        energyUsage.push(thermostatPower);
        usageLabels.push('Thermostat');
        usageColors.push('#4a9eff');
    }

    // Model 3 charging
    const model3ChargingPower = (latest.Model3IsCharging && latest.Model3ChargerPowerKw) ? latest.Model3ChargerPowerKw : 0;
    if (model3ChargingPower > 0) {
        energyUsage.push(model3ChargingPower);
        usageLabels.push('Model 3 Charging');
        usageColors.push('#ff6666');
    }

    // Model X charging
    const modelXChargingPower = (latest.ModelXIsCharging && latest.ModelXChargerPowerKw) ? latest.ModelXChargerPowerKw : 0;
    if (modelXChargingPower > 0) {
        energyUsage.push(modelXChargingPower);
        usageLabels.push('Model X Charging');
        usageColors.push('#6677ff');
    }

    // Calculate house power as remainder to ensure total creation = total usage
    const categorizedUsage = Math.abs(batteryPower < 0 ? batteryPower : 0) +
        (gridPower < 0 ? Math.abs(gridPower) : 0) +
        thermostatPower +
        model3ChargingPower +
        modelXChargingPower;

    const housePower = Math.max(0, totalCreation - categorizedUsage);
    if (housePower > 0.1) {
        energyUsage.push(housePower);
        usageLabels.push('House');
        usageColors.push('#9f7aea');
    }

    // Calculate totals (should be equal now)
    const totalCreationSum = energyCreation.reduce((sum, val) => sum + val, 0);
    const totalUsageSum = energyUsage.reduce((sum, val) => sum + val, 0);

    document.getElementById('totalCreation').textContent = `${totalCreationSum.toFixed(1)} kW`;
    document.getElementById('totalUsage').textContent = `${totalUsageSum.toFixed(1)} kW`;

    // Create or update charts
    createEnergyCreationChart(energyCreation, creationLabels, creationColors);
    createEnergyUsageChart(energyUsage, usageLabels, usageColors);
}

function createEnergyCreationChart(data, labels, colors) {
    const ctx = document.getElementById('energyCreationChart').getContext('2d');

    // Destroy existing chart
    if (energyCreationChart) {
        energyCreationChart.destroy();
    }

    if (data.length === 0) {
        // Show empty state
        data = [1];
        labels = ['No Energy Creation'];
        colors = ['#333'];
    }

    energyCreationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#1e1e1e',
                cutout: '70%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#ffffff',
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value.toFixed(1)} kW (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function createEnergyUsageChart(data, labels, colors) {
    const ctx = document.getElementById('energyUsageChart').getContext('2d');

    // Destroy existing chart
    if (energyUsageChart) {
        energyUsageChart.destroy();
    }

    if (data.length === 0) {
        // Show empty state
        data = [1];
        labels = ['No Energy Usage'];
        colors = ['#333'];
    }

    energyUsageChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#1e1e1e',
                cutout: '70%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#ffffff',
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value.toFixed(1)} kW (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function createTemperatureChart(todayData) {
    const ctx = document.getElementById('temperatureChart').getContext('2d');

    // Destroy existing chart
    if (temperatureChart) {
        temperatureChart.destroy();
    }

    // Create labels for all 24 hours
    const allHours = [];
    for (let i = 0; i < 24; i++) {
        const hour = i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`;
        allHours.push(hour);
    }

    // Initialize arrays for all 24 hours with null values
    const indoorTemps = new Array(24).fill(null);
    const outdoorTemps = new Array(24).fill(null);
    const outdoorForecast = new Array(24).fill(null);

    // Fill in actual data
    todayData.forEach(point => {
        const date = convertToPDT(point.LocalTimestamp);
        const hour = date.getHours();

        if (point.ThermostatCurrentTempF && point.ThermostatCurrentTempF > 0) {
            indoorTemps[hour] = point.ThermostatCurrentTempF;
        }

        if (point.WeatherTemperatureF && point.WeatherTemperatureF > -50) {
            outdoorTemps[hour] = point.WeatherTemperatureF;
        }
    });

    // Generate simple forecast for remaining hours
    const now = new Date();
    const currentHour = now.getHours();
    const lastOutdoorTemp = todayData.length > 0 ? (todayData[todayData.length - 1].WeatherTemperatureF || 70) : 70;

    for (let i = currentHour + 1; i < 24; i++) {
        // Simple forecast: cooler at night, warmer during day
        let tempAdjustment = 0;
        if (i >= 6 && i <= 18) {
            // Daytime: slightly warmer
            tempAdjustment = Math.sin((i - 6) / 12 * Math.PI) * 8;
        } else {
            // Nighttime: cooler
            tempAdjustment = -5;
        }
        outdoorForecast[i] = Math.round(lastOutdoorTemp + tempAdjustment);
    }

    const datasets = [
        {
            label: 'Indoor Temperature',
            data: indoorTemps,
            borderColor: '#4a9eff',
            backgroundColor: 'rgba(74, 158, 255, 0.1)',
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 4,
            pointBackgroundColor: '#4a9eff',
            spanGaps: true
        },
        {
            label: 'Outdoor Temperature',
            data: outdoorTemps,
            borderColor: '#ffcc00',
            backgroundColor: 'rgba(255, 204, 0, 0.1)',
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 4,
            pointBackgroundColor: '#ffcc00',
            spanGaps: true
        },
        {
            label: 'Outdoor Forecast',
            data: outdoorForecast,
            borderColor: 'transparent',
            backgroundColor: 'rgba(255, 204, 0, 0.3)',
            pointRadius: 4,
            pointBackgroundColor: 'rgba(255, 204, 0, 0.6)',
            pointBorderColor: '#ffcc00',
            pointBorderWidth: 2,
            showLine: false,
            spanGaps: false
        }
    ];

    temperatureChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allHours,
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
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + '°F';
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

    // Generate 15-minute interval predictions until end of day
    let currentTime = new Date(now);
    currentTime.setMinutes(Math.ceil(currentTime.getMinutes() / 15) * 15, 0, 0); // Round to next 15-minute mark

    // Convert current battery percentage to kWh for Powerwall
    let currentPowerwallKwh = ((latest.BatteryPercentage || 0) / 100) * BATTERY_CAPACITIES.POWERWALL;
    let currentModel3Level = latest.Model3Battery || 0;
    let currentModelXLevel = latest.ModelXBattery || 0;

    // Calculate total power consumption rate including thermostat
    let totalConsumptionKw = 0;

    // Add thermostat consumption only if status is not OFF
    if (latest.ThermostatIsOnline && latest.ThermostatStatus && latest.ThermostatStatus !== 'OFF') {
        if (latest.ThermostatIsActivelyRunning) {
            totalConsumptionKw += 5.6; // Full AC/heating power
        } else {
            totalConsumptionKw += 1.2; // Just fan running (Air Wave)
        }
    }

    // Add vehicle charging if active
    if (latest.Model3IsCharging && latest.Model3ChargerPowerKw) {
        totalConsumptionKw += latest.Model3ChargerPowerKw;
    }
    if (latest.ModelXIsCharging && latest.ModelXChargerPowerKw) {
        totalConsumptionKw += latest.ModelXChargerPowerKw;
    }

    // Add base house consumption (estimated from load power minus known consumers)
    const loadPower = latest.LoadPowerKw || 0;
    const knownConsumption = (latest.ThermostatIsOn && latest.ThermostatIsOnline ?
        (latest.ThermostatIsActivelyRunning ? 5.6 : 1.2) : 0) +
        (latest.Model3IsCharging ? (latest.Model3ChargerPowerKw || 0) : 0) +
        (latest.ModelXIsCharging ? (latest.ModelXChargerPowerKw || 0) : 0);
    const houseBaseConsumption = Math.max(0, loadPower - knownConsumption);
    totalConsumptionKw += houseBaseConsumption;

    // Get current solar and grid input
    const solarPowerKw = latest.SolarPowerKw || 0;
    const gridImportKw = Math.max(0, latest.GridPowerKw || 0);
    const totalEnergyInputKw = solarPowerKw + gridImportKw;

    // Net drain on Powerwall = total consumption - total energy input
    // If positive, Powerwall discharges; if negative, Powerwall charges
    const netPowerwallDrainKw = totalConsumptionKw - totalEnergyInputKw;

    console.log(`Powerwall prediction: Current=${currentPowerwallKwh.toFixed(1)}kWh, Net drain=${netPowerwallDrainKw.toFixed(1)}kW, Total consumption=${totalConsumptionKw.toFixed(1)}kW`);

    while (currentTime <= endOfDay) {
        predictions.labels.push(currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

        // Powerwall prediction based on net energy drain
        if (netPowerwallDrainKw > 0) {
            // Powerwall is discharging to meet demand
            const energyConsumedIn15Min = netPowerwallDrainKw * 0.25; // kW * 0.25 hours = kWh
            currentPowerwallKwh = Math.max(0, currentPowerwallKwh - energyConsumedIn15Min);
        } else if (netPowerwallDrainKw < 0) {
            // Excess energy is charging the Powerwall
            const energyGainedIn15Min = Math.abs(netPowerwallDrainKw) * 0.25;
            currentPowerwallKwh = Math.min(BATTERY_CAPACITIES.POWERWALL, currentPowerwallKwh + energyGainedIn15Min);
        }
        // If netPowerwallDrainKw is 0, no change to Powerwall

        // Convert kWh back to percentage
        const powerwallPercentage = (currentPowerwallKwh / BATTERY_CAPACITIES.POWERWALL) * 100;

        // Vehicle charging predictions (unchanged)
        if (latest.Model3IsCharging && latest.Model3ChargerPowerKw > 0) {
            // Calculate charging rate per 15 minutes
            const chargingRateKw = latest.Model3ChargerPowerKw;
            const percentageGainIn15Min = (chargingRateKw * 0.25 / BATTERY_CAPACITIES.MODEL_3) * 100;
            currentModel3Level = Math.min(100, currentModel3Level + percentageGainIn15Min);
        }

        if (latest.ModelXIsCharging && latest.ModelXChargerPowerKw > 0) {
            const chargingRateKw = latest.ModelXChargerPowerKw;
            const percentageGainIn15Min = (chargingRateKw * 0.25 / BATTERY_CAPACITIES.MODEL_X) * 100;
            currentModelXLevel = Math.min(100, currentModelXLevel + percentageGainIn15Min);
        }

        predictions.powerwall.push(powerwallPercentage);
        predictions.model3.push(latest.Model3IsAvailable ? currentModel3Level : null);
        predictions.modelX.push(latest.ModelXIsAvailable ? currentModelXLevel : null);

        currentTime.setMinutes(currentTime.getMinutes() + 15);
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