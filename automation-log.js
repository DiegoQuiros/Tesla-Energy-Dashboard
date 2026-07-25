// Automation Log card — renders the unified controller's action log
// (automation-log.json, written by ChargeAutomationManager) newest-first in a
// scrollable card. Refreshed from three places so it never needs a hard refresh:
//   • loadEnergyData() calls loadAutomationLog() on every data refresh cycle
//   • a fallback timer at the collector cadence (in case the data load fails)
//   • when the tab regains focus, so a long-backgrounded page catches up at once
// A separate 1-minute tick re-renders the cached entries so the "13m ago" stamps
// keep counting without re-fetching the blob.

// Fallback poll cadence — matches the collector's sampling interval. Read lazily
// so this file does not depend on shared-config.js having loaded first.
function automationLogFallbackMs() {
    const minutes = (typeof DATA_INTERVAL_MINUTES === 'number' && DATA_INTERVAL_MINUTES > 0)
        ? DATA_INTERVAL_MINUTES : 15;
    return minutes * 60 * 1000;
}

// Don't re-fetch more often than this — the data refresh and the fallback timer
// can otherwise fire back to back.
const AUTOMATION_LOG_MIN_FETCH_GAP_MS = 60 * 1000;

// Relative-timestamp re-render tick (no network).
const AUTOMATION_LOG_TICK_MS = 60 * 1000;

// Action -> {label, color} for the colored badge. Colors follow the dashboard palette.
const AUTOMATION_LOG_ACTION_STYLES = {
    START_CAR: { label: 'Start car', color: '#39d98a' },
    STOP_CAR:  { label: 'Stop car',  color: '#ff8c42' },
    HVAC_UP:   { label: 'Heat pump +1°', color: '#6ab7ff' },
    HVAC_DOWN: { label: 'Heat pump −1°', color: '#4fd1c5' },
    HVAC_SET:  { label: 'Heat pump set', color: '#4fd1c5' },
    LIMIT_100: { label: 'Limit → 100%', color: '#b58cff' },
    LIMIT_85:  { label: 'Limit → 85%',  color: '#9aa7bd' },
    STORM:     { label: 'Storm mode',   color: '#ffcf5c' },
    FAIL:      { label: 'Command failed', color: '#ff5d5d' }
};

function escapeAutomationLogHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchAutomationLog() {
    try {
        // Cache-busting query AND no-store: a CDN/browser cache holding the old
        // blob is exactly what would force the user into a hard refresh.
        const response = await fetch(`${AUTOMATION_LOG_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.warn('Automation log unavailable:', error.message);
        return null;
    }
}

function renderAutomationLogRow(entry) {
    const style = AUTOMATION_LOG_ACTION_STYLES[entry.Action] || { label: entry.Action || 'Action', color: '#9aa7bd' };

    // Relative "time ago" from the UTC stamp; fall back to the Pacific string.
    let ago = '';
    if (entry.TimeUtc) {
        const t = new Date(entry.TimeUtc);
        if (!isNaN(t)) ago = (typeof formatTimeDifference === 'function') ? formatTimeDifference(t, new Date()) : '';
    }

    // Compact data line explaining the "why".
    const bits = [];
    if (typeof entry.PowerwallPercent === 'number') {
        const flow = typeof entry.PowerwallKw === 'number'
            ? (entry.PowerwallKw < -0.05 ? ` (charging ${Math.abs(entry.PowerwallKw).toFixed(1)}kW)`
              : entry.PowerwallKw > 0.05 ? ` (draining ${entry.PowerwallKw.toFixed(1)}kW)` : '')
            : '';
        bits.push(`PW ${entry.PowerwallPercent.toFixed(0)}%${flow}`);
    }
    if (typeof entry.SolarKw === 'number') bits.push(`Solar ${entry.SolarKw.toFixed(1)}kW`);
    if (typeof entry.CoolSetpointF === 'number' && entry.CoolSetpointF > 0) bits.push(`AC ${entry.CoolSetpointF.toFixed(0)}°F`);
    if (entry.DayForecastPeakPercent != null) bits.push(`fcast peak ${entry.DayForecastPeakPercent.toFixed(0)}%`);
    if (entry.OvernightLowPercent != null) bits.push(`o'night low ${entry.OvernightLowPercent.toFixed(0)}%`);
    if (entry.StormMode) bits.push('⛈ storm');

    return `
        <div class="automation-log-row">
            <div class="automation-log-row-head">
                <span class="automation-log-badge" style="background:${style.color}1a; color:${style.color}; border-color:${style.color}55;">${escapeAutomationLogHtml(style.label)}</span>
                ${entry.Target ? `<span class="automation-log-target">${escapeAutomationLogHtml(entry.Target)}</span>` : ''}
                <span class="automation-log-time" title="${escapeAutomationLogHtml(entry.TimePacific || '')}">${escapeAutomationLogHtml(ago || entry.TimePacific || '')}</span>
            </div>
            <div class="automation-log-reason">${escapeAutomationLogHtml(entry.Reason || '')}</div>
            ${bits.length ? `<div class="automation-log-data">${escapeAutomationLogHtml(bits.join('  ·  '))}</div>` : ''}
        </div>`;
}

// Swap the card's contents in place. The card is scrollable and re-renders on
// every refresh cycle, so skip identical HTML and keep the scroll position —
// otherwise a background refresh yanks the user back to the top mid-read.
function applyAutomationLogHtml(container, html) {
    if (container.innerHTML === html) return;
    const scrollTop = container.scrollTop;
    container.innerHTML = html;
    container.scrollTop = scrollTop;
}

function renderAutomationLog(container, entries) {
    if (entries === null) {
        applyAutomationLogHtml(container, '<div style="color:#b0c4de;">Automation log unavailable.</div>');
        return;
    }
    if (entries.length === 0) {
        applyAutomationLogHtml(container, '<div style="color:#8a9bb5;">No automation actions logged yet.</div>');
        return;
    }
    // Only show the last 14 days of actions (entries with an unparseable stamp are kept).
    const cutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recent = entries.filter(e => {
        const t = e.TimeUtc ? Date.parse(e.TimeUtc) : NaN;
        return isNaN(t) || t >= cutoffMs;
    });
    if (recent.length === 0) {
        applyAutomationLogHtml(container, '<div style="color:#8a9bb5;">No automation actions in the last 14 days.</div>');
        return;
    }
    // Newest first (sort by UTC timestamp descending; fall back to array order).
    const sorted = recent.slice().sort((a, b) => {
        const ta = a.TimeUtc ? Date.parse(a.TimeUtc) : 0;
        const tb = b.TimeUtc ? Date.parse(b.TimeUtc) : 0;
        return tb - ta;
    });
    applyAutomationLogHtml(container, sorted.map(renderAutomationLogRow).join(''));
}

// How long a failed automation command is worth warning about. After this the
// banner disappears on its own (a stale failure is no longer actionable).
const AUTOMATION_FAIL_WARN_WINDOW_MS = 8 * 60 * 60 * 1000; // 8 hours

// Automation Alerts logic: the controller logs every car command, so a FAILED car command
// surfaces a warning telling the user to act manually — but only while it is still
// actionable. A failure is suppressed when EITHER:
//   • it is older than AUTOMATION_FAIL_WARN_WINDOW_MS (8h), or
//   • the issue has since been fixed — a LATER successful command on the SAME car (matched
//     by Target) means the automation regained control of that vehicle.
// Returns an array of live warnings (newest-first, one per affected car) for the Automation
// Alerts card; an empty array means there is nothing to warn about. This replaces the old
// forecast-derived banner (which read the now-frozen charge-automation-state.json).
function automationWarningsFromLog(entries) {
    if (!entries || !entries.length) return [];

    const isCarSuccess = a =>
        a === 'START_CAR' || a === 'STOP_CAR' || a === 'LIMIT_100' || a === 'LIMIT_85';

    // Most recent SUCCESSFUL car command per target — the "issue fixed" signal.
    const lastSuccessMsByTarget = {};
    for (const e of entries) {
        if (!isCarSuccess(e.Action)) continue;
        const t = Date.parse(e.TimeUtc) || 0;
        const key = e.Target || '';
        if (t > (lastSuccessMsByTarget[key] || 0)) lastSuccessMsByTarget[key] = t;
    }

    // Walk failures newest-first, keeping each car's newest recent unresolved one.
    const now = Date.now();
    const seenTargets = new Set();
    const warnings = [];
    const fails = entries
        .filter(e => e.Action === 'FAIL')
        .sort((a, b) => (Date.parse(b.TimeUtc) || 0) - (Date.parse(a.TimeUtc) || 0));
    for (const e of fails) {
        const failMs = Date.parse(e.TimeUtc) || 0;
        if (now - failMs > AUTOMATION_FAIL_WARN_WINDOW_MS) break; // sorted newest-first: the rest are older too
        const target = e.Target || '';
        if (seenTargets.has(target)) continue;                          // already showing this car's newest failure
        if ((lastSuccessMsByTarget[target] || 0) > failMs) continue;    // a later success on this car fixed it
        seenTargets.add(target);
        warnings.push({
            severity: 'critical',
            target: target,
            message: `Automation command failed — you may need to act manually. ${e.Reason || target || ''}`.trim()
        });
    }
    return warnings;
}

// Render the live warnings into the Automation Alerts card (above the battery chart).
// The card is hidden entirely when there is nothing to warn about, so it never takes up
// space or obstructs the chart below it.
function renderAutomationAlerts(warnings) {
    const card = document.getElementById('automationAlertsCard');
    const body = document.getElementById('automationAlertsBody');
    if (!card || !body) return;
    if (!warnings || warnings.length === 0) {
        body.innerHTML = '';
        card.hidden = true;
        return;
    }
    body.innerHTML = warnings.map(w => {
        const cls = w.severity === 'critical' ? 'automation-warning-critical' : 'automation-warning-caution';
        return `<div class="automation-warning ${cls}">⚠️ ${escapeAutomationLogHtml(w.message)}</div>`;
    }).join('');
    card.hidden = false;
}

// Re-render the Automation Log + Alerts cards from whatever is already cached in
// window.automationLog — no network. Used by the 1-minute tick so the relative
// timestamps stay honest between fetches.
function renderAutomationLogFromCache() {
    const entries = window.automationLog;
    if (!Array.isArray(entries)) return;
    renderAutomationAlerts(automationWarningsFromLog(entries));
    const container = document.getElementById('automationLogBody');
    if (container) renderAutomationLog(container, entries);
}

// ── New-entry chirp (desktop only) ───────────────────────────────────────────
// When a brand-new action lands in the log, play a short beep so the user notices
// without having to watch the card. Deliberately desktop-only: a phone or tablet
// chirping from a backgrounded tab is startling, and this dashboard is a desktop
// tool. Browser autoplay policy is the other constraint — an AudioContext built
// before the user has interacted with the page starts suspended and stays silent,
// so the context is created on the first click/keypress instead and any beep
// before that is skipped. There is no way around that; it's a browser rule.
const AUTOMATION_BEEP_HZ = 880;          // A5 — carries without being shrill
const AUTOMATION_BEEP_SECONDS = 0.18;
const AUTOMATION_BEEP_GAIN = 0.14;       // quiet: this is a background nudge

// Desktop = a pointer that is fine AND can hover. Touch-screen laptops driven by
// a mouse still count as desktop; phones and tablets do not.
function automationBeepAllowed() {
    return typeof window.matchMedia === 'function' &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

let automationAudioCtx = null;

// Called from the first user gesture on the page (see DOMContentLoaded below).
function armAutomationBeep() {
    if (automationAudioCtx || !automationBeepAllowed()) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
        automationAudioCtx = new Ctx();
    } catch (error) {
        console.warn('Automation beep unavailable:', error.message);
    }
}

function playAutomationBeep() {
    if (!automationAudioCtx) return;   // no user gesture yet, or not a desktop browser
    try {
        if (automationAudioCtx.state === 'suspended') automationAudioCtx.resume();
        const now = automationAudioCtx.currentTime;
        const osc = automationAudioCtx.createOscillator();
        const gain = automationAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = AUTOMATION_BEEP_HZ;
        // Ramp in and out — starting or stopping a sine at full amplitude clicks.
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(AUTOMATION_BEEP_GAIN, now + 0.02);
        gain.gain.linearRampToValueAtTime(0, now + AUTOMATION_BEEP_SECONDS);
        osc.connect(gain);
        gain.connect(automationAudioCtx.destination);
        osc.start(now);
        osc.stop(now + AUTOMATION_BEEP_SECONDS);
    } catch (error) {
        console.warn('Automation beep failed:', error.message);
    }
}

// Newest TimeUtc already shown, so a refresh can tell a genuinely new action from
// the same log fetched again. null = no baseline yet, so the first load after the
// page opens establishes it silently instead of beeping for existing history.
let automationLogNewestSeenMs = null;

function newestAutomationEntryMs(entries) {
    let newest = 0;
    for (const entry of (entries || [])) {
        const t = (entry && entry.TimeUtc) ? Date.parse(entry.TimeUtc) : NaN;
        if (!isNaN(t) && t > newest) newest = t;
    }
    return newest;
}

// Beep once per refresh in which the log's newest stamp advanced (several new
// entries at once is still one beep — the user only needs to look over).
function checkAutomationLogForNewEntries(entries) {
    const newest = newestAutomationEntryMs(entries);
    if (!newest) return;
    const baseline = automationLogNewestSeenMs;
    automationLogNewestSeenMs = Math.max(baseline || 0, newest);
    if (baseline !== null && newest > baseline) playAutomationBeep();
}

let automationLogInFlight = null;   // de-dupes overlapping refresh triggers
let automationLogLastFetchMs = 0;

// Fetch the log and repaint both cards. `force` bypasses the throttle (used by
// the explicit data-refresh hook); the timers pass nothing so a refresh that just
// happened isn't immediately repeated.
async function loadAutomationLog(force) {
    if (automationLogInFlight) return automationLogInFlight;
    if (!force && automationLogLastFetchMs &&
        Date.now() - automationLogLastFetchMs < AUTOMATION_LOG_MIN_FETCH_GAP_MS) {
        return;
    }

    automationLogInFlight = (async () => {
        const entries = await fetchAutomationLog();
        automationLogLastFetchMs = Date.now();

        // A transient fetch failure keeps the last good log on screen rather than
        // replacing a populated card with "unavailable".
        if (entries === null && Array.isArray(window.automationLog) && window.automationLog.length) {
            return;
        }

        window.automationLog = entries || [];

        // Chirp if this fetch brought an action we haven't shown before (desktop only).
        checkAutomationLogForNewEntries(entries);

        // Populate the Automation Alerts card from the log (fires on failed car commands).
        window.automationAlerts = automationWarningsFromLog(entries || []);
        renderAutomationAlerts(window.automationAlerts);

        const container = document.getElementById('automationLogBody');
        if (container) renderAutomationLog(container, entries);
    })();

    try {
        await automationLogInFlight;
    } finally {
        automationLogInFlight = null;
    }
}

// Called by loadEnergyData() on every data refresh cycle so the card lands new
// actions at the same moment the rest of the dashboard updates.
window.loadAutomationLog = loadAutomationLog;

document.addEventListener('DOMContentLoaded', function () {
    loadAutomationLog(true);

    // Autoplay policy: audio only works once the user has interacted with the page,
    // so build the audio context on the first gesture. Idempotent, so registering
    // both events is harmless.
    ['pointerdown', 'keydown'].forEach(function (evt) {
        window.addEventListener(evt, armAutomationBeep, { once: true, capture: true });
    });

    // Fallback poll — the data-refresh hook is the primary trigger, this covers
    // cycles where loadEnergyData() itself failed.
    setInterval(loadAutomationLog, automationLogFallbackMs());

    // Keep the "13m ago" stamps ticking without hitting the network.
    setInterval(renderAutomationLogFromCache, AUTOMATION_LOG_TICK_MS);

    // Browsers throttle timers in background tabs, so a page left open for hours
    // can come back stale. Catch up the moment it's looked at again.
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) loadAutomationLog(true);
    });
    window.addEventListener('focus', function () { loadAutomationLog(); });
});
