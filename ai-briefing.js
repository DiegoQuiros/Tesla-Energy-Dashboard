// AI Daily Briefing card — renders ai-briefing.json (written once per day by
// AiBriefingManager in the collector: an LLM's recap of yesterday). The blob is
// a list of daily entries, oldest first; the card shows the newest briefing in
// full plus a short "previous days" tail. Pure renderer — all model calls and
// validation happen in C#, same rule as the automation log and weather cards.
//
// Refresh is deliberately lazy: the content changes once per day, so this fetches
// on load, hourly, and when the tab regains visibility. No per-cycle polling.

const AI_BRIEFING_REFRESH_MS = 60 * 60 * 1000; // hourly is plenty for a once-a-day blob

// How many older briefings to show under the newest one.
const AI_BRIEFING_HISTORY_COUNT = 3;

function escapeAiBriefingHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchAiBriefing() {
    try {
        // Same cache strategy as the automation log: bust CDN/browser caches so a
        // fresh briefing never needs a hard refresh.
        const response = await fetch(`${AI_BRIEFING_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (response.status === 404) return []; // blob not created yet — "no briefing" rather than an error
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.warn('AI briefing unavailable:', error.message);
        return null;
    }
}

// "2026-07-28" -> "Mon, Jul 28" (parsed as local so the date doesn't shift a day).
function formatAiBriefingDate(isoDate) {
    const parts = String(isoDate || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return isoDate || '';
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Both configured providers publish independently for the same day (see
// AiBriefingManager.cs), so a day can carry up to two entries. Group by date
// and show each provider's take side by side rather than picking one.
const AI_BRIEFING_PROVIDER_LABELS = { 'azure-openai': 'OpenAI', 'gemini': 'Gemini' };
const AI_BRIEFING_PROVIDER_COLORS = { 'azure-openai': '#6ab7ff', 'gemini': '#a78bfa' };
const AI_BRIEFING_PROVIDER_ORDER = { 'azure-openai': 0, 'gemini': 1 };

function renderAiBriefingEntry(entry) {
    const anomalies = (entry.Anomalies || []).filter(a => a && a.trim());
    const color = AI_BRIEFING_PROVIDER_COLORS[entry.Provider] || '#6ab7ff';
    const label = AI_BRIEFING_PROVIDER_LABELS[entry.Provider] || entry.Provider || '';
    return `
        <div class="automation-log-row">
            <div class="automation-log-row-head">
                <span class="automation-log-badge" style="background:${color}1a; color:${color}; border-color:${color}55;">${escapeAiBriefingHtml(label)}</span>
            </div>
            <div class="automation-log-reason">${escapeAiBriefingHtml(entry.Recap || '')}</div>
            ${anomalies.map(a => `<div class="automation-log-data">⚠️ ${escapeAiBriefingHtml(a)}</div>`).join('')}
            ${entry.Recommendation ? `<div class="automation-log-data">💡 ${escapeAiBriefingHtml(entry.Recommendation)}</div>` : ''}
            ${entry.Model ? `<div class="automation-log-data">via ${escapeAiBriefingHtml(entry.Model)}</div>` : ''}
        </div>`;
}

function renderAiBriefing(container, entries) {
    if (entries === null) {
        // Transient fetch failure: keep whatever is on screen rather than blanking it.
        if (container.dataset.populated === 'true') return;
        container.innerHTML = '<div style="color:#b0c4de;">AI briefing unavailable.</div>';
        return;
    }
    if (entries.length === 0) {
        container.innerHTML = '<div style="color:#8a9bb5;">No briefing published yet — the first one arrives after the next midnight.</div>';
        return;
    }
    const byDate = new Map();
    entries.forEach(e => {
        const list = byDate.get(e.Date) || [];
        list.push(e);
        byDate.set(e.Date, list);
    });
    const dates = Array.from(byDate.keys()).sort((a, b) => String(b).localeCompare(String(a)));
    const shownDates = dates.slice(0, 1 + AI_BRIEFING_HISTORY_COUNT);

    container.innerHTML = shownDates.map(date => {
        const dayEntries = byDate.get(date).slice()
            .sort((a, b) => (AI_BRIEFING_PROVIDER_ORDER[a.Provider] ?? 9) - (AI_BRIEFING_PROVIDER_ORDER[b.Provider] ?? 9));
        const header = `<div class="automation-log-target" style="margin:10px 0 2px;">${escapeAiBriefingHtml(formatAiBriefingDate(date))}</div>`;
        return header + dayEntries.map(renderAiBriefingEntry).join('');
    }).join('');
    container.dataset.populated = 'true';
}

async function loadAiBriefing() {
    const container = document.getElementById('aiBriefingBody');
    if (!container) return;
    const entries = await fetchAiBriefing();
    renderAiBriefing(container, entries);
}

document.addEventListener('DOMContentLoaded', function () {
    loadAiBriefing();
    setInterval(loadAiBriefing, AI_BRIEFING_REFRESH_MS);
    // A tab left in the background for a day should catch up when looked at again.
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) loadAiBriefing();
    });
});
