// Start timer for refreshing stale data labels every minute
function startStaleDataTimer() {
    setInterval(() => {
        refreshStaleDataLabels();
    }, 60 * 1000); // 1 minute
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function () {
    // Wait a bit for Chart.js to fully load
    setTimeout(() => {
        refreshData('initial load').then(() => {
            // After data is loaded, set up time navigator callbacks
            setupTimeNavigatorCallbacks();
        });
        startStaleDataTimer(); // Start the stale data refresh timer
    }, 100);

    // setTimeout is throttled in background tabs, so a page left open can come
    // back late. Catch up the moment it's looked at again (same trick the
    // automation-log card uses).
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) resumeLiveRefresh();
    });
});

// Set up time navigator callbacks after everything is initialized
function setupTimeNavigatorCallbacks() {
    // Wait for time navigator to be ready
    const waitForTimeNavigator = () => {
        if (window.timeNavigator) {
            console.log('Setting up time navigator callbacks');

            // Subscribe to time changes
            window.timeNavigator.subscribe((currentTime, isLive) => {
                console.log(`Time changed: ${isLive ? 'Live Mode' : currentTime.toLocaleString()}`);
                console.log('Updating dashboard and charts for new time...');

                // Force update dashboard
                updateDashboard();

                // Force update charts
                if (typeof createCharts === 'function') {
                    createCharts();
                }

                // The refresh timer is paused while the view is frozen on a past
                // moment, and re-armed (catching up first, if the on-screen sample
                // aged out meanwhile) on the way back to live.
                if (isLive) resumeLiveRefresh();
                else cancelScheduledRefresh();
            });
        } else {
            // Retry after 100ms if time navigator isn't ready yet
            setTimeout(waitForTimeNavigator, 100);
        }
    };

    waitForTimeNavigator();
}

/* ============================================================
   Data refresh — ONE scheduler, one timer
   ============================================================
   Every fetch goes through refreshData(), which loads the blob, lets
   loadEnergyData() write the timestamp label and the charts in the same pass,
   and then arms exactly one timeout for the next attempt. The one other job on
   that timer, refreshAutomationPlan(), re-polls only the controller's plan and
   log when they trail the sample (see scheduleNextCycle).

   There used to be a second, fixed-interval timer alongside this one. It ticked
   every DATA_INTERVAL_MINUTES counting from PAGE-LOAD time rather than from the
   collector's publish boundary, so it usually fired ~30 s early: it re-drew the
   charts against the sample already on screen while the timestamp label stayed
   put, and the boundary-aligned refresh then landed the real update seconds
   later. Two visible updates for one cycle of data. Hence: one timer only, and
   charts are re-drawn only when the sample actually advanced (see
   loadEnergyData). */

// The cycle is detected by polling the controller's plan blob (12 KB, published LAST
// each cycle) rather than by guessing a fixed delay and re-fetching the 19.5 MB sample:
// 2026-10-10 10:45 the fixed 35 s fetch landed one second before the sample (+36 s) and
// the plan (+38 s), and the 20 s retry put the update on screen at +58 s.
const REFRESH_POLL_START_MS = 25000;   // first look; run-to-run publish time varies, so start early
const REFRESH_POLL_MS = 3000;          // then every 3 s until the plan is newer than the boundary
const REFRESH_MAX_POLLS = 60;          // ~3 min with no new plan (controller failed?) — fetch anyway
const REFRESH_STALE_RETRY_MS = 20000;  // sample not up yet — nudge instead of losing a whole interval
const REFRESH_MAX_STALE_RETRIES = 6;   // ~2 min of nudging, then fall back to the next boundary
const REFRESH_ERROR_RETRY_MS = 60000;  // fetch failed outright

let refreshTimeout = null;
let staleRetries = 0;
let planRetries = 0;   // same budget, spent waiting for the controller's plan once the sample is up

function cancelScheduledRefresh() {
    if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        refreshTimeout = null;
    }
}

// The collector's next publish boundary (ms) strictly after `sampleTime`. Skips only
// boundaries a NEWER one has superseded (throttled background tab) — never the latest
// one already passed, or a tab shown again at +30 s would sit out that whole cycle.
function nextPublishBoundary(sampleTime) {
    const intervalMs = DATA_INTERVAL_MINUTES * 60 * 1000;

    const boundary = new Date(sampleTime);
    boundary.setSeconds(0, 0);
    boundary.setMinutes(
        Math.floor(boundary.getMinutes() / DATA_INTERVAL_MINUTES) * DATA_INTERVAL_MINUTES + DATA_INTERVAL_MINUTES);

    let ms = boundary.getTime();
    while (ms + intervalMs + REFRESH_POLL_START_MS <= Date.now()) ms += intervalMs;
    return ms;
}

// Sleep until the first poll for the cycle after `sampleTime`, then poll for it.
function scheduleWaitForCycle(sampleTime, reason) {
    const boundaryMs = nextPublishBoundary(sampleTime);
    scheduleRefresh(Math.max(0, boundaryMs + REFRESH_POLL_START_MS - Date.now()), reason,
        () => waitForPublish(boundaryMs, 0));
}

// Full refresh as soon as the plan blob is newer than the boundary — the whole cycle
// (sample, log, plan) is then up. A failed check falls through to the full fetch, whose
// own retries take over, so a polling problem can't stall the dashboard.
async function waitForPublish(boundaryMs, polls) {
    const planModifiedMs = await fetchAutomationPlanModifiedMs();
    polls++;
    if (isNaN(planModifiedMs) || planModifiedMs >= boundaryMs || polls >= REFRESH_MAX_POLLS) {
        refreshData(planModifiedMs >= boundaryMs
            ? `cycle published ${Math.round((planModifiedMs - boundaryMs) / 1000)}s after the boundary`
            : 'plan check failed or timed out');
        return;
    }
    scheduleRefresh(REFRESH_POLL_MS, `waiting for the cycle, check ${polls}/${REFRESH_MAX_POLLS}`,
        () => waitForPublish(boundaryMs, polls));
}

function scheduleRefresh(delayMs, reason, run = refreshData) {
    cancelScheduledRefresh();

    // Historical mode freezes the view; resumeLiveRefresh() re-arms on the way back
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        console.log('Historical mode active — refresh paused');
        return;
    }

    // A hidden tab (another tab, minimized, another desktop) downloads nothing: each
    // cycle is the 19.5 MB sample plus a redraw nobody sees. The visibilitychange
    // handler calls resumeLiveRefresh(), which catches up the moment it's looked at.
    // The automation-log card keeps its own 15-min poll (130 KB) so its beep still works.
    if (document.hidden) {
        console.log('Tab hidden — refresh paused');
        return;
    }

    const at = new Date(Date.now() + delayMs);
    console.log(`Next refresh at ${at.toLocaleTimeString()} (in ${Math.round(delayMs / 1000)}s — ${reason})`);

    refreshTimeout = setTimeout(() => {
        refreshTimeout = null;
        if (document.hidden) {   // hidden after arming; resumeLiveRefresh() re-arms
            console.log('Tab hidden — refresh paused');
            return;
        }
        run(reason);
    }, delayMs);
}

// Load, render, then arm the next attempt. The label and the charts are written
// by the same loadEnergyData() pass, so they can never show different cycles.
async function refreshData(reason) {
    console.log(`Refreshing data (${reason})...`);

    const before = lastDataTimestamp ? lastDataTimestamp.getTime() : 0;
    const ok = await loadEnergyData();
    const after = lastDataTimestamp ? lastDataTimestamp.getTime() : 0;

    if (!ok) {
        scheduleRefresh(REFRESH_ERROR_RETRY_MS, 'previous fetch failed');
        return;
    }

    if (after > before) {
        staleRetries = 0;
        planRetries = 0;
        scheduleNextCycle('next publish boundary');
        return;
    }

    // Same sample as last time: the collector hasn't published yet. Nudge a few
    // times rather than sitting out a whole interval, then give up and realign.
    if (++staleRetries <= REFRESH_MAX_STALE_RETRIES) {
        scheduleRefresh(REFRESH_STALE_RETRY_MS,
            `no new sample yet, retry ${staleRetries}/${REFRESH_MAX_STALE_RETRIES}`);
    } else {
        staleRetries = 0;
        scheduleWaitForCycle(new Date(), 'gave up waiting, realigning to next boundary');
    }
}

// The sample on screen is current: sleep until the next boundary — unless the
// controller's plan (and log) for it isn't up yet. The collector saves the sample
// BEFORE the controller runs, so a fetch can land in between and draw last cycle's
// actions; then re-poll just the plan and log on the stale-sample cadence until
// they land (see automationPlanBehindSample in dashboard-updater.js).
function scheduleNextCycle(reason) {
    const behind = typeof automationPlanBehindSample === 'function' && automationPlanBehindSample();
    if (behind && ++planRetries <= REFRESH_MAX_STALE_RETRIES) {
        scheduleRefresh(REFRESH_STALE_RETRY_MS,
            `automation plan not up yet, retry ${planRetries}/${REFRESH_MAX_STALE_RETRIES}`, refreshAutomationPlan);
        return;
    }
    planRetries = 0;
    scheduleWaitForCycle(lastDataTimestamp,
        behind ? 'gave up waiting for the automation plan' : reason);
}

async function refreshAutomationPlan(reason) {
    console.log(`Refreshing automation plan (${reason})...`);
    await reloadAutomationPlan();
    scheduleNextCycle('next publish boundary');
}

// Re-arm after historical mode or a background tab. Fetches straight away if the
// sample on screen has already aged past one collector interval.
function resumeLiveRefresh() {
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) return;

    staleRetries = 0;
    planRetries = 0;

    const maxAge = DATA_INTERVAL_MINUTES * 60 * 1000 + REFRESH_POLL_START_MS;
    if (!lastDataTimestamp || Date.now() - lastDataTimestamp.getTime() > maxAge) {
        cancelScheduledRefresh();
        refreshData('catching up on stale data');
        return;
    }

    scheduleNextCycle('resumed live mode');
}