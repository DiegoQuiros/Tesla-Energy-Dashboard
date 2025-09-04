
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
            thermostatPower = 0.9; // Air Wave fan running
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
