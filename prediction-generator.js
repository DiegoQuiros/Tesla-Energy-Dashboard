// ─────────────────────────────────────────────────────────────────────────────
// RENDERER of the automation plan — no forecasting, no decisions (2026-07-25).
//
// Every projection on the dashboard (Powerwall/car forecast dots, solar forecast,
// planned start/stop/HVAC markers) comes from automation-plan.json, computed and
// published by the C# unified controller every collector cycle
// (ChargeAutomationManager.Plan.cs). This file only translates that document into
// the shapes the charts want.
//
// It used to BE the forecast engine — a full JavaScript port of PredictPowerwallDay
// plus its own copies of the automation's start/stop rules. Ports drift: the JS
// start trigger was still mirroring a C# routine the unified-controller rewrite had
// deleted, so the chart predicted starts by rules the automation no longer used.
// The fix is structural: one implementation (C#), one renderer (this). If the chart
// and the automation ever disagree again, one of them is reading a stale blob — not
// re-deriving a different answer.
//
// No plan (blob missing, kill-switch on with no projection, stale, or the dashboard
// is time-navigated into the past) ⇒ charts show measured data only. That is honest:
// the projection is the automation's living intent, and there is no such thing as
// "the plan as of last Tuesday 3 PM".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The battery chart's forecast + automation events, read from the published plan.
 * Return shape is unchanged from the old engine so chart-creator.js renders it
 * as before: parallel arrays per 15-min slot, plus events for the markers/icons.
 */
function generateBatteryPredictions(todayData) {
    const empty = {
        labels: [], powerwall: [], model3: [], modelX: [], times: [],
        solar: [], houseLoad: [], deliverableSolar: [], events: [], warning: null
    };
    if (todayData.length === 0) return empty;

    const plan = automationPlanForNow();
    if (!plan || !plan.Projection || !Array.isArray(plan.Projection.TimesPacific)) return empty;

    // Don't draw forecast dots over ground truth: only slots after the newest
    // measured sample. (The plan can be up to one collector cycle older than the
    // data; its first slots may already be measured territory.)
    const latest = todayData[todayData.length - 1];
    const lastMeasured = convertToPDT(latest.LocalTimestamp);

    const p = plan.Projection;
    const result = {
        labels: [], powerwall: [], model3: [], modelX: [], times: [],
        solar: [], houseLoad: [], deliverableSolar: [], events: [], warning: null
    };
    for (let i = 0; i < p.TimesPacific.length; i++) {
        const t = parsePlanTime(p.TimesPacific[i]);
        if (!t || t <= lastMeasured) continue;
        result.times.push(t);
        result.labels.push(t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
        result.powerwall.push(valueAt(p.PowerwallPercent, i));
        result.model3.push(valueAt(p.Model3Percent, i));
        result.modelX.push(valueAt(p.ModelXPercent, i));
        result.solar.push(valueAt(p.SolarKw, i));
        result.houseLoad.push(valueAt(p.HouseLoadKw, i));
        result.deliverableSolar.push(valueAt(p.DeliverableSolarKw, i));
    }

    // Planned car COMMANDS, for the chart's vertical marker lines (the icons draw
    // separately from the plan + log — see automationChartEvents in chart-creator.js).
    // The plan projects a chain, so there can be several; informational entries (a
    // session tapering out, a car hitting its limit) are consequences rather than
    // commands and get an icon only.
    const planned = Array.isArray(plan.PlannedActions)
        ? plan.PlannedActions.filter(a => a && !a.Informational
            && (a.Action === 'START_CAR' || a.Action === 'STOP_CAR'))
        : [plan.PredictedStart, plan.PredictedStop];
    for (const action of planned) {
        if (!action || !action.TimePacific) continue;
        const at = parsePlanTime(action.TimePacific);
        if (!at || at < lastMeasured) continue;
        const index = result.times.findIndex(t => t >= at);
        if (index < 0) continue;
        result.events.push({
            type: action.Action === 'START_CAR' ? 'start' : 'stop',
            car: action.Target, time: at, index
        });
    }
    result.events.sort((a, b) => a.time - b.time);
    return result;
}

/**
 * The published plan, when it applies to what the dashboard is showing right now:
 * live mode (a plan is the automation's intent FROM NOW — there is no valid plan
 * for a time-navigated past moment) and generated today (a plan from yesterday
 * describes a day that no longer exists). Kill-switch plans carry the projection
 * AND the actions the rules would take (AutomationEnabled=false — icons still
 * render normally as "Planned", since the chart is not the place to editorialize
 * about the kill-switch).
 */
function automationPlanForNow() {
    const plan = window.automationPlan;
    if (!plan) return null;
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) return null;
    if (!plan.GeneratedPacific || plan.GeneratedPacific.slice(0, 10) !== pacificDateKey(new Date())) return null;
    return plan;
}

/**
 * Rest-of-today produced-solar forecast from the plan, for the solar chart's
 * forecast dots and its "~kWh to go" header: [{ time, solarKw }] for today's
 * remaining slots, or null when no applicable plan.
 */
function planSolarForecastToday() {
    const plan = automationPlanForNow();
    if (!plan || !plan.Projection || !Array.isArray(plan.Projection.TimesPacific)) return null;
    const p = plan.Projection;
    const todayKey = pacificDateKey(new Date());
    const out = [];
    for (let i = 0; i < p.TimesPacific.length; i++) {
        if (p.TimesPacific[i].slice(0, 10) !== todayKey) continue; // today only — tomorrow's ramp is not "to go" today
        const t = parsePlanTime(p.TimesPacific[i]);
        const kw = valueAt(p.SolarKw, i);
        if (t && kw != null) out.push({ time: t, solarKw: kw });
    }
    return out.length ? out : null;
}

/** "yyyy-MM-dd" of a Pacific wall-clock Date (dashboard clocks are already Pacific). */
function pacificDateKey(now) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Parse the plan's "yyyy-MM-dd HH:mm" Pacific wall-clock stamp as a local Date. */
function parsePlanTime(stamp) {
    if (typeof stamp !== 'string') return null;
    const [datePart, timePart] = stamp.split(' ');
    if (!datePart || !timePart) return null;
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi] = timePart.split(':').map(Number);
    if ([y, mo, d, h, mi].some(isNaN)) return null;
    return new Date(y, mo - 1, d, h, mi, 0, 0);
}

function valueAt(arr, i) {
    return Array.isArray(arr) && arr[i] != null ? arr[i] : null;
}

/**
 * Power an EV charger is actually drawing from the house right now, in kW — a
 * measured-data helper (used by the energy-flow diagram), not a forecast.
 * ChargeAmps is the requested current limit, not what's flowing (solar-limited
 * charging runs below it), so use measured current × voltage. Voltage can read
 * 0/1/2 while the charger ramps up; fall back to the integer ChargerPowerKw then.
 * A DC fast charger (Supercharger) draws nothing from the house.
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
