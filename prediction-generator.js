function generateBatteryPredictions(todayData) {
    if (todayData.length === 0) {
        return { labels: [], powerwall: [], model3: [], modelX: [] };
    }

    const latest = todayData[todayData.length - 1];

    // Check if simulation is active and use simulated charging settings
    let simulationSettings = null;
    if (window.batterySimulator && window.batterySimulator.isSimulationActive()) {
        simulationSettings = window.batterySimulator.getSimulationSettings();
        console.log('Using simulation settings for predictions:', simulationSettings);
    }

    // Use time navigator's current time if available, otherwise use latest data timestamp
    let now;
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        now = window.timeNavigator.getCurrentTime();
    } else {
        now = convertToPDT(latest.LocalTimestamp);
    }

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59);

    const predictions = {
        labels: [],
        powerwall: [],
        model3: [],
        modelX: []
    };

    // Get yesterday's data for solar forecasting relative to current time
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Use filtered data if in historical mode
    let dataSource = energyData;
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        dataSource = window.timeNavigator.getFilteredData();
    }

    const yesterdayData = dataSource.filter(point => {
        const pointDate = convertToPDT(point.LocalTimestamp);
        return pointDate >= yesterday && pointDate <= endOfYesterday;
    });

    // Generate 15-minute interval predictions until end of day
    let currentTime = new Date(now);
    let minutes = currentTime.getMinutes();
    let roundedMinutes = Math.floor(minutes / 15) * 15;

    if (currentTime.getSeconds() > 0 || currentTime.getMilliseconds() > 0 || minutes % 15 !== 0) {
        roundedMinutes += 15;
    }

    currentTime.setMinutes(roundedMinutes, 0, 0);

    // Convert current battery percentage to kWh for Powerwall
    let currentPowerwallKwh = ((latest.BatteryPercentage || 0) / 100) * BATTERY_CAPACITIES.POWERWALL;
    let currentModel3Level = latest.Model3Battery || 0;
    let currentModelXLevel = latest.ModelXBattery || 0;

    // Get current solar and grid input
    const gridImportKw = Math.max(0, latest.GridPowerKw || 0);

    let Model3IsCharging = latest.Model3IsCharging;
    let ModelXIsCharging = latest.ModelXIsCharging;
    let ModelXChargeAmps = latest.ModelXChargeAmps;
    let Model3ChargeAmps = latest.Model3ChargeAmps;
    let LoadPowerKw = latest.LoadPowerKw;

    while (currentTime <= endOfDay) {
        predictions.labels.push(currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

        // Calculate total power consumption rate including thermostat
        let totalConsumptionKw = 0;

        // Add thermostat consumption only if status is not OFF
        if (latest.ThermostatIsOnline && latest.ThermostatStatus && latest.ThermostatStatus !== 'OFF') {
            if (latest.ThermostatIsActivelyRunning) {
                totalConsumptionKw += 5.6; // Full AC/heating power
            } else {
                totalConsumptionKw += 0.9; // Just fan running (Air Wave)
            }
        }

        // MODEL 3 - Use simulation settings if active
        let model3ChargingPowerKw = 0;
        if (simulationSettings && simulationSettings.Model3Amps > 0) {
            // Use simulated charging
            model3ChargingPowerKw = simulationSettings.Model3Amps * 249 / 1000;
            totalConsumptionKw += model3ChargingPowerKw;
        } else if (!simulationSettings && Model3IsCharging && Model3ChargeAmps) {
            // Use actual charging with weekday 2:15 PM rule (only when simulation is not active)
            const todayTwoFifteen = new Date(currentTime);
            todayTwoFifteen.setHours(14, 15, 0, 0);

            // Weekday: Monday (1) to Friday (5)
            const isWeekday = currentTime.getDay() >= 1 && currentTime.getDay() <= 5;

            if (isWeekday && currentTime > todayTwoFifteen) {
                model3ChargingPowerKw = 0;
            } else {
                model3ChargingPowerKw = Model3ChargeAmps * 249 / 1000;
            }

            totalConsumptionKw += model3ChargingPowerKw;
        }

        // MODEL X - Use simulation settings if active
        let modelXChargingPowerKw = 0;
        if (simulationSettings && simulationSettings.ModelXAmps > 0) {
            // Use simulated charging
            modelXChargingPowerKw = simulationSettings.ModelXAmps * 249 / 1000;
            totalConsumptionKw += modelXChargingPowerKw;
        } else if (!simulationSettings && ModelXIsCharging && ModelXChargeAmps) {
            // Use actual charging (only when simulation is not active)
            modelXChargingPowerKw = ModelXChargeAmps * 249 / 1000;
            totalConsumptionKw += modelXChargingPowerKw;
        }

        // Calculate base house consumption
        const loadPower = LoadPowerKw || 0;
        const knownConsumption = (latest.ThermostatIsOnline && latest.ThermostatStatus && latest.ThermostatStatus !== 'OFF' ?
            (latest.ThermostatIsActivelyRunning ? 5.6 : 0.9) : 0) +
            model3ChargingPowerKw + modelXChargingPowerKw;
        const houseBaseConsumption = Math.max(0, loadPower - knownConsumption);
        totalConsumptionKw += houseBaseConsumption;

        // Calculate solar forecast change based on yesterday's data
        const solarForecastDelta = getSolarForecastDelta(yesterdayData, currentTime);

        const powerWallChargeRate = Math.min(5, solarForecastDelta - totalConsumptionKw + gridImportKw); // kW, typical Powerwall charge rate
        currentPowerwallKwh = currentPowerwallKwh + powerWallChargeRate * 0.25;

        currentPowerwallKwh = Math.max(0, currentPowerwallKwh);
        currentPowerwallKwh = Math.min(BATTERY_CAPACITIES.POWERWALL, currentPowerwallKwh);

        // Vehicle charging predictions with simulation support
        if (simulationSettings && simulationSettings.Model3Amps > 0) {
            // Use simulation settings for Model 3 - car is charging
            const percentageGainIn15Min = (model3ChargingPowerKw * 0.25 / BATTERY_CAPACITIES.MODEL_3) * 100;
            currentModel3Level = Math.min(latest.Model3ChargeLimit, currentModel3Level + percentageGainIn15Min);
        } else if (simulationSettings && simulationSettings.Model3Amps === 0) {
            // Simulation is active but car charging is off - keep level flat
            // currentModel3Level remains unchanged
        } else if (!simulationSettings && Model3IsCharging && model3ChargingPowerKw > 0) {
            // Use actual charging data when simulation is not active
            const percentageGainIn15Min = (model3ChargingPowerKw * 0.25 / BATTERY_CAPACITIES.MODEL_3) * 100;
            currentModel3Level = Math.min(latest.Model3ChargeLimit, currentModel3Level + percentageGainIn15Min);
        }
        if (currentModel3Level >= latest.Model3ChargeLimit && Model3IsCharging) {
            var overcharge = currentModel3Level - latest.Model3ChargeLimit;
            currentPowerwallKwh += (overcharge / 100) * BATTERY_CAPACITIES.MODEL_3;
            if (currentPowerwallKwh > BATTERY_CAPACITIES.POWERWALL)
                currentPowerwallKwh > BATTERY_CAPACITIES.POWERWALL;

            LoadPowerKw -= Model3ChargeAmps * 249 / 1000;
            if (LoadPowerKw < 0.234)
                LoadPowerKw = 0.234; // minimum load when everything is off
            Model3IsCharging = false;
            Model3ChargeAmps = 0;
            currentModel3Level = latest.Model3ChargeLimit;
        }

        if (simulationSettings && simulationSettings.ModelXAmps > 0) {
            // Use simulation settings for Model X - car is charging
            const percentageGainIn15Min = (modelXChargingPowerKw * 0.25 / BATTERY_CAPACITIES.MODEL_X) * 100;
            currentModelXLevel = Math.min(latest.ModelXChargeLimit, currentModelXLevel + percentageGainIn15Min);
        } else if (simulationSettings && simulationSettings.ModelXAmps === 0) {
            // Simulation is active but car charging is off - keep level flat
            // currentModelXLevel remains unchanged
        } else if (!simulationSettings && ModelXIsCharging && modelXChargingPowerKw > 0) {
            // Use actual charging data when simulation is not active
            const percentageGainIn15Min = (modelXChargingPowerKw * 0.25 / BATTERY_CAPACITIES.MODEL_X) * 100;
            currentModelXLevel = Math.min(latest.ModelXChargeLimit, currentModelXLevel + percentageGainIn15Min);
        }
        if (currentModelXLevel >= latest.ModelXChargeLimit && ModelXIsCharging) {
            var overcharge = currentModelXLevel - latest.ModelXChargeLimit;
            currentPowerwallKwh += (overcharge / 100) * BATTERY_CAPACITIES.MODEL_X;
            if (currentPowerwallKwh > BATTERY_CAPACITIES.POWERWALL)
                currentPowerwallKwh > BATTERY_CAPACITIES.POWERWALL;

            LoadPowerKw -= ModelXChargeAmps * 249 / 1000;
            if (LoadPowerKw < 0.234)
                LoadPowerKw = 0.234; // minimum load when everything is off
            ModelXIsCharging = false;
            ModelXChargeAmps = 0;
            currentModelXLevel = latest.ModelXChargeLimit;
        }

        // Convert kWh back to percentage
        const powerwallPercentage = (currentPowerwallKwh / BATTERY_CAPACITIES.POWERWALL) * 100;

        predictions.powerwall.push(powerwallPercentage);
        predictions.model3.push(latest.Model3IsAvailable ? currentModel3Level : null);
        predictions.modelX.push(latest.ModelXIsAvailable ? currentModelXLevel : null);

        // Move to next 15-minute interval
        currentTime.setMinutes(currentTime.getMinutes() + 15);
    }

    return predictions;
}

/**
 * Gets the solar production delta based on yesterday's data at the same time
 * @param {Array} yesterdayData - Array of yesterday's energy data points
 * @param {Date} currentTime - Current prediction time
 * @returns {number} Solar power delta in kW
 */
function getSolarForecastDelta(yesterdayData, currentTime) {
    if (yesterdayData.length === 0) {
        return 0;
    }

    // Calculate the equivalent time yesterday (-24 hours)
    const yesterdayTime = new Date(currentTime);
    yesterdayTime.setDate(yesterdayTime.getDate() - 1);

    // Find closest data points for both times (within 5 minutes tolerance)
    const futureSolarData = findClosestDataPoint(yesterdayData, yesterdayTime, 5);

    if (!futureSolarData) {
        return 0; // No matching data found
    }

    return futureSolarData.SolarPowerKw;
}

/**
 * Finds the closest data point to a target time within a tolerance
 * @param {Array} dataPoints - Array of energy data points
 * @param {Date} targetTime - Target time to search for
 * @param {number} toleranceMinutes - Maximum allowed time difference in minutes
 * @returns {Object|null} Closest data point or null if none found within tolerance
 */
function findClosestDataPoint(dataPoints, targetTime, toleranceMinutes = 5) {
    let closestPoint = null;
    let closestDifference = Infinity;

    for (const point of dataPoints) {
        const pointTime = convertToPDT(point.LocalTimestamp);
        const timeDifference = Math.abs(pointTime.getTime() - targetTime.getTime());
        const timeDifferenceMinutes = timeDifference / (1000 * 60);

        if (timeDifferenceMinutes <= toleranceMinutes && timeDifference < closestDifference) {
            closestDifference = timeDifference;
            closestPoint = point;
        }
    }

    return closestPoint;
}