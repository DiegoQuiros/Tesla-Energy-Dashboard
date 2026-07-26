// 16-day forecast from Open-Meteo (free, no key, longest range available).
// Falls back to the 7-day National Weather Service forecast if Open-Meteo is down.
// Focus is solar production: each day shows a sun-potential bar, and storm/rain
// days are highlighted so weather that hurts the panels stands out early.
const WEATHER_LAT = '33.901084';
const WEATHER_LON = '-117.179254';
const FORECAST_DAYS = 16;

// WMO weather codes -> [description, daytime emoji]
const WMO_CODES = {
    0: ['Clear', '☀️'],
    1: ['Mostly Clear', '🌤️'],
    2: ['Partly Cloudy', '⛅'],
    3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'],
    48: ['Icy Fog', '🌫️'],
    51: ['Light Drizzle', '🌦️'],
    53: ['Drizzle', '🌦️'],
    55: ['Heavy Drizzle', '🌧️'],
    56: ['Freezing Drizzle', '🌧️'],
    57: ['Freezing Drizzle', '🌧️'],
    61: ['Light Rain', '🌦️'],
    63: ['Rain', '🌧️'],
    65: ['Heavy Rain', '🌧️'],
    66: ['Freezing Rain', '🌧️'],
    67: ['Freezing Rain', '🌧️'],
    71: ['Light Snow', '🌨️'],
    73: ['Snow', '❄️'],
    75: ['Heavy Snow', '❄️'],
    77: ['Snow Grains', '❄️'],
    80: ['Light Showers', '🌦️'],
    81: ['Showers', '🌧️'],
    82: ['Heavy Showers', '🌧️'],
    85: ['Snow Showers', '🌨️'],
    86: ['Snow Showers', '❄️'],
    95: ['Thunderstorm', '⛈️'],
    96: ['Storm + Hail', '⛈️'],
    99: ['Storm + Hail', '⛈️']
};

const STORM_CODES = new Set([65, 82, 95, 96, 99]);          // red highlight
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 66, 67, 71, 73, 75, 77, 80, 81, 85, 86]);
// Cloud/fog-only codes: Open-Meteo reports the day's MOST SEVERE hourly code, so a
// morning marine layer marks a 99%-sunshine day as "Overcast". For these codes the
// sunshine ratio is the honest label for solar purposes.
const CLOUD_CODES = new Set([0, 1, 2, 3, 45, 48]);

function forecastEmoji(shortForecast, isDaytime) {
    const f = (shortForecast || '').toLowerCase();
    if (f.includes('thunder')) return '⛈️';
    if (f.includes('snow') || f.includes('ice') || f.includes('sleet')) return '❄️';
    if (f.includes('rain') || f.includes('shower') || f.includes('drizzle')) return '🌧️';
    if (f.includes('fog') || f.includes('haze') || f.includes('smoke')) return '🌫️';
    if (f.includes('mostly cloudy') || f.includes('overcast')) return '☁️';
    if (f.includes('partly')) return '⛅';
    if (f.includes('cloud')) return '🌥️';
    if (f.includes('wind')) return '💨';
    if (f.includes('sunny') || f.includes('clear')) return isDaytime ? '☀️' : '🌙';
    return isDaytime ? '🌤️' : '🌙';
}

async function fetchOpenMeteoDays() {
    const daily = [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'precipitation_probability_max', 'sunshine_duration', 'daylight_duration',
        'shortwave_radiation_sum'
    ].join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
        `&daily=${daily}&temperature_unit=fahrenheit&timezone=auto&forecast_days=${FORECAST_DAYS}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const data = await response.json();
    const d = data.daily;
    if (!d || !d.time || d.time.length === 0) throw new Error('Open-Meteo returned no daily data');

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return d.time.map((iso, i) => {
        const [y, m, day] = iso.split('-').map(Number);
        const date = new Date(y, m - 1, day);
        const code = d.weather_code[i];

        const sunshine = d.sunshine_duration ? d.sunshine_duration[i] : null;
        const daylight = d.daylight_duration ? d.daylight_duration[i] : null;
        const solarPct = (sunshine !== null && daylight) ?
            Math.max(0, Math.min(100, Math.round(100 * sunshine / daylight))) : null;
        const radiation = d.shortwave_radiation_sum ? d.shortwave_radiation_sum[i] : null;
        // What THIS array is expected to make that day, not the raw irradiance. The
        // per-month factor is calibrated against collector history — see
        // shared-config.js SOLAR_KWH_PER_MJ_BY_MONTH and docs/solar-calibration.md.
        const predictedKwh = radiation !== null ? predictedSolarKwh(m, radiation) : null;
        const precipProb = d.precipitation_probability_max ? d.precipitation_probability_max[i] : null;

        let [desc, icon] = WMO_CODES[code] || ['Unknown', '🌤️'];
        let modelNote = null;
        if (CLOUD_CODES.has(code) && solarPct !== null) {
            const rawDesc = desc;
            if (solarPct >= 85) { desc = 'Sunny'; icon = '☀️'; }
            else if (solarPct >= 60) { desc = 'Mostly Sunny'; icon = '🌤️'; }
            else if (solarPct >= 35) { desc = 'Partly Cloudy'; icon = '⛅'; }
            else if (code === 45 || code === 48) { desc = 'Fog'; icon = '🌫️'; }
            else { desc = 'Overcast'; icon = '☁️'; }
            // Only note the raw model condition when it was cloudier than our label
            if (rawDesc !== desc && code >= 2) modelNote = `Some ${rawDesc.toLowerCase()} hours possible`;
        }

        return {
            name: i === 0 ? 'Today' : weekdays[date.getDay()],
            dateLabel: `${months[date.getMonth()]} ${date.getDate()}`,
            high: d.temperature_2m_max[i] !== null ? Math.round(d.temperature_2m_max[i]) : null,
            low: d.temperature_2m_min[i] !== null ? Math.round(d.temperature_2m_min[i]) : null,
            icon,
            desc,
            modelNote,
            solarPct,
            predictedKwh,
            precipProb,
            severity: STORM_CODES.has(code) ? 'storm' : (RAIN_CODES.has(code) || precipProb >= 50 ? 'rain' : null),
            extended: i >= 7
        };
    });
}

// Fallback: original 7-day NWS forecast (alternating day/night periods)
async function fetchNwsDays() {
    const pointsResponse = await fetch(`https://api.weather.gov/points/${WEATHER_LAT},${WEATHER_LON}`);
    const points = await pointsResponse.json();
    const forecastResponse = await fetch(points.properties.forecast);
    const forecast = await forecastResponse.json();
    const periods = forecast.properties.periods || [];

    const days = [];
    for (const period of periods) {
        const precipProb = period.probabilityOfPrecipitation ? period.probabilityOfPrecipitation.value : null;
        if (period.isDaytime) {
            days.push({
                name: period.name,
                dateLabel: '',
                high: period.temperature,
                low: null,
                icon: forecastEmoji(period.shortForecast, true),
                desc: period.shortForecast,
                solarPct: null,
                predictedKwh: null,
                precipProb,
                severity: /thunder/i.test(period.shortForecast) ? 'storm' :
                    (/rain|shower|snow|drizzle/i.test(period.shortForecast) ? 'rain' : null),
                extended: false
            });
        } else if (days.length > 0 && days[days.length - 1].low === null) {
            days[days.length - 1].low = period.temperature;
        } else {
            // Forecast starts in the evening: only tonight's period exists for day one
            days.push({
                name: period.name === 'Tonight' ? 'Today' : period.name.replace(' Night', ''),
                dateLabel: '',
                high: null,
                low: period.temperature,
                icon: forecastEmoji(period.shortForecast, false),
                desc: period.shortForecast,
                solarPct: null,
                predictedKwh: null,
                precipProb,
                severity: null,
                extended: false
            });
        }
    }
    return days.slice(0, 7);
}

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

// Forecast radiation (MJ/m²) -> kWh this array is expected to produce, using the
// calibrated per-month factor from shared-config.js (index 0 = January). The C# rule
// does the same arithmetic in SharedConfig.PredictedSolarKwh — keep the two in step.
const SOLAR_KWH_PER_MJ_FALLBACK = 2.3476;   // annual mean, used only if the table is missing
function predictedSolarKwh(month, radiationMj) {
    const table = (typeof SHARED_CONFIG !== 'undefined' && SHARED_CONFIG.UNIFIED_CONTROLLER)
        ? SHARED_CONFIG.UNIFIED_CONTROLLER.SOLAR_KWH_PER_MJ_BY_MONTH : null;
    const k = (Array.isArray(table) && table[month - 1] > 0)
        ? table[month - 1] : SOLAR_KWH_PER_MJ_FALLBACK;
    return k * radiationMj;
}

// kWh below which the controller pre-charges both cars to 100%; drawn on the chart so
// it is obvious at a glance which days would trigger.
function stormKwhThreshold() {
    const uc = (typeof SHARED_CONFIG !== 'undefined') ? SHARED_CONFIG.UNIFIED_CONTROLLER : null;
    return (uc && uc.STORM_SOLAR_KWH_THRESHOLD > 0) ? uc.STORM_SOLAR_KWH_THRESHOLD : null;
}

function extraTooltipLines(day) {
    const lines = [day.desc];
    if (day.modelNote) lines.push(day.modelNote);
    if (day.precipProb !== null && day.precipProb > 0) lines.push(`💧 Precip chance: ${day.precipProb}%`);
    if (day.extended) lines.push('Extended outlook — lower confidence');
    return lines;
}

function tooltipTitle(days) {
    return items => {
        const d = days[items[0].dataIndex];
        return `${d.name}${d.dateLabel ? ' — ' + d.dateLabel : ''}`;
    };
}

// Storm days get red labels, rain amber, extended-outlook days dimmed
function forecastXScale(days) {
    return {
        ticks: {
            color: ctx => {
                const d = days[ctx.index];
                if (!d) return '#888';
                if (d.severity === 'storm') return '#ff6b6b';
                if (d.severity === 'rain') return '#ffc800';
                return d.extended ? '#64748f' : '#87ceeb';
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

// Two stacked charts, one column per day (same style as the daily production
// charts): temperature as floating low→high bars, predicted production below it.
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
    const labels = days.map(d => [d.icon, d.name, d.dateLabel || '']);

    // Y axis padded just beyond the coldest low / hottest high, rounded to 5°
    const lows = days.map(d => d.low !== null ? d.low : d.high);
    const highs = days.map(d => d.high !== null ? d.high : d.low);
    const yMin = Math.floor((Math.min(...lows.filter(v => v !== null)) - 5) / 5) * 5;
    const yMax = Math.ceil((Math.max(...highs.filter(v => v !== null)) + 5) / 5) * 5;

    if (weatherTempChartObj) weatherTempChartObj.destroy();
    weatherTempChartObj = new Chart(document.getElementById('weatherTempChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: days.map((d, i) => lows[i] !== null ? [lows[i], highs[i]] : null),
                backgroundColor: days.map(d => hexToRgba(tempBarColor(d.high), 0.7)),
                borderColor: days.map(d => tempBarColor(d.high)),
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
                            return `High ${d.high !== null ? d.high + '°' : '--'}   Low ${d.low !== null ? d.low + '°' : '--'}`;
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
    if (days.every(d => d.predictedKwh == null)) {
        // NWS fallback has no radiation data, so there is nothing to convert to kWh —
        // hide the column rather than draw an empty axis
        document.getElementById('weatherSolarChartCol').style.display = 'none';
        return;
    }
    // Bars are all one colour now (the solar yellow used by the production charts) —
    // "how good a solar day is this" is carried by bar HEIGHT in kWh, which is the honest
    // encoding. It used to be carried by a green/amber/red colour ramp on sunshine %.
    const threshold = stormKwhThreshold();
    const maxKwh = Math.max(...days.map(d => d.predictedKwh || 0), threshold || 0);

    weatherSolarChartObj = new Chart(document.getElementById('weatherSolarChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: days.map(d => d.predictedKwh),
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
                            return d.predictedKwh !== null
                                ? `Predicted: ${d.predictedKwh.toFixed(1)} kWh`
                                : 'Predicted: --';
                        },
                        afterLabel: item => {
                            const d = days[item.dataIndex];
                            const lines = extraTooltipLines(d);
                            if (threshold !== null && d.predictedKwh !== null && d.predictedKwh < threshold)
                                lines.unshift(`⚡ Below ${threshold} kWh — cars would pre-charge to 100%`);
                            if (d.solarPct !== null) lines.unshift(`${d.solarPct}% of daylight with sunshine`);
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
        const days = await fetchOpenMeteoDays();
        await whenLaidOut(container);
        renderForecast(container, days);
    } catch (error) {
        console.warn('Open-Meteo 16-day forecast unavailable, falling back to NWS:', error);
        try {
            const days = await fetchNwsDays();
            await whenLaidOut(container);
            renderForecast(container, days);
        } catch (fallbackError) {
            console.warn('Weather forecast unavailable:', fallbackError);
            container.innerHTML = '<div style="color: #b0c4de;">Forecast unavailable</div>';
        }
    }
}

document.addEventListener('DOMContentLoaded', loadWeatherForecast);
