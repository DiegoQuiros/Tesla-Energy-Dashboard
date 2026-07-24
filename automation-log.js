// Automation Log card — renders the unified controller's action log
// (automation-log.json, written by ChargeAutomationManager) newest-first in a
// scrollable card. Self-contained: fetches on load and on a light interval.

const AUTOMATION_LOG_REFRESH_MS = 5 * 60 * 1000; // re-fetch every 5 min (collector runs every 15)

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
        const response = await fetch(`${AUTOMATION_LOG_URL}?t=${Date.now()}`);
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

function renderAutomationLog(container, entries) {
    if (entries === null) {
        container.innerHTML = '<div style="color:#b0c4de;">Automation log unavailable.</div>';
        return;
    }
    if (entries.length === 0) {
        container.innerHTML = '<div style="color:#8a9bb5;">No automation actions logged yet.</div>';
        return;
    }
    // Newest first (sort by UTC timestamp descending; fall back to array order).
    const sorted = entries.slice().sort((a, b) => {
        const ta = a.TimeUtc ? Date.parse(a.TimeUtc) : 0;
        const tb = b.TimeUtc ? Date.parse(b.TimeUtc) : 0;
        return tb - ta;
    });
    container.innerHTML = sorted.map(renderAutomationLogRow).join('');
}

// Battery-chart banner logic: the controller logs every car command, so if its MOST
// RECENT car-command outcome was a FAILURE (and recent), surface a warning banner telling
// the user to act manually. A later successful command clears it. This replaces the old
// forecast-derived banner (which read the now-frozen charge-automation-state.json).
function automationWarningFromLog(entries) {
    if (!entries || !entries.length) return null;
    const sorted = entries.slice().sort((a, b) => (Date.parse(b.TimeUtc) || 0) - (Date.parse(a.TimeUtc) || 0));
    for (const e of sorted) {
        const isFail = e.Action === 'FAIL';
        const isCarCommand = isFail || e.Action === 'START_CAR' || e.Action === 'STOP_CAR' ||
            e.Action === 'LIMIT_100' || e.Action === 'LIMIT_85';
        if (!isCarCommand) continue;      // skip heat-pump-only actions
        if (!isFail) return null;         // the latest car command succeeded — nothing to warn about
        const ageMs = Date.now() - (Date.parse(e.TimeUtc) || 0);
        if (ageMs > 12 * 60 * 60 * 1000) return null; // too old to be actionable
        return {
            severity: 'critical',
            message: `Automation command failed — you may need to act manually. ${e.Reason || e.Target || ''}`.trim()
        };
    }
    return null;
}

async function loadAutomationLog() {
    const entries = await fetchAutomationLog();
    window.automationLog = entries || [];

    // Update the battery-chart banner from the log (fires on a failed car command).
    window.automationLogWarning = automationWarningFromLog(entries);
    if (typeof updateBatteryAutomationBanner === 'function') {
        updateBatteryAutomationBanner(window.automationLogWarning);
    }

    const container = document.getElementById('automationLogBody');
    if (container) renderAutomationLog(container, entries);
}

document.addEventListener('DOMContentLoaded', function () {
    loadAutomationLog();
    setInterval(loadAutomationLog, AUTOMATION_LOG_REFRESH_MS);
});
