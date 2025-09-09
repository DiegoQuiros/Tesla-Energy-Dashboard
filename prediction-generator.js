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

    // Get yesterday's data for solar forecasting
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    const yesterdayData = energyData.filter(point => {
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
        (latest.ThermostatIsActivelyRunning ? 5.6 : 0.9) : 0) +
        (latest.Model3IsCharging ? (latest.Model3ChargerPowerKw || 0) : 0) +
        (latest.ModelXIsCharging ? (latest.ModelXChargerPowerKw || 0) : 0);
    const houseBaseConsumption = Math.max(0, loadPower - knownConsumption);
    totalConsumptionKw += houseBaseConsumption;

    // Get current solar and grid input
    let currentSolarPowerKw = latest.SolarPowerKw || 0;
    const gridImportKw = Math.max(0, latest.GridPowerKw || 0);

    console.log(`Powerwall prediction: Starting with ${currentPowerwallKwh.toFixed(1)}kWh, Total consumption=${totalConsumptionKw.toFixed(1)}kW`);

    while (currentTime <= endOfDay) {
        predictions.labels.push(currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

        // Calculate solar forecast change based on yesterday's data
        const solarForecastDelta = getSolarForecastDelta(yesterdayData, currentTime);
        const forecastSolarPowerKw = Math.max(0, currentSolarPowerKw + solarForecastDelta);

        // Update current solar for next iteration
        currentSolarPowerKw = forecastSolarPowerKw;

        const totalEnergyInputKw = forecastSolarPowerKw + gridImportKw;

        // Net drain on Powerwall = total consumption - total energy input
        // If positive, Powerwall discharges; if negative, Powerwall charges
        const netPowerwallDrainKw = totalConsumptionKw - totalEnergyInputKw;

        // Powerwall prediction based on net energy drain
        if (netPowerwallDrainKw > 0) {
            // Powerwall is discharging to meet demand
            const energyConsumedIn15Min = netPowerwallDrainKw * 0.25; // kW * 0.25 hours = kWh
            currentPowerwallKwh = Math.max(0, currentPowerwallKwh - energyConsumedIn15Min);
        } else if (netPowerwallDrainKw < 0) {
            // Excess energy is charging the Powerwall
            let energyGainedIn15Min = Math.abs(netPowerwallDrainKw) * 0.25;

            // Add solar production forecast delta to charging calculation
            const solarEnergyDelta = solarForecastDelta * 0.25; // Convert kW to kWh for 15 minutes
            energyGainedIn15Min += solarEnergyDelta;

            currentPowerwallKwh = Math.min(BATTERY_CAPACITIES.POWERWALL, currentPowerwallKwh + energyGainedIn15Min);
        }
        // If netPowerwallDrainKw is 0, still apply solar forecast delta
        else {
            const solarEnergyDelta = solarForecastDelta * 0.25; // Convert kW to kWh for 15 minutes
            if (solarEnergyDelta > 0) {
                currentPowerwallKwh = Math.min(BATTERY_CAPACITIES.POWERWALL, currentPowerwallKwh + solarEnergyDelta);
            } else if (solarEnergyDelta < 0) {
                currentPowerwallKwh = Math.max(0, currentPowerwallKwh + solarEnergyDelta);
            }
        }

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

    // Calculate the time 15 minutes before yesterday (-24 hours - 15 minutes)
    const yesterdayTimeMinus15 = new Date(yesterdayTime);
    yesterdayTimeMinus15.setMinutes(yesterdayTimeMinus15.getMinutes() - 15);

    // Find closest data points for both times (within 5 minutes tolerance)
    const baseSolarData = findClosestDataPoint(yesterdayData, yesterdayTimeMinus15, 5);
    const futureSolarData = findClosestDataPoint(yesterdayData, yesterdayTime, 5);

    if (!baseSolarData || !futureSolarData) {
        return 0; // No matching data found
    }

    const baseSolarPower = baseSolarData.SolarPowerKw || 0;
    const futureSolarPower = futureSolarData.SolarPowerKw || 0;

    const solarDelta = futureSolarPower - baseSolarPower;

    return solarDelta;
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