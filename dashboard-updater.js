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

        // Store the timestamp of the latest data
        lastDataTimestamp = convertToPDT(energyData[energyData.length - 1].LocalTimestamp);

        scheduleSmartRefresh();

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

        return Promise.resolve(); // Ensure this returns a resolved promise

    } catch (error) {
        console.error('Error loading energy data:', error);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = 'block';
        document.getElementById('errorMessage').textContent = error.message;
        return Promise.reject(error);
    }
}

function updateDashboard() {
    if (energyData.length === 0) return;

    // Use time navigator if available, otherwise use latest data
    let latest, now, lastUpdated;

    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        // Historical mode - use filtered data
        latest = window.timeNavigator.getLatestDataPoint();
        if (!latest) return; // No data available for selected time

        now = window.timeNavigator.getCurrentTime();
        lastUpdated = convertToPDT(latest.LocalTimestamp);
        console.log('Historical data point:', latest, 'as of:', now.toLocaleString());
    } else {
        // Live mode - use latest data
        latest = energyData[energyData.length - 1];
        now = new Date();
        lastUpdated = convertToPDT(latest.LocalTimestamp);
        console.log('Latest data point:', latest);
    }

    // Update timestamp with mode indicator
    const timestampText = window.timeNavigator && !window.timeNavigator.isInLiveMode()
        ? `Historical view: ${lastUpdated.toLocaleString()}`
        : `Last updated: ${lastUpdated.toLocaleString()}`;
    document.getElementById('lastUpdated').textContent = timestampText;

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
    document.getElementById('powerwallKwh').textContent = `${calculateBatteryKwh(batteryPercent, BATTERY_CAPACITIES.POWERWALL)} kWh`;
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

    updateVehicleCard('Model3', 'model3', latest, now, BATTERY_CAPACITIES.MODEL_3);
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

        // Check for temperature crossing alerts
        const indoorTemp = temp;
        const outdoorTemp = latest.WeatherTemperatureF || 0;

        if (temperatureAlertSystem && indoorTemp > 0 && outdoorTemp > -50) {
            temperatureAlertSystem.checkTemperatureCrossing(indoorTemp, outdoorTemp);
        }
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
    const chargingRateElement = document.getElementById(`${cardPrefix}ChargingRate`);
    const staleInfoElement = document.getElementById(`${cardPrefix}StaleInfo`);

    // Check if all required elements exist
    if (!percentElement || !kwhElement || !barElement || !statusElement || !rangeElement || !staleInfoElement) {
        console.warn(`Some vehicle display elements not found for ${cardPrefix}`);
        return;
    }

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
        else
            console.warn(`No last data found for ${vehiclePrefix}`);
    }

    if (dataToUse && dataTimestamp) {
        const batteryPercent = dataToUse[`${vehiclePrefix}Battery`] || 0;
        percentElement.textContent = `${batteryPercent}%`;
        kwhElement.textContent = `${calculateBatteryKwh(batteryPercent, batteryCapacity)} kWh`;
        barElement.style.width = `${100 - batteryPercent}%`; // Invert for gradient effect

        if (latest[`${vehiclePrefix}IsAvailable`]) {
            statusElement.textContent = dataToUse[`${vehiclePrefix}ChargingState`] || 'Unknown';
        } else {
            statusElement.textContent = 'Offline';
        }

        rangeElement.textContent = `${Math.round(dataToUse[`${vehiclePrefix}EstimatedRangeMiles`] || 0)} mi`;

        if (chargingRateElement) {
            if (dataToUse[`${vehiclePrefix}IsCharging`] && latest[`${vehiclePrefix}IsAvailable`]) {
                // Use amps to calculate kW charging rate
                const chargeAmps = dataToUse[`${vehiclePrefix}ChargeAmps`] || 0;
                chargingRateElement.textContent = `${calculateKwh(chargeAmps)} kW`;
            } else {
                chargingRateElement.textContent = '-- kW';
            }
        }
        else
            console.warn(`Charging rate element not found for ${cardPrefix}`);

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
        if (chargingRateElement) {
            chargingRateElement.textContent = '-- kW';
        }
        else
            console.warn(`Charging rate element not found for ${cardPrefix}`);

        staleInfoElement.style.display = 'none';
    }
}

// Function to update dashboard for current time navigator state
function updateDashboardForTime() {
    if (window.timeNavigator) {
        updateDashboard();
    }
}