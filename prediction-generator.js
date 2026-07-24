// Prediction tuning constants — single source of truth in shared-config.js
// (shared with the C# charge automation's port of this prediction)
const PREDICTION_CONFIG = SHARED_CONFIG.PREDICTION_CONFIG;
const CHARGE_AUTOMATION = SHARED_CONFIG.CHARGE_AUTOMATION;

function generateBatteryPredictions(todayData) {
    if (todayData.length === 0) {
        return { labels: [], powerwall: [], model3: [], modelX: [], times: [], solar: [], houseLoad: [], deliverableSolar: [], events: [], warning: null };
    }

    const ctx = buildPredictionContext(todayData);

    // Mirror the ChargeAutomationManager's decisions (auto-start in the morning,
    // latest-safe auto-stop in the afternoon) so the forecast shows what the
    // automation will actually do — not a session running unmanaged to the car's
    // limit. Skipped while simulating: the user controls the chargers then.
    const overrides = ctx.simulationSettings ? {} : decideAutomationOverrides(ctx);

    const result = simulateDay(ctx, overrides);

    // Predicted automation commands, for the chart's vertical marker lines.
    // index = position within the prediction arrays (first slot at/after the event)
    const events = [];
    if (overrides.start) {
        events.push({ type: 'start', car: overrides.start.key, time: overrides.start.at });
    }
    for (const car of Object.keys(overrides.stops || {})) {
        events.push({ type: 'stop', car, time: overrides.stops[car] });
    }
    for (const event of events) {
        event.index = result.times.findIndex(t => t >= event.time);
    }
    const visibleEvents = events.filter(e => e.index >= 0).sort((a, b) => a.time - b.time);

    return {
        labels: result.labels,
        powerwall: result.powerwall,
        model3: result.model3,
        modelX: result.modelX,
        times: result.times,
        solar: result.solar,
        houseLoad: result.houseLoad,
        deliverableSolar: result.deliverableSolar,
        events: visibleEvents,
        // Live automation health: set when a charging car endangers the
        // 100%-by-crossover goal and the automation can't (or can no longer) fix it
        warning: assessAutomationWarning(ctx, overrides)
    };
}

/**
 * Health check for the live charge automation, shown as a banner on the battery
 * chart. Fires only when a car is charging at home right now AND the Powerwall
 * is predicted to miss 100% by the solar/load crossover with the car charging.
 * The blocked/failed cases mirror ChargeAutomationManager's guards, judged
 * against its persisted state blob (window.chargeAutomationState):
 *  - the automation already tried to stop the car today and the command failed
 *  - a stop is due now but the car's auto-stop is inside its cooldown window
 *  - 100% is out of reach even if the car stops right now (model verdict, no
 *    blob needed)
 * Returns { severity: 'critical'|'caution', message } or null when healthy.
 */
function assessAutomationWarning(ctx, overrides) {
    // SUPERSEDED 2026-07-23: the unified controller replaced the old start/stop logic this
    // used to mirror, and its state now lives in unified-controller-state.json /
    // automation-log.json (this read the frozen charge-automation-state.json). The battery
    // banner is now driven by automation-log.js from the log's FAIL entries, so this always
    // returns null. Kept as a stub so the predictions object shape is unchanged.
    return null;

    // eslint-disable-next-line no-unreachable
    let chargingCar = null;
    for (const key of ['Model3', 'ModelX']) {
        if (ctx.latest[key + 'IsAvailable'] && ctx.latest[key + 'IsCharging'] &&
            !ctx.latest[key + 'FastChargerPresent'] && ctx.actualKw[key] > 0) {
            chargingCar = key;
            break;
        }
    }
    if (!chargingCar) return null;

    // Same continue-vs-stop-now sims the automation runs (potential-solar mode)
    const base = {
        usePotentialSolar: true,
        applyModel3WeekdayStop: overrides.applyModel3WeekdayStop,
        start: overrides.start || null,
        stops: Object.assign({}, overrides.stops)
    };
    delete base.stops[chargingCar];
    const continueForecast = simulateDay(ctx, base);
    if (powerwallFullAtCrossover(continueForecast)) return null; // goal safe even with the car charging

    // After the day's produced-solar/house-load crossover there is nothing left
    // to protect — the Powerwall only declines until tomorrow and the automation
    // deliberately leaves evening charging alone (0pp improvement). Without this
    // gate every evening/night home charge would show a pointless warning.
    if (!continueForecast.solarLoadCrossover) return null;

    const stopNowForecast = simulateDay(ctx, Object.assign({}, base, {
        stops: Object.assign({}, base.stops, { [chargingCar]: ctx.now })
    }));
    // Near-full tier (mirrors decideStopTime): when the pack ends essentially full but
    // not a reachable 100% (STOP_NEAR_FULL_PERCENT ≤ level < 100%), the automation
    // deliberately lets the car keep soaking surplus and does not chase the last ~% —
    // there is no protective stop due, so no warning. A reachable 100% (level ≥ 99.5)
    // still falls through so a blocked/failed stop that would cost it is surfaced.
    const stopNowLevel = stopNowForecast.powerwallAtCrossover || 0;
    if (stopNowLevel >= CHARGE_AUTOMATION.STOP_NEAR_FULL_PERCENT && !powerwallFullAtCrossover(stopNowForecast)) return null;
    const goalLost = !powerwallFullAtCrossover(stopNowForecast);
    const carName = chargingCar === 'Model3' ? 'Model 3' : 'Model X';
    // Report the level AT the crossover (going into the night), not the day's
    // midday peak — on a drains-after-noon day the peak reads a reassuring ~100%
    // while the pack actually ends the solar day far lower.
    const endPct = stopNowForecast.powerwallAtCrossover != null
        ? stopNowForecast.powerwallAtCrossover : stopNowForecast.peakPercent;
    const peakText = ` The Powerwall is predicted to end the solar day at ~${endPct.toFixed(0)}%.`;

    const vehicleState = window.chargeAutomationState ? window.chargeAutomationState[chargingCar] : null;
    if (vehicleState) {
        // Cooldown block: a stop is due within the automation's 20-min lookahead,
        // but this car was already auto-stopped inside the cooldown window (the
        // charge running again means a person restarted it — the automation
        // honors that and will not stop it again yet)
        const cooldownMs = CHARGE_AUTOMATION.ACTION_COOLDOWN_HOURS * 3600 * 1000;
        const lastStopMs = Date.parse(vehicleState.LastStopUtc || '');
        const sinceStopMs = Date.now() - lastStopMs;
        const plannedStop = overrides.stops && overrides.stops[chargingCar];
        const stopDueSoon = plannedStop && (plannedStop.getTime() - ctx.now.getTime()) <= 20 * 60 * 1000; // STOP_LOOKAHEAD_MINUTES
        // The "charging now" evidence (chargingCar) is read from the latest energy
        // sample, which uploads only every ~15 min — the successful stop updates
        // LastStopUtc in a separate blob immediately. So right after an auto-stop the
        // newest sample still predates the stop and its IsCharging flag is stale (the
        // car really did stop). Only a sample taken AFTER the stop proves a genuine
        // restart; without this the banner fires on every successful auto-stop.
        const chargingSampleAfterStop = ctx.now.getTime() > lastStopMs;

        if (!isNaN(lastStopMs) && sinceStopMs >= 0 && sinceStopMs < cooldownMs && stopDueSoon && chargingSampleAfterStop) {
            return {
                severity: 'critical',
                message: `The charge automation needs to stop the ${carName}, but it already auto-stopped it ` +
                    `${Math.round(sinceStopMs / 60000)} min ago and is honoring its ` +
                    `${CHARGE_AUTOMATION.ACTION_COOLDOWN_HOURS}h cooldown — stop the charge manually to protect the Powerwall.` +
                    (goalLost ? peakText : '')
            };
        }

        // Failed commands: the automation decided to stop this car today and the
        // charge_stop command failed (it retries at most 3 times per day). The C#
        // side zeroes StopFailedAttemptsToday on a later successful stop, so a
        // nonzero count today means the most recent stop attempt is still failing.
        const failedStops = vehicleState.LastStopAttemptDatePacific === pacificDateKey(ctx.now)
            ? (vehicleState.StopFailedAttemptsToday || 0) : 0;
        if (failedStops > 0) {
            return {
                severity: 'critical',
                message: `The charge automation tried to stop the ${carName} ${failedStops}× today, but the ` +
                    `charge_stop command failed` +
                    (failedStops >= 3 ? ' and it has given up for today' : '') +
                    ` — stop the charge manually to protect the Powerwall.` +
                    (goalLost ? peakText : '')
            };
        }
    }

    if (goalLost) {
        return {
            severity: 'caution',
            message: `The Powerwall can no longer reach 100% by the solar/load crossover, even if the ` +
                `${carName} stops charging now.` + peakText
        };
    }
    return null; // an auto-stop is planned and nothing indicates it is blocked
}

/**
 * Everything the day simulation needs, computed once so the automation-mirroring
 * decision sims (a few dozen per prediction) stay cheap.
 */
function buildPredictionContext(todayData) {
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

    // Use filtered data if in historical mode
    let dataSource = energyData;
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        dataSource = window.timeNavigator.getFilteredData();
    }

    // Historical per-15-min-slot profiles for solar production and house load,
    // plus weather factors comparing today's recent solar against the profile.
    // The potential-solar variants answer the automation's "could the Powerwall
    // still refill?" question — the produced profile is curtailed on typical
    // afternoons (Powerwall full by noon), which reads far too pessimistic there.
    const profiles = buildDailyProfiles(dataSource, now);
    const potentialSolar = toPotentialSolarProfile(profiles.solar);
    const solarScale = computeSolarScale(todayData, profiles.solar, now);
    const potentialSolarScale = computePotentialSolarScale(todayData, profiles.solar, potentialSolar, now);
    const recentBaseLoad = computeRecentBaseLoad(todayData, now);

    // Midpoint of the profile's daylight window (the automation's "solar noon")
    let firstDaylight = -1, lastDaylight = -1;
    for (let s = 0; s < profiles.solar.length; s++) {
        if (profiles.solar[s] > 0.15) {
            if (firstDaylight < 0) firstDaylight = s;
            lastDaylight = s;
        }
    }
    const solarNoon = new Date(now);
    solarNoon.setHours(0, 0, 0, 0);
    if (firstDaylight >= 0 && lastDaylight > firstDaylight) {
        solarNoon.setMinutes((firstDaylight + lastDaylight) / 2 * 15 + 7.5);
    } else {
        solarNoon.setHours(12);
    }

    // A sleeping car reports no data on the latest sample; use its most recent
    // report (within 24h) so the prediction still knows its level and limit
    const state = {
        Model3: lastKnownCarState(dataSource, 'Model3', now),
        ModelX: lastKnownCarState(dataSource, 'ModelX', now)
    };
    const level = {}, limit = {}, chargingNow = {}, actualKw = {}, capKw = {}, wallConnectorKw = {};
    for (const key of ['Model3', 'ModelX']) {
        level[key] = state[key] ? state[key][key + 'Battery'] : 0;
        limit[key] = (state[key] && state[key][key + 'ChargeLimit']) || PREDICTION_CONFIG.DEFAULT_EV_CHARGE_LIMIT;
        chargingNow[key] = !!latest[key + 'IsCharging'];
        actualKw[key] = homeChargingPowerKw(latest, key);
        capKw[key] = latest[key + 'ChargeAmps'] > 0
            ? latest[key + 'ChargeAmps'] * PREDICTION_CONFIG.WALL_CONNECTOR_VOLTAGE / 1000
            : PREDICTION_CONFIG.DEFAULT_WALL_CONNECTOR_KW;
        // Rate cap for a future auto-started session: the car's usual requested amps
        wallConnectorKw[key] = state[key] && state[key][key + 'ChargeAmps'] > 0
            ? state[key][key + 'ChargeAmps'] * PREDICTION_CONFIG.WALL_CONNECTOR_VOLTAGE / 1000
            : PREDICTION_CONFIG.DEFAULT_WALL_CONNECTOR_KW;
    }

    return {
        latest, now, endOfDay, dataSource, simulationSettings,
        profiles, potentialSolar, solarScale, potentialSolarScale,
        recentBaseLoad, solarNoon,
        gridImportKw: Math.max(0, latest.GridPowerKw || 0),
        startPowerwallKwh: ((latest.BatteryPercentage || 0) / 100) * BATTERY_CAPACITIES.POWERWALL,
        state, level, limit, chargingNow, actualKw, capKw, wallConnectorKw
    };
}

/**
 * "yyyy-MM-dd" of a Pacific wall-clock Date, matching the C# automation's
 * nowPacific.ToString("yyyy-MM-dd") for comparing against the state blob's
 * LastStop/LastTrigger date fields. (now is already Pacific on the dashboard.)
 */
function pacificDateKey(now) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * First 15-minute slot boundary at or after the given time (matches the
 * automation's NextSlotBoundary).
 */
function nextSlotBoundary(date) {
    const t = new Date(date);
    const minutes = t.getMinutes();
    let roundedMinutes = Math.floor(minutes / 15) * 15;
    if (t.getSeconds() > 0 || t.getMilliseconds() > 0 || minutes % 15 !== 0) {
        roundedMinutes += 15;
    }
    t.setMinutes(roundedMinutes, 0, 0);
    return t;
}

/**
 * Simulates the rest of the day in 15-minute slots — the shared engine behind
 * the chart and the automation-mirroring decisions (same model as the C#
 * PredictPowerwallDay; keep them in sync).
 *
 * overrides:
 * - usePotentialSolar: swap the produced-solar profile for the potential one
 *   (decision sims only — the chart shows what will actually be produced)
 * - applyModel3WeekdayStop (default true): the weekday-2:15-PM routine stop
 * - stops: { Model3?: Date, ModelX?: Date } — force that car's charging off
 *   from the given time (mirrors an automation charge_stop)
 * - start: { key, at } — a predicted automation charge_start: the car begins
 *   surplus-following charging at that time
 */
function simulateDay(ctx, overrides) {
    const o = overrides || {};
    const stops = o.stops || {};
    const applyWeekdayStop = o.applyModel3WeekdayStop !== false;

    const result = {
        labels: [], powerwall: [], model3: [], modelX: [],
        times: [], chargeRateKw: [],
        // Per-slot produced solar and house load (excl. car charging) so the
        // battery chart can mark the evening solar/house-load crossover.
        // deliverableSolar is what the panels COULD produce (uncurtailed) — the chart
        // uses it, not the curtailed produced line, so the crossover marker lands where
        // solar can truly no longer cover the house (not where a full-Powerwall day
        // throttled production down to the load).
        solar: [], houseLoad: [], deliverableSolar: [],
        reaches100: false, fullTime: null,
        peakPercent: (ctx.latest.BatteryPercentage || 0),
        lastUsefulSolarEnd: null,
        solarLoadCrossover: null,
        // Powerwall % at the crossover slot — its level going into the night.
        // The stop side protects THIS (still full at the crossover), not merely
        // "touched 100% at some earlier point and then let the car drain it".
        powerwallAtCrossover: null
    };

    let powerwallKwh = ctx.startPowerwallKwh;
    if (powerwallKwh >= BATTERY_CAPACITIES.POWERWALL - 1e-9) {
        result.reaches100 = true;
        result.fullTime = new Date(ctx.now);
    }

    const level = { Model3: ctx.level.Model3, ModelX: ctx.level.ModelX };
    const charging = { Model3: ctx.chargingNow.Model3, ModelX: ctx.chargingNow.ModelX };
    const capacity = { Model3: BATTERY_CAPACITIES.MODEL_3, ModelX: BATTERY_CAPACITIES.MODEL_X };

    const forcedOff = (key, t) => key in stops && t >= stops[key];

    let currentTime = nextSlotBoundary(ctx.now);
    while (currentTime <= ctx.endOfDay) {
        const minutesFromNow = (currentTime - ctx.now) / (1000 * 60);
        const slot = timeSlotIndex(currentTime);

        // House load: blend the live smoothed load into the historical profile so a
        // momentary spike/lull right now doesn't get extrapolated for hours
        const blendWeight = Math.max(0, 1 - minutesFromNow / PREDICTION_CONFIG.LOAD_BLEND_MINUTES);
        const houseLoadKw = blendWeight * ctx.recentBaseLoad + (1 - blendWeight) * ctx.profiles.load[slot];

        // Solar: historical profile shape scaled by today's weather. The
        // potential-solar decision sims ask "how much could the Powerwall still
        // absorb?", so their deliverable estimate must never fall below the
        // ordinary produced estimate — the afternoon haircut and the separate
        // potential weather scale can otherwise read below it around solar noon
        // and fabricate a Powerwall drain (which then stops the car far too
        // early). The chart's produced sim is unaffected (both terms are equal).
        const producedSolarKw = ctx.profiles.solar[slot] * ctx.solarScale;
        // Deliverable = what the panels could produce (uncurtailed envelope), never
        // below the produced estimate. The decision sims run on it; the chart's
        // produced sim leaves solarKw at producedSolarKw but still records it for the
        // crossover marker.
        const deliverableSolarKw = Math.max(ctx.potentialSolar[slot] * ctx.potentialSolarScale, producedSolarKw);
        const solarKw = o.usePotentialSolar ? deliverableSolarKw : producedSolarKw;

        // Grid import credit fades out — the snapshot only describes right now
        const gridCreditKw = ctx.gridImportKw * Math.max(0, 1 - minutesFromNow / PREDICTION_CONFIG.GRID_DECAY_MINUTES);

        // Charging is solar-managed with the Powerwall getting first claim on the
        // surplus (the routine: Powerwall to 100%, the rest goes to the cars). A
        // car's future rate follows that surplus — as the Powerwall fills up, the
        // manager hands the freed-up solar to whichever car is on the connector.
        const powerwallNeedKw = Math.min(PREDICTION_CONFIG.MAX_POWERWALL_RATE_KW,
            Math.max(0, (BATTERY_CAPACITIES.POWERWALL - powerwallKwh) / 0.25));
        const evSurplusKw = Math.max(0, solarKw - houseLoadKw - powerwallNeedKw);

        // MODEL 3 charging power: surplus-following, floored at the measured rate
        // (the manager grants the car a minimum share even while the Powerwall
        // charges) and capped at the requested amps
        let model3ChargingPowerKw = 0;
        if (ctx.simulationSettings && ctx.simulationSettings.Model3Amps > 0) {
            model3ChargingPowerKw = ctx.simulationSettings.Model3Amps * PREDICTION_CONFIG.WALL_CONNECTOR_VOLTAGE / 1000;
        } else if (!ctx.simulationSettings && charging.Model3 && ctx.actualKw.Model3 > 0 && !forcedOff('Model3', currentTime)) {
            // Weekday 2:15 PM rule: Model 3 charging stops at 2:15 PM on weekdays
            const todayTwoFifteen = new Date(currentTime);
            todayTwoFifteen.setHours(14, 15, 0, 0);
            const isWeekday = currentTime.getDay() >= 1 && currentTime.getDay() <= 5;

            if (applyWeekdayStop && isWeekday && currentTime > todayTwoFifteen) {
                model3ChargingPowerKw = 0;
            } else {
                model3ChargingPowerKw = Math.min(ctx.capKw.Model3, Math.max(ctx.actualKw.Model3, evSurplusKw));
            }
        } else if (chargesFromStart(ctx, o, 'Model3', currentTime, level, stops)) {
            if (evSurplusKw >= PREDICTION_CONFIG.MIN_EV_CHARGE_KW) {
                model3ChargingPowerKw = Math.min(ctx.wallConnectorKw.Model3, evSurplusKw);
            }
        }

        // MODEL X charging power
        let modelXChargingPowerKw = 0;
        if (ctx.simulationSettings && ctx.simulationSettings.ModelXAmps > 0) {
            modelXChargingPowerKw = ctx.simulationSettings.ModelXAmps * PREDICTION_CONFIG.WALL_CONNECTOR_VOLTAGE / 1000;
        } else if (!ctx.simulationSettings && charging.ModelX && ctx.actualKw.ModelX > 0 && !forcedOff('ModelX', currentTime)) {
            modelXChargingPowerKw = Math.min(ctx.capKw.ModelX, Math.max(ctx.actualKw.ModelX, evSurplusKw));
        } else if (model3ChargingPowerKw === 0 && chargesFromStart(ctx, o, 'ModelX', currentTime, level, stops)) {
            // Single wall connector: the auto-started car only charges once the
            // other car's session is over, from whatever surplus the Powerwall
            // doesn't need
            if (evSurplusKw >= PREDICTION_CONFIG.MIN_EV_CHARGE_KW) {
                modelXChargingPowerKw = Math.min(ctx.wallConnectorKw.ModelX, evSurplusKw);
            }
        }

        // Cap EV power by what the car actually needs to reach its charge limit,
        // then advance the car's battery level
        if (model3ChargingPowerKw > 0) {
            const neededKwh = Math.max(0, (ctx.limit.Model3 - level.Model3) / 100 * capacity.Model3);
            model3ChargingPowerKw = Math.min(model3ChargingPowerKw, neededKwh / 0.25);
            const percentageGain = (model3ChargingPowerKw * 0.25 / capacity.Model3) * 100;
            level.Model3 = Math.min(ctx.limit.Model3, level.Model3 + percentageGain);
            if (level.Model3 >= ctx.limit.Model3) {
                charging.Model3 = false;
            }
        }

        if (modelXChargingPowerKw > 0) {
            const neededKwh = Math.max(0, (ctx.limit.ModelX - level.ModelX) / 100 * capacity.ModelX);
            modelXChargingPowerKw = Math.min(modelXChargingPowerKw, neededKwh / 0.25);
            const percentageGain = (modelXChargingPowerKw * 0.25 / capacity.ModelX) * 100;
            level.ModelX = Math.min(ctx.limit.ModelX, level.ModelX + percentageGain);
            if (level.ModelX >= ctx.limit.ModelX) {
                charging.ModelX = false;
            }
        }

        const netKw = solarKw - houseLoadKw - model3ChargingPowerKw - modelXChargingPowerKw + gridCreditKw;
        const rateKw = Math.min(PREDICTION_CONFIG.MAX_POWERWALL_RATE_KW,
            Math.max(-PREDICTION_CONFIG.MAX_POWERWALL_RATE_KW, netKw));
        const previousKwh = powerwallKwh;
        powerwallKwh = Math.min(BATTERY_CAPACITIES.POWERWALL,
            Math.max(0, powerwallKwh + rateKw * 0.25));

        const percent = (powerwallKwh / BATTERY_CAPACITIES.POWERWALL) * 100;
        result.labels.push(currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
        result.powerwall.push(percent);
        result.model3.push(ctx.state.Model3 ? level.Model3 : null);
        result.modelX.push(ctx.state.ModelX ? level.ModelX : null);
        result.times.push(new Date(currentTime));
        // Realized charge rate (kWh delta) — reads 0 once the Powerwall is full,
        // like the live BatteryPowerKw the automation's start trigger watches
        result.chargeRateKw.push(Math.max(0, (powerwallKwh - previousKwh) / 0.25));
        result.peakPercent = Math.max(result.peakPercent, percent);

        if (!result.reaches100 && powerwallKwh >= BATTERY_CAPACITIES.POWERWALL - 1e-9) {
            result.reaches100 = true;
            result.fullTime = new Date(currentTime);
        }
        if (solarKw >= PREDICTION_CONFIG.MIN_EV_CHARGE_KW) {
            result.lastUsefulSolarEnd = new Date(currentTime.getTime() + 15 * 60 * 1000);
        }
        // Last moment PRODUCED solar still covers the house load — after this the
        // Powerwall can only decline, so 100% must be reached by then. Always
        // judged on the produced profile, even in potential-solar decision sims:
        // the potential profile mirrors the (stronger) morning ramp onto the
        // evening, which would push this moment later than the panels can deliver.
        if (producedSolarKw >= houseLoadKw) {
            result.solarLoadCrossover = new Date(currentTime.getTime() + 15 * 60 * 1000);
            result.powerwallAtCrossover = percent; // its level going into the night
        }
        result.solar.push(producedSolarKw);
        result.houseLoad.push(houseLoadKw);
        result.deliverableSolar.push(deliverableSolarKw);

        // Move to next 15-minute interval
        currentTime.setMinutes(currentTime.getMinutes() + 15);
    }

    return result;
}

/**
 * True when a predicted automation charge_start puts this car on the connector
 * at this time (started, not yet stopped, still below its limit).
 */
function chargesFromStart(ctx, o, key, t, level, stops) {
    return !ctx.simulationSettings &&
        o.start && o.start.key === key && t >= o.start.at &&
        !(key in stops && t >= stops[key]) &&
        level[key] < ctx.limit[key];
}

/**
 * Mirrors ChargeAutomationManager: while a car charges, find the automation's
 * stop time (the LATEST one that still lets the Powerwall reach 100%); while no
 * car charges, find the moment the morning auto-start trigger would fire for
 * the plugged-in car — then the stop side for that future session too.
 * Returns simulateDay overrides.
 */
function decideAutomationOverrides(ctx) {
    const o = { applyModel3WeekdayStop: true, stops: {} };

    // A car actively charging at home routes to the stop side
    let chargingCar = null;
    for (const key of ['Model3', 'ModelX']) {
        if (ctx.latest[key + 'IsAvailable'] && ctx.latest[key + 'IsCharging'] &&
            !ctx.latest[key + 'FastChargerPresent'] && ctx.actualKw[key] > 0) {
            chargingCar = key;
            break;
        }
    }

    if (chargingCar) {
        // The sim's weekday-2:15-PM Model 3 stop models the household routine; if
        // it's already past 2:15 and the Model 3 is demonstrably still charging,
        // that assumption is wrong for today — drop it so the comparison is real
        const isWeekday = ctx.now.getDay() >= 1 && ctx.now.getDay() <= 5;
        const pastTwoFifteen = ctx.now.getHours() > 14 ||
            (ctx.now.getHours() === 14 && ctx.now.getMinutes() > 15);
        if (chargingCar === 'Model3' && isWeekday && pastTwoFifteen) {
            o.applyModel3WeekdayStop = false;
        }

        const stopAt = decideStopTime(ctx, chargingCar, o, ctx.now);
        if (stopAt) o.stops[chargingCar] = stopAt;
    }

    // Morning auto-start: would the automation put the (other) plugged-in car on
    // the connector later today?
    const candidate = pickStartCandidate(ctx, chargingCar);
    if (candidate) {
        const startAt = findAutoStartTime(ctx, candidate, o);
        if (startAt) {
            o.start = { key: candidate, at: startAt };
            const stopAt = decideStopTime(ctx, candidate, o, startAt);
            if (stopAt) o.stops[candidate] = stopAt;
        }
    }

    return o;
}

/**
 * "Reaches 100%" for automation decisions: the Powerwall must get there by the
 * solar/load crossover (the last moment production still covers the house) —
 * reaching 100% "by sundown" is impossible, it only ever declines after that.
 * Used by the start side (a no-car baseline, where touching 100% and being full
 * at the crossover are the same thing since nothing drains it).
 */
function reaches100ByCrossover(forecast) {
    return forecast.reaches100 && forecast.solarLoadCrossover !== null &&
        forecast.fullTime <= forecast.solarLoadCrossover;
}

/**
 * True when the Powerwall is still full (~100%) AT the solar/load crossover, so
 * it ends the solar day full and enters the night with a full pack. This is
 * what the stop side protects — stronger than reaches100ByCrossover, which only
 * asks whether 100% was touched at some earlier point. A charging car routinely
 * pushes the Powerwall to 100% at midday and then bleeds it back down as the
 * afternoon solar fades, so "touched 100%" is not "ends the day at 100%".
 */
function powerwallFullAtCrossover(forecast) {
    return powerwallAtLeastAtCrossover(forecast, 99.5);
}

/**
 * True when the Powerwall is at/above `target` percent AT the solar/load crossover.
 * The stop side protects a true 100% (target 99.5) when it is actually reachable, and
 * only the near-full level (STOP_NEAR_FULL_PERCENT) when it is not — see decideStopTime.
 */
function powerwallAtLeastAtCrossover(forecast, target) {
    return forecast.solarLoadCrossover !== null &&
        forecast.powerwallAtCrossover !== null &&
        forecast.powerwallAtCrossover >= target;
}

/**
 * The automation's stop decision for a car charging (or predicted to start
 * charging) at fromTime — port of DecideStop. Returns the Date the automation
 * would issue charge_stop, or null when it would let the session run.
 * Decision sims use the potential-solar profile, exactly like the C# side.
 *
 * Goal: the Powerwall ends the solar day full. The car keeps charging off the
 * surplus (which the already-full Powerwall would otherwise curtail) until the
 * LATEST moment that still lets the freed solar refill the Powerwall to 100% AT
 * the crossover — but no later than STOP_LOCK_IN_MARGIN_MINUTES before it, so
 * 100% is locked in with margin and the evening HVAC load is shed.
 */
function decideStopTime(ctx, key, baseOverrides, fromTime) {
    const base = {
        usePotentialSolar: true,
        applyModel3WeekdayStop: baseOverrides.applyModel3WeekdayStop,
        start: baseOverrides.start || null,
        stops: Object.assign({}, baseOverrides.stops)
    };
    delete base.stops[key];

    const withStop = (t) => Object.assign({}, base, {
        stops: Object.assign({}, base.stops, { [key]: t })
    });

    const continueForecast = simulateDay(ctx, base);
    const crossover = continueForecast.solarLoadCrossover;
    // No produced-solar crossover today (night / solar never covers the house) —
    // nothing to protect; leave the charge alone.
    if (crossover === null) return null;
    const lockIn = new Date(crossover.getTime() - CHARGE_AUTOMATION.STOP_LOCK_IN_MARGIN_MINUTES * 60 * 1000);

    // If even stopping now can't leave the Powerwall full at the crossover, 100%
    // is out of reach either way — stop only for a meaningful peak improvement,
    // and never before solar noon (the afternoon alone can fill the Powerwall,
    // and a marine-layer morning makes the weather scale read far darker than
    // the day will be).
    const stopNowForecast = simulateDay(ctx, withStop(fromTime));
    const stopNowLevel = stopNowForecast.powerwallAtCrossover || 0;

    // Genuine shortfall: even stopping the car now leaves the Powerwall well below
    // full. Interrupt the charge only for a meaningful gain in the Powerwall's level
    // AT the crossover (the level going into the night), NOT the day's peak — a day
    // that touches 100% at midday then drains has a 0pp peak delta even when stopping
    // saves the pack. Never before solar noon (the afternoon alone can fill the pack;
    // a marine-layer morning makes the weather scale read far darker than the day is).
    if (stopNowLevel < CHARGE_AUTOMATION.STOP_NEAR_FULL_PERCENT) {
        const improvement = stopNowLevel - continueForecast.powerwallAtCrossover;
        if (improvement < CHARGE_AUTOMATION.STOP_MIN_IMPROVEMENT_PERCENT) return null;
        return fromTime < ctx.solarNoon ? new Date(ctx.solarNoon) : new Date(fromTime);
    }

    // Tiered protection target: hold a TRUE 100% when it is actually reachable (i.e.
    // stopping the car now would get there); otherwise the Powerwall ends the solar
    // day essentially full regardless, so protect only the near-full level and let the
    // car keep soaking surplus the full pack would otherwise curtail. Either way the
    // latest-safe scan below still stops the car the moment continuing would drain the
    // pack under `target`, so a genuine late-afternoon drain stays protected. (Without
    // the near-full tier, ordinary evening-load over-prediction pulls the stop-now
    // forecast a hair under 100% and the car is stopped far too early — 2026-07-22:
    // Model X stopped 4:45 PM, curtailing the 5–6 PM surplus while the pack held 100%.)
    const target = powerwallFullAtCrossover(stopNowForecast) ? 99.5 : CHARGE_AUTOMATION.STOP_NEAR_FULL_PERCENT;

    // Find the LATEST stop that still leaves the Powerwall at/above `target` at the
    // crossover (stopping earlier only ever helps, so the scan ends at the first fail)...
    let latestSafe = nextSlotBoundary(fromTime);
    for (let t = new Date(latestSafe.getTime() + 15 * 60 * 1000); t <= ctx.endOfDay;
         t = new Date(t.getTime() + 15 * 60 * 1000)) {
        if (!powerwallAtLeastAtCrossover(simulateDay(ctx, withStop(t)), target)) break;
        latestSafe = t;
    }
    // ...then cap it at the lock-in margin, never scheduling before the next slot.
    const floor = nextSlotBoundary(fromTime);
    let stopAt = latestSafe < lockIn ? latestSafe : lockIn;
    if (stopAt < floor) stopAt = floor;
    return stopAt;
}

/**
 * The car the automation could auto-start today — port of PickConnectedVehicle
 * plus the cooldown rule: plugged in at home, below its limit, and without a
 * home charging session within the action cooldown window (one that ended below
 * the limit means someone stopped it on purpose; the automation waits out the
 * cooldown before restarting it).
 */
function pickStartCandidate(ctx, chargingCar) {
    const candidates = [];
    for (const key of ['Model3', 'ModelX']) {
        if (key === chargingCar) continue;
        const report = ctx.state[key];
        if (!report) continue;
        if (report[key + 'IsPluggedIn'] === false || report[key + 'FastChargerPresent']) continue;
        // Stale "charging" report — a charging car never sleeps, so this is outdated
        if (report[key + 'IsCharging'] && report !== ctx.latest) continue;
        if (ctx.level[key] >= ctx.limit[key]) {
            // The limit often sits at/below the car's level overnight and is raised
            // as part of the morning routine — the live automation will see the
            // raised limit when it re-evaluates, so predict the session with the
            // usual limit instead of showing no session at all
            if (ctx.level[key] >= PREDICTION_CONFIG.DEFAULT_EV_CHARGE_LIMIT) continue;
            ctx.limit[key] = PREDICTION_CONFIG.DEFAULT_EV_CHARGE_LIMIT;
        }
        // Restart allowed only once the last home session ended more than the
        // action cooldown ago (2h) — mirrors the automation leaving a recently
        // stopped car alone before it may be started again
        if (hadRecentHomeChargingSession(ctx.dataSource, key, ctx.now)) continue;
        candidates.push({ key, reported: convertToPDT(report.LocalTimestamp) });
    }
    if (candidates.length === 0) return null;
    // Both cars can only claim the connector when one report is stale — trust the newer one
    candidates.sort((a, b) => b.reported - a.reported);
    return candidates[0].key;
}

/**
 * True if the car was seen charging at home within the action cooldown window
 * (ACTION_COOLDOWN_HOURS) — port of HadRecentHomeChargingSession. Together with
 * "currently stopped below its limit" that means a person (or the car's own
 * schedule) recently ended the session, and the automation waits out the
 * cooldown before restarting it.
 */
function hadRecentHomeChargingSession(dataSource, key, now) {
    const cutoff = new Date(now.getTime() - CHARGE_AUTOMATION.ACTION_COOLDOWN_HOURS * 3600 * 1000);
    for (let i = dataSource.length - 1; i >= 0; i--) {
        const point = dataSource[i];
        const pointDate = convertToPDT(point.LocalTimestamp);
        if (pointDate > now) continue;
        if (pointDate < cutoff) break; // history is chronological
        if (point[key + 'IsAvailable'] && point[key + 'IsCharging'] && !point[key + 'FastChargerPresent']) {
            return true;
        }
    }
    return false;
}

/**
 * When would the automation's start trigger fire for this car? Scans a baseline
 * simulation (no future EV session) for the first slot where the Powerwall is
 * absorbing (nearly) all the solar it can take — >= HIGH_POWERWALL_CHARGE_KW,
 * or >= LOW while nearly full — with the forecast reaching 100% and enough
 * useful solar hours left. Port of EvaluateStartAsync's trigger conditions.
 * Returns the predicted start Date, or null when it would not fire today.
 */
function findAutoStartTime(ctx, key, baseOverrides) {
    const baseline = simulateDay(ctx, {
        applyModel3WeekdayStop: baseOverrides.applyModel3WeekdayStop,
        stops: baseOverrides.stops
    });
    if (!reaches100ByCrossover(baseline) || !baseline.lastUsefulSolarEnd) return null;

    for (let i = 0; i < baseline.times.length; i++) {
        const t = baseline.times[i];
        const rateKw = baseline.chargeRateKw[i];
        const nearlyFull = baseline.powerwall[i] >= CHARGE_AUTOMATION.NEARLY_FULL_PERCENT;
        const solarAboutToBeWasted =
            rateKw >= CHARGE_AUTOMATION.HIGH_POWERWALL_CHARGE_KW ||
            (rateKw >= CHARGE_AUTOMATION.LOW_POWERWALL_CHARGE_KW && nearlyFull);
        if (!solarAboutToBeWasted) continue;

        const solarHoursLeft = (baseline.lastUsefulSolarEnd - t) / (3600 * 1000);
        if (solarHoursLeft < CHARGE_AUTOMATION.MIN_SOLAR_HOURS_LEFT) continue;

        // A (re)start must land before the day's solar/house-load crossover —
        // after it there is no surplus for the car (mirrors EvaluateStartAsync)
        if (baseline.solarLoadCrossover && t >= baseline.solarLoadCrossover) break;

        return t;
    }
    return null;
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
 * Potential solar production per slot, reconstructed from the produced-solar
 * profile — port of the automation's ToPotentialSolarProfile. The system
 * curtails production once the Powerwall is full and nothing else wants power,
 * so on typical days the recorded solar collapses to roughly the house load
 * from late morning on — but the panels could have produced a full bell curve.
 * Each slot's potential is the largest production ever recorded at the same or
 * a greater distance from solar noon. Used by the automation-mirroring decision
 * sims, where the question is how much energy the Powerwall COULD still absorb.
 */
function toPotentialSolarProfile(solarProfile) {
    let first = -1, last = -1;
    for (let s = 0; s < solarProfile.length; s++) {
        if (solarProfile[s] > 0.15) {
            if (first < 0) first = s;
            last = s;
        }
    }
    if (first < 0 || last <= first) return solarProfile;

    const solarNoonSlot = (first + last) / 2;
    const potential = new Array(solarProfile.length).fill(0);
    for (let s = first; s <= last; s++) {
        const dist = Math.abs(s - solarNoonSlot);
        let best = solarProfile[s];
        for (let m = first; m <= last; m++) {
            if (Math.abs(m - solarNoonSlot) >= dist) {
                best = Math.max(best, solarProfile[m]);
            }
        }
        // Afternoon delivery factor: mirroring the (steeper) morning ramp onto the
        // afternoon overstates what the panels actually deliver — by ~1.3x across a
        // backtested year, roughly constant past solar noon. Scale post-noon potential
        // by AFTERNOON_FACTOR, ramped in over the first RAMP_HOURS so there's no cliff
        // at noon. Keeps the STOP side from targeting phantom evening solar and letting
        // the latest-safe stop slide too late (2026-07-21 incident). See shared-config.js.
        if (s > solarNoonSlot) {
            const hoursPastNoon = (s - solarNoonSlot) / 4; // 4 fifteen-minute slots per hour
            const ramp = Math.min(1, hoursPastNoon / PREDICTION_CONFIG.POTENTIAL_AFTERNOON_RAMP_HOURS);
            best *= 1 - (1 - PREDICTION_CONFIG.POTENTIAL_AFTERNOON_FACTOR) * ramp;
        }
        potential[s] = best;
    }
    return potential;
}

/**
 * Weather scale to apply to the potential-solar profile — port of the
 * automation's ComputePotentialSolarScale. Today's production is compared
 * against the MEDIAN profile (typical vs typical), and only where the
 * comparison means something: slots whose history is itself uncurtailed,
 * skipping dawn/dusk and today's curtailed samples (Powerwall full, no car
 * charging, not exporting). With too little evidence the scale stays neutral.
 */
function computePotentialSolarScale(todayData, medianProfile, potentialProfile, now) {
    const windowStart = new Date(now.getTime() - 2 * PREDICTION_CONFIG.SOLAR_SCALE_WINDOW_HOURS * 3600 * 1000);
    let todaySum = 0;
    let profileSum = 0;
    for (const point of todayData) {
        const pointDate = convertToPDT(point.LocalTimestamp);
        if (pointDate < windowStart) continue;

        const slot = timeSlotIndex(pointDate);
        const median = medianProfile[slot];
        if (median <= 1.0) continue; // dawn/dusk says more about the marine layer than the day
        if (median < 0.7 * potentialProfile[slot]) continue; // curtailed history — not a weather reference

        const evKw = homeChargingPowerKw(point, 'Model3') + homeChargingPowerKw(point, 'ModelX');
        const likelyCurtailed = (point.BatteryPercentage || 0) >= 99.5 && evKw < 0.5 && (point.GridPowerKw || 0) > -0.5;
        if (likelyCurtailed) continue;

        todaySum += point.SolarPowerKw || 0;
        profileSum += median;
    }
    if (profileSum < 3) return 1;
    return Math.min(1.6, Math.max(0.3, todaySum / profileSum));
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
 * Most recent data point (within 24h) where a car reported battery data.
 * Cars sleep and drop off the feed, so the latest sample often has no car data.
 * @param {Array} dataSource - Full energy data history
 * @param {string} carPrefix - 'Model3' or 'ModelX'
 * @param {Date} now - Current prediction time
 * @returns {Object|null} The data point, or null if the car hasn't reported in 24h
 */
function lastKnownCarState(dataSource, carPrefix, now) {
    const cutoff = now.getTime() - 24 * 3600 * 1000;
    for (let i = dataSource.length - 1; i >= 0; i--) {
        const point = dataSource[i];
        const pointDate = convertToPDT(point.LocalTimestamp);
        if (pointDate > now) continue;
        if (pointDate < cutoff) break;
        if (point[carPrefix + 'IsAvailable'] && point[carPrefix + 'Battery'] != null) return point;
    }
    return null;
}
