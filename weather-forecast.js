// The 16-day weather/solar outlook card. PURE RENDERER: every value drawn here comes
// from weather-forecast.json, which the collector republishes each cycle (see the header
// of WeatherForecastManager.cs). Nothing in this file talks to a weather API, and nothing
// derives a condition label, a severity or a kWh figure — those are model decisions and
// they live in C# so the card can never disagree with the controller acting on the same
// numbers.
//
// This replaced a browser-side Open-Meteo fetch with an NWS fallback. NWS carries no
// shortwave radiation, so whenever the fallback engaged the "Predicted Solar Production"
// chart vanished and the card looked broken. The fallback is gone: a stale blob still has
// a full 16-day outlook in it, which beats a live half-empty one.

let weatherTempChartObj = null;
let weatherSolarChartObj = null;

function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function tempBarColor(high) {
    if (high === null) return '#87ceeb';
    if (high >= 100) return '#ff5c33';
    if (high >= 90) return '#ff8c00';
    if (high >= 80) return '#ffd700';
    return '#87ceeb';
}

// kWh below which the controller pre-charges both cars to 100%; drawn on the chart so
// it is obvious at a glance which days would trigger.
function stormKwhThreshold() {
    const uc = (typeof SHARED_CONFIG !== 'undefined') ? SHARED_CONFIG.UNIFIED_CONTROLLER : null;
    return (uc && uc.STORM_SOLAR_KWH_THRESHOLD > 0) ? uc.STORM_SOLAR_KWH_THRESHOLD : null;
}

async function fetchWeatherOutlook() {
    // Cache-busting query AND no-store: a CDN/browser cache holding the old blob is
    // exactly what would force the user into a hard refresh.
    const response = await fetch(`${WEATHER_FORECAST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.Days) || data.Days.length === 0)
        throw new Error('weather-forecast.json has no days');
    return data;
}

// Labels are formatted from the published date rather than published as text: the browser
// is the only thing that knows the reader's "today", so a blob written before midnight
// still labels its days correctly.
// Prefixed: every dashboard script shares one global scope, and a second `const WEEKDAYS`
// anywhere would be a hard SyntaxError that takes the whole page down.
const FORECAST_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FORECAST_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabels(day) {
    const parts = (day.Date || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return { name: '', dateLabel: '' };
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    const today = new Date();
    const isToday = date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    return {
        name: isToday ? 'Today' : FORECAST_WEEKDAYS[date.getDay()],
        dateLabel: `${FORECAST_MONTHS[date.getMonth()]} ${date.getDate()}`
    };
}

function extraTooltipLines(day) {
    const lines = [day.Desc];
    if (day.ModelNote) lines.push(day.ModelNote);
    if (day.PrecipProb !== null && day.PrecipProb > 0) lines.push(`💧 Precip chance: ${day.PrecipProb}%`);
    if (day.Extended) lines.push('Extended outlook — lower confidence');
    return lines;
}

function tooltipTitle(days) {
    return items => {
        const d = days[items[0].dataIndex];
        const { name, dateLabel } = dayLabels(d);
        return `${name}${dateLabel ? ' — ' + dateLabel : ''}`;
    };
}

// Storm days get red labels, rain amber, extended-outlook days dimmed
function forecastXScale(days) {
    return {
        ticks: {
            color: ctx => {
                const d = days[ctx.index];
                if (!d) return '#888';
                if (d.Severity === 'storm') return '#ff6b6b';
                if (d.Severity === 'rain') return '#ffc800';
                return d.Extended ? '#64748f' : '#87ceeb';
            },
            maxRotation: 0,
            autoSkip: false,
            font: { size: 9 }
        },
        grid: { color: 'rgba(255, 255, 255, 0.1)' }
    };
}

// Draws a dashed horizontal rule at the storm pre-charge threshold, so it is visible
// which days fall under it. Reads its value from options.plugins.thresholdLine.value.
const thresholdLinePlugin = {
    id: 'thresholdLine',
    afterDatasetsDraw(chart, args, opts) {
        const value = opts && opts.value;
        if (!(value > 0)) return;
        const y = chart.scales.y.getPixelForValue(value);
        if (!isFinite(y)) return;
        const { left, right } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 120, 60, 0.9)';   // needs to read over the yellow bars
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        // The bars usually reach past this line, so the label needs its own backdrop
        // or it disappears into them.
        const label = `${value} kWh — pre-charge below`;
        ctx.font = '10px sans-serif';
        const w = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(20, 20, 20, 0.82)';
        ctx.fillRect(right - w - 10, y - 13, w + 8, 13);
        ctx.fillStyle = 'rgba(255, 140, 90, 0.95)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, right - 6, y - 2);
        ctx.restore();
    }
};

// Two side-by-side charts, one column per day (same style as the daily production
// charts): temperature as floating low→high bars, predicted production beside it.
function renderForecast(container, days) {
    container.innerHTML = `
        <div class="forecast-charts-row">
            <div class="forecast-chart-col">
                <div class="forecast-chart-title">🌡️ Temperature Range (°F)</div>
                <div class="forecast-chart-wrapper"><canvas id="weatherTempChart"></canvas></div>
            </div>
            <div class="forecast-chart-col" id="weatherSolarChartCol">
                <div class="forecast-chart-title">☀️ Predicted Solar Production (kWh)</div>
                <div class="forecast-chart-wrapper"><canvas id="weatherSolarChart"></canvas></div>
            </div>
        </div>`;

    // Three short lines per tick so 16 labels fit in a half-width chart
    const labels = days.map(d => {
        const { name, dateLabel } = dayLabels(d);
        return [d.Icon || '', name, dateLabel];
    });

    // Y axis padded just beyond the coldest low / hottest high, rounded to 5°
    const lows = days.map(d => d.Low !== null ? d.Low : d.High);
    const highs = days.map(d => d.High !== null ? d.High : d.Low);
    const known = lows.filter(v => v !== null).concat(highs.filter(v => v !== null));
    const yMin = known.length ? Math.floor((Math.min(...known) - 5) / 5) * 5 : 40;
    const yMax = known.length ? Math.ceil((Math.max(...known) + 5) / 5) * 5 : 100;

    if (weatherTempChartObj) weatherTempChartObj.destroy();
    weatherTempChartObj = new Chart(document.getElementById('weatherTempChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: days.map((d, i) => lows[i] !== null ? [lows[i], highs[i]] : null),
                backgroundColor: days.map(d => hexToRgba(tempBarColor(d.High), 0.7)),
                borderColor: days.map(d => tempBarColor(d.High)),
                borderWidth: 1,
                borderSkipped: false,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: tooltipTitle(days),
                        label: item => {
                            const d = days[item.dataIndex];
                            return `High ${d.High !== null ? d.High + '°' : '--'}   Low ${d.Low !== null ? d.Low + '°' : '--'}`;
                        },
                        afterLabel: item => extraTooltipLines(days[item.dataIndex]).join('\n')
                    }
                }
            },
            scales: {
                x: forecastXScale(days),
                y: {
                    min: yMin,
                    max: yMax,
                    ticks: { color: '#888', callback: value => value + '°' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        }
    });

    if (weatherSolarChartObj) {
        weatherSolarChartObj.destroy();
        weatherSolarChartObj = null;
    }
    if (days.every(d => d.PredictedKwh == null)) {
        // Only reachable if Open-Meteo returned no radiation at all — hide the column
        // rather than draw an empty axis. (This used to be the NORMAL case whenever the
        // browser fell back to NWS, which is what made the chart look broken; the
        // collector no longer has a radiation-free source to fall back to.)
        document.getElementById('weatherSolarChartCol').style.display = 'none';
        return;
    }
    // Bars are all one colour (the solar yellow used by the production charts) — "how good
    // a solar day is this" is carried by bar HEIGHT in kWh, which is the honest encoding.
    // It used to be carried by a green/amber/red colour ramp on sunshine %.
    const threshold = stormKwhThreshold();
    const maxKwh = Math.max(...days.map(d => d.PredictedKwh || 0), threshold || 0);

    weatherSolarChartObj = new Chart(document.getElementById('weatherSolarChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: days.map(d => d.PredictedKwh),
                backgroundColor: 'rgba(255, 204, 0, 0.7)',
                borderColor: '#ffcc00',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: tooltipTitle(days),
                        label: item => {
                            const d = days[item.dataIndex];
                            return d.PredictedKwh !== null
                                ? `Predicted: ${d.PredictedKwh.toFixed(1)} kWh`
                                : 'Predicted: --';
                        },
                        afterLabel: item => {
                            const d = days[item.dataIndex];
                            const lines = extraTooltipLines(d);
                            if (threshold !== null && d.PredictedKwh !== null && d.PredictedKwh < threshold)
                                lines.unshift(`⚡ Below ${threshold} kWh — cars would pre-charge to 100%`);
                            if (d.SolarPct !== null) lines.unshift(`${d.SolarPct}% of daylight with sunshine`);
                            return lines.join('\n');
                        }
                    }
                },
                // Faint line at the pre-charge threshold. Drawn as a plugin rather than a
                // dataset: on a category axis an extra line dataset needs `parsing: false`
                // or it silently fails to render, and this avoids the trap entirely.
                thresholdLine: { value: threshold }
            },
            scales: {
                x: forecastXScale(days),
                y: {
                    min: 0,
                    suggestedMax: Math.ceil((maxKwh * 1.1) / 10) * 10,
                    ticks: { color: '#888', callback: value => value + ' kWh' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        },
        plugins: [thresholdLinePlugin]
    });
}

// The dashboard div starts hidden until the energy data loads. Chart.js cannot
// size a canvas inside a hidden container, so wait for layout before rendering.
// setTimeout (not requestAnimationFrame) so the wait also progresses in
// background/inactive tabs, where rAF never fires.
function whenLaidOut(el) {
    return new Promise(resolve => {
        const check = () => el.offsetWidth > 0 ? resolve() : setTimeout(check, 150);
        check();
    });
}

async function loadWeatherForecast() {
    const container = document.getElementById('weatherForecast');
    if (!container) return;

    try {
        const outlook = await fetchWeatherOutlook();
        await whenLaidOut(container);
        renderForecast(container, outlook.Days);
    } catch (error) {
        console.warn('Weather outlook unavailable:', error.message);
        container.innerHTML = '<div style="color: #b0c4de;">Forecast unavailable</div>';
    }
}

document.addEventListener('DOMContentLoaded', loadWeatherForecast);
