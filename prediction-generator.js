// Prediction tuning constants (validated by backtest against ~80 days of collected data)
const PREDICTION_CONFIG = {
    PROFILE_DAYS: 7,            // prior days used to build solar/load profiles
    SLOTS_PER_DAY: 96,          // 15-minute slots in a day
    MAX_POWERWALL_RATE_KW: 5,   // Powerwall max charge/discharge rate
    LOAD_BLEND_MINUTES: 120,    // fade from live measured load into the historical profile
    RECENT_LOAD_MINUTES: 45,    // window for smoothing the current house load
    GRID_DECAY_MINUTES: 60,     // fade out the current grid import (snapshot only describes right now)
    SOLAR_SCALE_WINDOW_HOURS: 3,// window of today's solar used to estimate weather vs profile
    SESSION_GAP_MINUTES: 40,    // gap that splits two EV charging sessions
    MODEL3_FALLBACK_REMAINING_MINUTES: 60,
    MODELX_FALLBACK_REMAINING_MINUTES: 120
};

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

    // Use filtered data if in historical mode
    let dataSource = energyData;
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        dataSource = window.timeNavigator.getFilteredData();
    }

    // Historical per-15-min-slot profiles for solar production and house load,
    // plus a weather factor comparing today's recent solar against the profile
    const profiles = buildDailyProfiles(dataSource, now);
    const solarScale = computeSolarScale(todayData, profiles.solar, now);
    const recentBaseLoad = computeRecentBaseLoad(todayData, now);

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

    const gridImportKw = Math.max(0, latest.GridPowerKw || 0);

    let Model3IsCharging = latest.Model3IsCharging;
    let ModelXIsCharging = latest.ModelXIsCharging;
    const model3ActualChargingKw = homeChargingPowerKw(latest, 'Model3');
    const modelXActualChargingKw = homeChargingPowerKw(latest, 'ModelX');

    // In-progress charging sessions rarely run until the charge limit; estimate when
    // they will actually stop from how long past sessions lasted. Not applied while
    // simulating, since the user is explicitly asking "what if the car keeps charging".
    let model3StopTime = null;
    let modelXStopTime = null;
    if (!simulationSettings) {
        if (Model3IsCharging) {
            model3StopTime = estimateChargingStopTime(dataSource, todayData, 'Model3', now,
                PREDICTION_CONFIG.MODEL3_FALLBACK_REMAINING_MINUTES);
        }
        if (ModelXIsCharging) {
            modelXStopTime = estimateChargingStopTime(dataSource, todayData, 'ModelX', now,
                PREDICTION_CONFIG.MODELX_FALLBACK_REMAINING_MINUTES);
        }
    }

    while (currentTime <= endOfDay) {
        predictions.labels.push(currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

        const minutesFromNow = (currentTime - now) / (1000 * 60);
        const slot = timeSlotIndex(currentTime);

        // MODEL 3 charging power
        let model3ChargingPowerKw = 0;
        if (simulationSettings && simulationSettings.Model3Amps > 0) {
            model3ChargingPowerKw = simulationSettings.Model3Amps * 249 / 1000;
        } else if (!simulationSettings && Model3IsCharging && model3ActualChargingKw > 0) {
            // Weekday 2:15 PM rule: Model 3 charging stops at 2:15 PM on weekdays
            const todayTwoFifteen = new Date(currentTime);
            todayTwoFifteen.setHours(14, 15, 0, 0);
            const isWeekday = currentTime.getDay() >= 1 && currentTime.getDay() <= 5;

            if (isWeekday && currentTime > todayTwoFifteen) {
                model3ChargingPowerKw = 0;
            } else if (model3StopTime && currentTime > model3StopTime) {
                model3ChargingPowerKw = 0;
            } else {
                model3ChargingPowerKw = model3ActualChargingKw;
            }
        }

        // MODEL X charging power
        let modelXChargingPowerKw = 0;
        if (simulationSettings && simulationSettings.ModelXAmps > 0) {
            modelXChargingPowerKw = simulationSettings.ModelXAmps * 249 / 1000;
        } else if (!simulationSettings && ModelXIsCharging && modelXActualChargingKw > 0) {
            if (modelXStopTime && currentTime > modelXStopTime) {
                modelXChargingPowerKw = 0;
            } else {
                modelXChargingPowerKw = modelXActualChargingKw;
            }
        }

        // Cap EV power by what the car actually needs to reach its charge limit,
        // then advance the car's battery level
        if (model3ChargingPowerKw > 0 && latest.Model3ChargeLimit > 0) {
            const neededKwh = Math.max(0, (latest.Model3ChargeLimit - currentModel3Level) / 100 * BATTERY_CAPACITIES.MODEL_3);
            model3ChargingPowerKw = Math.min(model3ChargingPowerKw, neededKwh / 0.25);
        }
        if (model3ChargingPowerKw > 0) {
            const percentageGain = (model3ChargingPowerKw * 0.25 / BATTERY_CAPACITIES.MODEL_3) * 100;
            currentModel3Level = Math.min(latest.Model3ChargeLimit || 100, currentModel3Level + percentageGain);
            if (latest.Model3ChargeLimit > 0 && currentModel3Level >= latest.Model3ChargeLimit) {
                Model3IsCharging = false;
            }
        }

        if (modelXChargingPowerKw > 0 && latest.ModelXChargeLimit > 0) {
            const neededKwh = Math.max(0, (latest.ModelXChargeLimit - currentModelXLevel) / 100 * BATTERY_CAPACITIES.MODEL_X);
            modelXChargingPowerKw = Math.min(modelXChargingPowerKw, neededKwh / 0.25);
        }
        if (modelXChargingPowerKw > 0) {
            const percentageGain = (modelXChargingPowerKw * 0.25 / BATTERY_CAPACITIES.MODEL_X) * 100;
            currentModelXLevel = Math.min(latest.ModelXChargeLimit || 100, currentModelXLevel + percentageGain);
            if (latest.ModelXChargeLimit > 0 && currentModelXLevel >= latest.ModelXChargeLimit) {
                ModelXIsCharging = false;
            }
        }

        // House load: blend the live smoothed load into the historical profile so a
        // momentary spike/lull right now doesn't get extrapolated for hours
        const blendWeight = Math.max(0, 1 - minutesFromNow / PREDICTION_CONFIG.LOAD_BLEND_MINUTES);
        const houseLoadKw = blendWeight * recentBaseLoad + (1 - blendWeight) * profiles.load[slot];

        // Solar: historical profile shape scaled by today's weather
        const solarKw = profiles.solar[slot] * solarScale;

        // Grid import credit fades out — the snapshot only describes right now
        const gridCreditKw = gridImportKw * Math.max(0, 1 - minutesFromNow / PREDICTION_CONFIG.GRID_DECAY_MINUTES);

        const netKw = solarKw - houseLoadKw - model3ChargingPowerKw - modelXChargingPowerKw + gridCreditKw;
        const rateKw = Math.min(PREDICTION_CONFIG.MAX_POWERWALL_RATE_KW,
            Math.max(-PREDICTION_CONFIG.MAX_POWERWALL_RATE_KW, netKw));
        currentPowerwallKwh = Math.min(BATTERY_CAPACITIES.POWERWALL,
            Math.max(0, currentPowerwallKwh + rateKw * 0.25));

        predictions.powerwall.push((currentPowerwallKwh / BATTERY_CAPACITIES.POWERWALL) * 100);
        predictions.model3.push(latest.Model3IsAvailable ? currentModel3Level : null);
        predictions.modelX.push(latest.ModelXIsAvailable ? currentModelXLevel : null);

        // Move to next 15-minute interval
        currentTime.setMinutes(currentTime.getMinutes() + 15);
    }

    return predictions;
}

/**
 * Index of a date's 15-minute slot within the day (0-95)
 */
function timeSlotIndex(date) {
    return date.getHours() * 4 + Math.floor(date.getMinutes() / 15);
}

function medianValue(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function meanValue(values) {
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Builds per-15-min-slot profiles from the previous PROFILE_DAYS days:
 * - solar: median solar production per slot (median rejects one-off cloudy/clear outliers)
 * - load: mean house load per slot with EV charging removed (mean keeps evening peaks)
 * @param {Array} dataSource - Full energy data history
 * @param {Date} now - Current prediction time
 * @returns {{solar: number[], load: number[]}}
 */
function buildDailyProfiles(dataSource, now) {
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - PREDICTION_CONFIG.PROFILE_DAYS);
    windowStart.setHours(0, 0, 0, 0);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const slots = PREDICTION_CONFIG.SLOTS_PER_DAY;
    const solarBySlot = Array.from({ length: slots }, () => []);
    const loadBySlot = Array.from({ length: slots }, () => []);

    for (const point of dataSource) {
        const pointDate = convertToPDT(point.LocalTimestamp);
        if (pointDate < windowStart || pointDate >= todayStart) continue;
        const slot = timeSlotIndex(pointDate);
        const evKw = homeChargingPowerKw(point, 'Model3') + homeChargingPowerKw(point, 'ModelX');
        solarBySlot[slot].push(point.SolarPowerKw || 0);
        loadBySlot[slot].push(Math.max(0, (point.LoadPowerKw || 0) - evKw));
    }

    const solar = new Array(slots).fill(null);
    const load = new Array(slots).fill(null);
    for (let s = 0; s < slots; s++) {
        if (solarBySlot[s].length > 0) solar[s] = medianValue(solarBySlot[s]);
        if (loadBySlot[s].length > 0) load[s] = meanValue(loadBySlot[s]);
    }

    // Fill slots with no historical samples from the nearest populated slot
    for (let s = 0; s < slots; s++) {
        if (solar[s] === null || load[s] === null) {
            for (let d = 1; d < slots; d++) {
                const before = (s - d + slots) % slots;
                const after = (s + d) % slots;
                if (solar[s] === null && solar[before] !== null) solar[s] = solar[before];
                if (solar[s] === null && solar[after] !== null) solar[s] = solar[after];
                if (load[s] === null && load[before] !== null) load[s] = load[before];
                if (load[s] === null && load[after] !== null) load[s] = load[after];
                if (solar[s] !== null && load[s] !== null) break;
            }
            if (solar[s] === null) solar[s] = 0;
            if (load[s] === null) load[s] = 0.5;
        }
    }

    return { solar, load };
}

/**
 * Compares today's recent solar production against the historical profile to get
 * a weather scaling factor for the rest of the day (cloudy day -> < 1, clear -> ~1).
 * @returns {number} Scale factor, clamped to 0.3 - 1.6
 */
function computeSolarScale(todayData, profileSolar, now) {
    const windowStart = new Date(now.getTime() - PREDICTION_CONFIG.SOLAR_SCALE_WINDOW_HOURS * 3600 * 1000);
    let todaySum = 0;
    let profileSum = 0;
    for (const point of todayData) {
        const pointDate = convertToPDT(point.LocalTimestamp);
        if (pointDate < windowStart) continue;
        const expected = profileSolar[timeSlotIndex(pointDate)];
        if (expected > 0.15) {
            todaySum += point.SolarPowerKw || 0;
            profileSum += expected;
        }
    }
    if (profileSum < 1) return 1; // not enough daylight in the window to judge
    return Math.min(1.6, Math.max(0.3, todaySum / profileSum));
}

/**
 * Smoothed current house load (EV charging excluded): average over the last
 * RECENT_LOAD_MINUTES so a single spike doesn't get extrapolated.
 */
function computeRecentBaseLoad(todayData, now) {
    const cutoff = new Date(now.getTime() - PREDICTION_CONFIG.RECENT_LOAD_MINUTES * 60 * 1000);
    let sum = 0;
    let count = 0;
    for (const point of todayData) {
        const pointDate = convertToPDT(point.LocalTimestamp);
        if (pointDate >= cutoff && pointDate <= now) {
            const evKw = homeChargingPowerKw(point, 'Model3') + homeChargingPowerKw(point, 'ModelX');
            sum += Math.max(0, (point.LoadPowerKw || 0) - evKw);
            count++;
        }
    }
    if (count === 0) {
        const latest = todayData[todayData.length - 1];
        const evKw = homeChargingPowerKw(latest, 'Model3') + homeChargingPowerKw(latest, 'ModelX');
        return Math.max(0, (latest.LoadPowerKw || 0) - evKw);
    }
    return sum / count;
}

/**
 * Power an EV charger is actually drawing from the house right now, in kW.
 * ChargeAmps is the requested current limit, not what's flowing (e.g. solar-limited
 * charging runs below it), so use measured current × voltage. Voltage can read
 * 0/1/2 while the charger ramps up; fall back to the integer ChargerPowerKw then.
 * A DC fast charger (Supercharger) draws nothing from the house.
 * @param {Object} point - Energy data point
 * @param {string} carPrefix - 'Model3' or 'ModelX'
 * @returns {number} Charging power in kW (0 when not charging at home)
 */
function homeChargingPowerKw(point, carPrefix) {
    if (point[carPrefix + 'FastChargerPresent']) return 0;
    const current = point[carPrefix + 'ChargerActualCurrent'] || 0;
    const voltage = point[carPrefix + 'ChargerVoltage'] || 0;
    if (current > 0 && voltage > 100) {
        return current * voltage / 1000;
    }
    return point[carPrefix + 'ChargerPowerKw'] || 0;
}

/**
 * Estimates when an in-progress EV charging session will stop, based on how long
 * past sessions lasted (median remaining time given the current session's elapsed time).
 * @param {Array} dataSource - Full energy data history
 * @param {Array} todayData - Today's data (used to find the current session's start)
 * @param {string} carPrefix - 'Model3' or 'ModelX'
 * @param {Date} now - Current prediction time
 * @param {number} fallbackMinutes - Remaining time to assume when there is too little history
 * @returns {Date} Estimated stop time
 */
function estimateChargingStopTime(dataSource, todayData, carPrefix, now, fallbackMinutes) {
    const gapMs = PREDICTION_CONFIG.SESSION_GAP_MINUTES * 60 * 1000;
    const powerField = carPrefix + 'ChargerPowerKw';

    // Durations of completed past sessions
    const durations = [];
    let sessionStart = null;
    let sessionEnd = null;
    for (const point of dataSource) {
        const pointDate = convertToPDT(point.LocalTimestamp);
        if (pointDate >= now) break;
        if ((point[powerField] || 0) > 1) {
            if (sessionStart === null) sessionStart = pointDate;
            sessionEnd = pointDate;
        } else if (sessionStart !== null && (pointDate - sessionEnd) > gapMs) {
            durations.push((sessionEnd - sessionStart) / 60000 + 7.5); // + half a sample interval
            sessionStart = null;
        }
    }

    // Elapsed time of the current session
    let currentStart = null;
    let prev = null;
    for (const point of todayData) {
        if ((point[powerField] || 0) > 1) {
            const pointDate = convertToPDT(point.LocalTimestamp);
            if (currentStart === null || (prev && (pointDate - prev) > gapMs)) currentStart = pointDate;
            prev = pointDate;
        }
    }
    const elapsedMinutes = currentStart === null ? 0 : (now - currentStart) / 60000;

    const remaining = durations.filter(d => d > elapsedMinutes).map(d => d - elapsedMinutes);
    const remainingMinutes = remaining.length >= 4 ? medianValue(remaining) : fallbackMinutes;
    return new Date(now.getTime() + remainingMinutes * 60000);
}
