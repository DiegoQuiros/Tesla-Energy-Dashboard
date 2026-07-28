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

// Fetch the unified controller's published plan — its projection of the day (forecast
// series) and of its own upcoming actions. The dashboard RENDERS this; it does not
// recompute anything (there is exactly one implementation of the forecast and the rules,
// in C#, so the charts cannot disagree with the automation). Never throws: without the
// blob the charts simply show measured data with no forecast or markers.
// (The old charge-automation-state.json fetch is gone with the JS decision layer — that
// blob has been frozen since the unified controller replaced the legacy automation.)
async function fetchAutomationPlan() {
    try {
        const response = await fetch(`${AUTOMATION_PLAN_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.warn('Automation plan unavailable (chart shows no start/stop markers):', error.message);
        return null;
    }
}

async function loadEnergyData() {
    try {
        console.log('Loading energy data from:', AZURE_BLOB_URL);

        const [data, summary, automationPlan] = await Promise.all([
            fetchEnergyData(), fetchDailySummary(), fetchAutomationPlan()]);
        dailySummaryData = summary;
        // Keep the last good plan on a transient fetch failure so the forecast
        // doesn't blink off for a cycle (the fetch races the collector's upload)
        if (automationPlan) window.automationPlan = automationPlan;

        energyData = data.sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));

        console.log(`Loaded ${energyData.length} data points`);

        if (energyData.length === 0) {
            throw new Error('No data available');
        }

        // Store the timestamp of the latest data. Scheduling the next refresh is
        // refreshData()'s job in main.js — a single timer owns the whole cycle.
        const previousTimestamp = lastDataTimestamp;
        lastDataTimestamp = convertToPDT(energyData[energyData.length - 1].LocalTimestamp);

        // Clear any error banner left over from a previous failed refresh
        document.getElementById('error').style.display = 'none';

        updateDashboard();

        // Refresh the Automation Log / Alerts cards on the same cycle so newly
        // logged actions appear without the user reloading the page. Fire and
        // forget — it renders itself and never throws (fetch errors are caught).
        // Unforced, so it no-ops against the page-load fetch a moment earlier.
        if (typeof window.loadAutomationLog === 'function') {
            window.loadAutomationLog();
        }

        // Re-draw the charts only when the payload actually advanced. A poll that
        // races the collector returns the SAME sample, and re-animating the charts
        // against it reads as an update while the timestamp label written just
        // above doesn't move — the chart and the label must always show the same
        // cycle. (First load has no previous timestamp, so it always renders.)
        if (previousTimestamp && lastDataTimestamp.getTime() === previousTimestamp.getTime()) {
            console.log('No new sample — leaving charts as they are');
            return true;
        }

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

        // Only stay silent when a dashboard is already on screen (a background
        // refresh failed — keep the last good data and retry next cycle). If the
        // dashboard was never revealed, showing nothing leaves a blank/black page,
        // so surface the error instead.
        const dashboardEl = document.getElementById('dashboard');
        const dashboardVisible = dashboardEl && dashboardEl.style.display === 'block';
        if (dashboardVisible && energyData.length > 0) {
            console.warn('Refresh failed, keeping previously loaded data');
        } else {
            const errorEl = document.getElementById('error');
            const errorMsgEl = document.getElementById('errorMessage');
            if (errorEl) errorEl.style.display = 'block';
            if (errorMsgEl) errorMsgEl.textContent = error.message;
        }
        return false;
    }
}

// Null-safe text setter. updateDashboard() runs BEFORE the dashboard is revealed,
// so a single missing element must never throw and abort the whole render — that
// leaves the page blank (loading hidden, dashboard still hidden): the "black
// screen" seen when a browser is still holding a cached index.html that predates
// a newly deployed field (e.g. #powerwallStatus). Skip the missing one instead.
function setFieldText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
    else console.warn(`Dashboard element #${id} not found (stale cached markup?) — skipping`);
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
    setFieldText('lastUpdated', timestampText);

    // Update energy flow display
    updateEnergyFlowCharts(latest);

    // Update weather
    setFieldText('weatherTemp', `${latest.WeatherTemperatureF || '--'}°F`);
    setFieldText('weatherCondition', latest.WeatherConditions || 'Unknown');
    setFieldText('weatherHumidity', `${latest.WeatherHumidity || '--'}%`);
    setFieldText('weatherSolarImpact', latest.WeatherSolarImpact ? `${(latest.WeatherSolarImpact * 100).toFixed(0)}%` : '--');

    // Update Powerwall
    const batteryPercent = latest.BatteryPercentage || 0;
    setFieldText('powerwallPercent', `${batteryPercent.toFixed(1)}%`);
    setFieldText('powerwallKwh', `${calculateBatteryKwh(batteryPercent, BATTERY_CAPACITIES.POWERWALL)} kWh`);
    const powerwallBar = document.getElementById('powerwallBar');
    if (powerwallBar) powerwallBar.style.width = `${batteryPercent}%`;
    const powerwallPowerKw = latest.BatteryPowerKw || 0; // - charging, + discharging
    setFieldText('powerwallStatus',
        powerwallPowerKw < -0.05 ? 'Charging' : powerwallPowerKw > 0.05 ? 'Discharging' : 'Idle');

    updateVehicleCard('Model3', 'model3', latest, now, BATTERY_CAPACITIES.MODEL_3);
    updateVehicleCard('ModelX', 'modelX', latest, now, BATTERY_CAPACITIES.MODEL_X);

    // Show dashboard
    document.getElementById('loading').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';

    // Fit the energy-flow scene to its container now that it has a measurable width
    if (typeof scaleFlowStage === 'function') scaleFlowStage();
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

    // Check if all required elements exist
    if (!percentElement || !kwhElement || !barElement || !statusElement || !rangeElement) {
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

        // Prefer rated range (battery_range) to match the Tesla app; the Model 3 no
        // longer reports est_battery_range (always 0). Fall back for older data.
        const rangeMiles = dataToUse[`${vehiclePrefix}BatteryRange`] || dataToUse[`${vehiclePrefix}EstimatedRangeMiles`] || 0;
        rangeElement.textContent = `${Math.round(rangeMiles)} miles`;

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
    }
}

// Function to update dashboard for current time navigator state
function updateDashboardForTime() {
    if (window.timeNavigator) {
        updateDashboard();
    }
}