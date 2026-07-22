// Fetch the energy data blob, retrying on transient failures
// (e.g. empty/partial JSON when the fetch races the collector's upload)
async function fetchEnergyData(attempts = 3, retryDelayMs = 5000) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
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

            return data;
        } catch (error) {
            lastError = error;
            console.warn(`Energy data fetch attempt ${attempt}/${attempts} failed:`, error.message);
            if (attempt < attempts) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
        }
    }
    throw lastError;
}

// Fetch the daily summary blob. Never throws: the dashboard must still work
// (falling back to the raw data window) if the summary is missing.
async function fetchDailySummary() {
    try {
        const response = await fetch(`${DAILY_SUMMARY_URL}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.warn('Daily summary unavailable (chart falls back to raw window):', error.message);
        return [];
    }
}

// Fetch the charge automation's persisted state (per-car cooldowns and failed
// command attempts) so the battery chart can warn when the automation needed to
// stop a charge but couldn't. Never throws: the warning simply stays silent on
// the blocked-automation cases when the blob is unavailable.
async function fetchChargeAutomationState() {
    try {
        const response = await fetch(`${CHARGE_AUTOMATION_STATE_URL}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.warn('Charge automation state unavailable (automation warnings limited):', error.message);
        return null;
    }
}

async function loadEnergyData() {
    try {
        console.log('Loading energy data from:', AZURE_BLOB_URL);

        const [data, summary, automationState] = await Promise.all([
            fetchEnergyData(), fetchDailySummary(), fetchChargeAutomationState()]);
        dailySummaryData = summary;
        // Keep the last good automation state on a transient fetch failure so a
        // critical "stop the charge manually" banner doesn't flap off for a full
        // refresh cycle (the fetch races the collector's 15-min blob upload)
        if (automationState) window.chargeAutomationState = automationState;

        energyData = data.sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));

        console.log(`Loaded ${energyData.length} data points`);

        if (energyData.length === 0) {
            throw new Error('No data available');
        }

        // Store the timestamp of the latest data
        lastDataTimestamp = convertToPDT(energyData[energyData.length - 1].LocalTimestamp);

        scheduleSmartRefresh();

        // Clear any error banner left over from a previous failed refresh
        document.getElementById('error').style.display = 'none';

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

        return true;

    } catch (error) {
        console.error('Error loading energy data:', error);
        document.getElementById('loading').style.display = 'none';

        if (energyData.length > 0) {
            // We still have data from a previous load - keep showing it
            // and let the next scheduled refresh try again
            console.warn('Refresh failed, keeping previously loaded data');
        } else {
            document.getElementById('error').style.display = 'block';
            document.getElementById('errorMessage').textContent = error.message;
        }
        return false;
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

    // Update Powerwall
    const batteryPercent = latest.BatteryPercentage || 0;
    document.getElementById('powerwallPercent').textContent = `${batteryPercent.toFixed(1)}%`;
    document.getElementById('powerwallKwh').textContent = `${calculateBatteryKwh(batteryPercent, BATTERY_CAPACITIES.POWERWALL)} kWh`;
    document.getElementById('powerwallBar').style.width = `${batteryPercent}%`;

    // Add stale info for Powerwall
    const powerwallAge = formatTimeDifference(lastUpdated, now);
    const powerwallStaleInfo = document.getElementById('powerwallStaleInfo');
    powerwallStaleInfo.textContent = powerwallAge;
    powerwallStaleInfo.style.display = 'block';

    updateVehicleCard('Model3', 'model3', latest, now, BATTERY_CAPACITIES.MODEL_3);
    updateVehicleCard('ModelX', 'modelX', latest, now, BATTERY_CAPACITIES.MODEL_X);

    // Show dashboard
    document.getElementById('loading').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
}

function updateVehicleCard(vehiclePrefix, cardPrefix, latest, currentTime, batteryCapacity) {
    const cardElement = document.getElementById(`${cardPrefix}Card`);
    const percentElement = document.getElementById(`${cardPrefix}Percent`);
    const kwhElement = document.getElementById(`${cardPrefix}Kwh`);
    const barElement = document.getElementById(`${cardPrefix}Bar`);
    const limitElement = document.getElementById(`${cardPrefix}Limit`);
    const statusElement = document.getElementById(`${cardPrefix}Status`);
    const rangeElement = document.getElementById(`${cardPrefix}Range`);
    const chargingRateElement = document.getElementById(`${cardPrefix}ChargingRate`);
    const staleInfoElement = document.getElementById(`${cardPrefix}StaleInfo`);
    const connectorElement = document.getElementById(`${cardPrefix}Connector`);

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
        barElement.style.width = `${batteryPercent}%`;

        if (limitElement) {
            const chargeLimit = dataToUse[`${vehiclePrefix}ChargeLimit`] || 0;
            if (chargeLimit > 0) {
                limitElement.style.left = `${chargeLimit}%`;
                limitElement.style.display = 'block';
                limitElement.title = `Charge limit: ${chargeLimit}%`;
            } else {
                limitElement.style.display = 'none';
            }
        }

        if (latest[`${vehiclePrefix}IsAvailable`]) {
            statusElement.textContent = dataToUse[`${vehiclePrefix}ChargingState`] || 'Unknown';
        } else {
            statusElement.textContent = 'Offline';
        }

        rangeElement.textContent = `${Math.round(dataToUse[`${vehiclePrefix}EstimatedRangeMiles`] || 0)} mi`;

        if (chargingRateElement) {
            if (dataToUse[`${vehiclePrefix}IsCharging`] && latest[`${vehiclePrefix}IsAvailable`]) {
                // ChargeAmps is the requested limit, not what's flowing; use measured current/voltage
                const actualCurrent = dataToUse[`${vehiclePrefix}ChargerActualCurrent`] || 0;
                const voltage = dataToUse[`${vehiclePrefix}ChargerVoltage`] || 0;
                const powerKw = (actualCurrent > 0 && voltage > 100)
                    ? (actualCurrent * voltage) / 1000
                    : (dataToUse[`${vehiclePrefix}ChargerPowerKw`] || 0);
                const amps = (actualCurrent > 0 && voltage > 100)
                    ? actualCurrent
                    : Math.round((powerKw * 1000) / 240);
                chargingRateElement.textContent = `${powerKw.toFixed(1)} kW • ${amps}A`;
            } else {
                chargingRateElement.textContent = '-- kW';
            }
        }
        else
            console.warn(`Charging rate element not found for ${cardPrefix}`);

        if (connectorElement) {
            // Tesla reports 'Disconnected' when unplugged; any other state means the cable is in
            const chargingState = dataToUse[`${vehiclePrefix}ChargingState`];
            const isPlugged = latest[`${vehiclePrefix}IsAvailable`]
                && chargingState && chargingState !== 'Disconnected';
            const isCharging = isPlugged && dataToUse[`${vehiclePrefix}IsCharging`];
            connectorElement.classList.toggle('plugged', !!isPlugged);
            connectorElement.classList.toggle('charging', !!isCharging);
            connectorElement.title = isCharging ? 'Charging'
                : isPlugged ? 'Plugged in'
                : 'Not plugged in';
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
        if (chargingRateElement) {
            chargingRateElement.textContent = '-- kW';
        }
        else
            console.warn(`Charging rate element not found for ${cardPrefix}`);

        if (connectorElement) {
            connectorElement.classList.remove('plugged', 'charging');
            connectorElement.title = 'Not plugged in';
        }

        staleInfoElement.style.display = 'none';
    }
}

// Function to update dashboard for current time navigator state
function updateDashboardForTime() {
    if (window.timeNavigator) {
        updateDashboard();
    }
}