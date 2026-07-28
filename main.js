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
   and then arms exactly one timeout for the next attempt.

   There used to be a second, fixed-interval timer alongside this one. It ticked
   every DATA_INTERVAL_MINUTES counting from PAGE-LOAD time rather than from the
   collector's publish boundary, so it usually fired ~30 s early: it re-drew the
   charts against the sample already on screen while the timestamp label stayed
   put, and the boundary-aligned refresh then landed the real update seconds
   later. Two visible updates for one cycle of data. Hence: one timer only, and
   charts are re-drawn only when the sample actually advanced (see
   loadEnergyData). */

const REFRESH_BUFFER_MS = 35000;       // let the collector finish publishing (was 25s, c8fb509)
const REFRESH_STALE_RETRY_MS = 20000;  // sample not up yet — nudge instead of losing a whole interval
const REFRESH_MAX_STALE_RETRIES = 6;   // ~2 min of nudging, then fall back to the next boundary
const REFRESH_ERROR_RETRY_MS = 60000;  // fetch failed outright

let refreshTimeout = null;
let staleRetries = 0;

function cancelScheduledRefresh() {
    if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        refreshTimeout = null;
    }
}

// ms until the collector's next publish boundary strictly after `sampleTime`,
// plus the buffer. Skips past boundaries already gone (throttled background tab).
function msUntilNextPublish(sampleTime) {
    const intervalMs = DATA_INTERVAL_MINUTES * 60 * 1000;

    const boundary = new Date(sampleTime);
    boundary.setSeconds(0, 0);
    boundary.setMinutes(
        Math.floor(boundary.getMinutes() / DATA_INTERVAL_MINUTES) * DATA_INTERVAL_MINUTES + DATA_INTERVAL_MINUTES);

    const now = Date.now();
    let target = boundary.getTime() + REFRESH_BUFFER_MS;
    while (target <= now) target += intervalMs;
    return target - now;
}

function scheduleRefresh(delayMs, reason) {
    cancelScheduledRefresh();

    // Historical mode freezes the view; resumeLiveRefresh() re-arms on the way back
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        console.log('Historical mode active — refresh paused');
        return;
    }

    const at = new Date(Date.now() + delayMs);
    console.log(`Next refresh at ${at.toLocaleTimeString()} (in ${Math.round(delayMs / 1000)}s — ${reason})`);

    refreshTimeout = setTimeout(() => {
        refreshTimeout = null;
        refreshData(reason);
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
        scheduleRefresh(msUntilNextPublish(lastDataTimestamp), 'next publish boundary');
        return;
    }

    // Same sample as last time: the collector hasn't published yet. Nudge a few
    // times rather than sitting out a whole interval, then give up and realign.
    if (++staleRetries <= REFRESH_MAX_STALE_RETRIES) {
        scheduleRefresh(REFRESH_STALE_RETRY_MS,
            `no new sample yet, retry ${staleRetries}/${REFRESH_MAX_STALE_RETRIES}`);
    } else {
        staleRetries = 0;
        scheduleRefresh(msUntilNextPublish(new Date()), 'gave up waiting, realigning to next boundary');
    }
}

// Re-arm after historical mode or a background tab. Fetches straight away if the
// sample on screen has already aged past one collector interval.
function resumeLiveRefresh() {
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) return;

    staleRetries = 0;

    const maxAge = DATA_INTERVAL_MINUTES * 60 * 1000 + REFRESH_BUFFER_MS;
    if (!lastDataTimestamp || Date.now() - lastDataTimestamp.getTime() > maxAge) {
        cancelScheduledRefresh();
        refreshData('catching up on stale data');
        return;
    }

    scheduleRefresh(msUntilNextPublish(lastDataTimestamp), 'resumed live mode');
}