// Skip chart animations while scrubbing through history so redraws feel instant
function chartAnimation() {
    return (window.timeNavigator && !window.timeNavigator.isInLiveMode()) ? false : undefined;
}

// Slice a sorted data array to [dayStart, dayEnd] using binary search
function sliceDataRange(sortedData, rangeStart, rangeEnd) {
    const startIdx = TimeNavigator.upperBound(sortedData, new Date(rangeStart.getTime() - 1));
    const endIdx = TimeNavigator.upperBound(sortedData, rangeEnd);
    return sortedData.slice(startIdx, endIdx);
}

function createCharts() {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded');
        return;
    }

    const todayData = getTodayDataForCurrentTime();
    console.log(`Creating charts with ${todayData.length} today's data points`);

    createDailySolarChart();
    createHvacChart();

    if (todayData.length === 0) {
        console.warn('No data for today to display in charts');
        // No battery chart is built on this path, so clear any warning banner
        // left over from a previous render (e.g. stepping back to an empty day)
        updateBatteryAutomationBanner(null);
        return;
    }

    createTemperatureChart(todayData);
    createSolarChart(todayData);
    createBatteryChart(todayData);
}

function createDailySolarChart() {
    const canvas = document.getElementById('dailySolarChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Destroy existing chart
    if (dailySolarChart) {
        dailySolarChart.destroy();
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    cutoff.setHours(0, 0, 0, 0);

    // Integrate power over each sample interval to get kWh per day
    const dailyTotals = new Map();
    for (let i = 0; i < energyData.length; i++) {
        const point = energyData[i];
        const date = convertToPDT(point.LocalTimestamp);
        if (date < cutoff) continue;

        // Interval this sample covers: time until the next sample, capped at
        // 30 minutes so collector outages don't inflate the totals
        let dtHours = 0;
        if (i < energyData.length - 1) {
            dtHours = (convertToPDT(energyData[i + 1].LocalTimestamp) - date) / 3600000;
        }
        dtHours = Math.min(Math.max(dtHours, 0), 0.5);

        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        let entry = dailyTotals.get(key);
        if (!entry) {
            entry = { date: new Date(date.getFullYear(), date.getMonth(), date.getDate()), solarKwh: 0, gridKwh: 0, loadKwh: 0, exportKwh: 0, m3Kwh: 0, mxKwh: 0 };
            dailyTotals.set(key, entry);
        }
        entry.solarKwh += Math.max(0, point.SolarPowerKw || 0) * dtHours;
        entry.gridKwh += Math.max(0, point.GridPowerKw || 0) * dtHours;   // positive = importing
        entry.exportKwh += Math.max(0, -(point.GridPowerKw || 0)) * dtHours; // negative grid = exporting
        entry.loadKwh += Math.max(0, point.LoadPowerKw || 0) * dtHours;
        // EV charging is part of the load; gate by IsCharging so a stale nonzero
        // reading on an idle car doesn't count (matches the collector's aggregation)
        if (point.Model3IsCharging) entry.m3Kwh += Math.max(0, point.Model3ChargerPowerKw || 0) * dtHours;
        if (point.ModelXIsCharging) entry.mxKwh += Math.max(0, point.ModelXChargerPowerKw || 0) * dtHours;
    }

    // Overlay the daily summary blob: authoritative for completed days (it covers
    // history the raw window no longer holds); raw data still provides today's bar
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    for (const s of dailySummaryData) {
        if (!s || !s.Date || s.Date >= todayKey) continue;
        const [y, m, d] = s.Date.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        if (date < cutoff) continue;
        dailyTotals.set(s.Date, {
            date,
            solarKwh: s.SolarKwh || 0,
            gridKwh: s.GridImportKwh || 0,
            exportKwh: s.GridExportKwh || 0,
            loadKwh: s.LoadKwh || 0,
            // Present once the collector/backfill has added per-car fields; 0 until then
            m3Kwh: s.Model3ChargeKwh || 0,
            mxKwh: s.ModelXChargeKwh || 0
        });
    }

    const days = [...dailyTotals.values()].sort((a, b) => a.date - b.date);
    if (days.length === 0) return;

    // Roll the per-day totals up into the year-at-a-glance stat tiles above the chart
    updateDailySolarStats(days);

    const labels = days.map(d => d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const solarData = days.map(d => Math.round(d.solarKwh * 10) / 10);
    const gridData = days.map(d => Math.round(d.gridKwh * 10) / 10);

    dailySolarChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Solar Production (kWh)',
                    data: solarData,
                    backgroundColor: 'rgba(255, 204, 0, 0.7)',
                    borderColor: '#ffcc00',
                    borderWidth: 1
                },
                {
                    label: 'Grid Used (kWh)',
                    data: gridData,
                    backgroundColor: 'rgba(255, 107, 53, 0.7)',
                    borderColor: '#ff6b35',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimation(),
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: context => `${context.dataset.label}: ${context.parsed.y.toFixed(1)} kWh`
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 30
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + ' kWh';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

// Build the "year at a glance" stat tiles above the daily-solar chart from the
// same per-day totals the chart draws, so the numbers always reconcile with the
// bars. `days` is sorted oldest→newest; the last entry is today (still partial).
function updateDailySolarStats(days) {
    const el = document.getElementById('dailySolarStats');
    if (!el) return;
    if (!days || days.length === 0) {
        el.innerHTML = '';
        return;
    }

    let totalSolar = 0, totalGrid = 0, totalExport = 0, totalLoad = 0, totalM3 = 0, totalMX = 0;
    for (const d of days) {
        totalSolar += d.solarKwh || 0;
        totalGrid += d.gridKwh || 0;
        totalExport += d.exportKwh || 0;
        totalLoad += d.loadKwh || 0;
        totalM3 += d.m3Kwh || 0;
        totalMX += d.mxKwh || 0;
    }

    // Self-reliance: share of everything the home consumed that came from solar +
    // Powerwall rather than the grid. Guard against a zero/negative load window.
    const selfReliance = totalLoad > 0
        ? Math.max(0, Math.min(100, (totalLoad - totalGrid) / totalLoad * 100))
        : 0;

    // A day is grid-free when its imported energy is below the noise threshold
    const isGridFree = d => (d.gridKwh || 0) < GRID_FREE_THRESHOLD_KWH;
    const gridFreeDays = days.filter(isGridFree).length;

    // Current run of grid-free days, counting back from the most recent day
    let currentStreak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
        if (!isGridFree(days[i])) break;
        currentStreak++;
    }
    // Longest grid-free run anywhere in the window
    let longestStreak = 0, run = 0;
    for (const d of days) {
        run = isGridFree(d) ? run + 1 : 0;
        if (run > longestStreak) longestStreak = run;
    }

    // Value of the energy the system supplied instead of buying it from the grid
    const estSaved = Math.max(0, totalLoad - totalGrid) * ELECTRICITY_RATE_PER_KWH;
    const gridFreePct = Math.round(gridFreeDays / days.length * 100);

    // Storage term = what came in minus what the home used or exported. It's the net
    // energy the Powerwall absorbed over the window (round-trip + standby losses, plus
    // any small change in charge level) — the amount that balances the flow diagram.
    const storageLoss = (totalSolar + totalGrid) - (totalLoad + totalExport);

    const money = v => '$' + (Math.round(v / 10) * 10).toLocaleString('en-US');
    const dayWord = n => `${n} day${n === 1 ? '' : 's'}`;

    const rangeStart = days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const rangeEnd = days[days.length - 1].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const tile = (accent, label, value, unit, sub) => `
        <div class="energy-stat ${accent}">
            <div class="energy-stat-label">${label}</div>
            <div class="energy-stat-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
            <div class="energy-stat-sub">${sub}</div>
        </div>`;

    // The raw kWh amounts (solar / grid / home / export) now live in the flow diagram
    // below the chart; these five tiles keep the "how independent am I" scorecard.
    const tiles = [
        tile('accent-green hero', 'Self-Reliance', selfReliance.toFixed(1), '%', 'of usage met without the grid'),
        tile('accent-green', 'Grid-Free Days', `${gridFreeDays}<span class="unit"> / ${days.length}</span>`, '', `${gridFreePct}% of days, zero grid`),
        tile('accent-green hero', 'Current Streak', currentStreak, currentStreak === 1 ? ' day' : ' days', 'in a row & counting'),
        tile('accent-green', 'Longest Streak', longestStreak, longestStreak === 1 ? ' day' : ' days', 'best grid-free run'),
        tile('accent-green', 'Est. Saved', money(estSaved), '', `vs. grid @ $${ELECTRICITY_RATE_PER_KWH.toFixed(2)}/kWh`)
    ];

    el.innerHTML =
        `<div class="summary-caption">Last ${dayWord(days.length)} of data &nbsp;•&nbsp; ${rangeStart} – ${rangeEnd}</div>` +
        `<div class="energy-stat-grid">${tiles.join('')}</div>`;

    // Feed the same yearly totals into the Sankey-style energy-flow diagram
    updateEnergyFlowDiagram({
        solar: totalSolar,
        gridImport: totalGrid,
        gridExport: totalExport,
        load: totalLoad,
        model3: totalM3,
        modelX: totalMX,
        loss: storageLoss,
        dayCount: days.length,
        rangeStart,
        rangeEnd
    });
}

// Sankey-style yearly energy-flow diagram: everything that came IN (solar + grid)
// fans through a central total, then OUT to the home, grid export, and the Powerwall
// storage losses. Ribbon and node heights are proportional to kWh, so the picture
// balances by construction and the "losses" node explains the solar-vs-usage gap.
function updateEnergyFlowDiagram(t) {
    const el = document.getElementById('energyFlowDiagram');
    if (!el) return;

    const captionEl = document.getElementById('energyFlowCaption');
    const inTotal = t.solar + t.gridImport;
    if (inTotal <= 0) { el.innerHTML = ''; if (captionEl) captionEl.textContent = ''; return; }

    // Clamp tiny rounding negatives; over a year the battery is a net sink so loss > 0
    const loss = Math.max(0, t.loss);

    // Home load minus each car's charging = the non-EV household base
    const homeBase = Math.max(0, t.load - (t.model3 || 0) - (t.modelX || 0));

    if (captionEl) {
        captionEl.innerHTML =
            `Last ${t.dayCount} days &nbsp;•&nbsp; ${t.rangeStart} – ${t.rangeEnd} &nbsp;•&nbsp; ` +
            `every kWh in (solar + grid) went to the home, the cars, back to the grid, or was lost cycling the Powerwall`;
    }

    const C = {
        solar: '#ffcc00', grid: '#ff6b35', pool: '#8090a6',
        home: '#7e57c2', m3: '#ec407a', mx: '#2196f3', export: '#26c6da', loss: '#ef5350'
    };
    const lossTip = 'Energy lost cycling the Powerwall (round-trip conversion + standby). ' +
        'Not delivered to the home or the cars, and not exported to the grid.';

    // Inflows and outflows as ordered lists (largest first so bars and colors read
    // cleanly); only nonzero flows are drawn. Model 3 / Model X are carved out of the
    // household load, so home + M3 + MX + export + loss still sums to the total in.
    const sources = [
        { name: 'Solar', val: t.solar, color: C.solar },
        { name: 'Grid in', val: t.gridImport, color: C.grid }
    ].filter(s => s.val > 0).sort((a, b) => b.val - a.val);

    const sinks = [
        { name: 'Home', val: homeBase, color: C.home, tip: 'Household load excluding EV charging' },
        { name: 'Model 3', val: t.model3 || 0, color: C.m3, tip: 'Energy delivered to the Model 3' },
        { name: 'Model X', val: t.modelX || 0, color: C.mx, tip: 'Energy delivered to the Model X' },
        { name: 'Exported', val: t.gridExport, color: C.export, tip: 'Surplus solar sent back to the grid' },
        { name: 'Losses', val: loss, color: C.loss, tip: lossTip }
    ].filter(s => s.val > 0).sort((a, b) => b.val - a.val);

    // Canvas geometry (SVG user units; scales responsively via viewBox)
    const W = 960, H = 360, yTop = 62, yBot = 322, barW = 15;
    const leftX = 236, poolX = 470, rightX = 704;
    const usableH = yBot - yTop;
    const scale = usableH / inTotal;
    const r = n => n.toFixed(1);
    const fmt = v => Math.round(v).toLocaleString('en-US');

    // Stack a column's segments from the top, recording each one's y / height / center
    const stack = items => {
        let y = yTop;
        return items.map(it => { const seg = Object.assign({ y, h: it.val * scale, center: y + it.val * scale / 2 }, it); y += it.val * scale; return seg; });
    };
    const src = stack(sources), snk = stack(sinks);

    // Nudge label centers apart to a minimum spacing (small segments would otherwise
    // collide), keeping them within the band; a leader line reconnects a moved label.
    const spread = (centers, minGap) => {
        const a = centers.slice();
        for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] < minGap) a[i] = a[i - 1] + minGap;
        const over = a[a.length - 1] - (yBot - 2);
        if (over > 0) for (let i = 0; i < a.length; i++) a[i] -= over;
        for (let i = a.length - 2; i >= 0; i--) if (a[i + 1] - a[i] < minGap) a[i] = a[i + 1] - minGap;
        if (a[0] < yTop + 2) { const d = yTop + 2 - a[0]; for (let i = 0; i < a.length; i++) a[i] += d; }
        return a;
    };
    const srcLabelY = spread(src.map(s => s.center), 24);
    const snkLabelY = spread(snk.map(s => s.center), 24);

    const ribbon = (color, x1, x2, t1, b1, t2, b2) => {
        const mx1 = x1 + (x2 - x1) * 0.5, mx2 = x2 - (x2 - x1) * 0.5;
        const d = `M${r(x1)},${r(t1)} C${r(mx1)},${r(t1)} ${r(mx2)},${r(t2)} ${r(x2)},${r(t2)} ` +
            `L${r(x2)},${r(b2)} C${r(mx2)},${r(b2)} ${r(mx1)},${r(b1)} ${r(x1)},${r(b1)} Z`;
        return `<path d="${d}" fill="${color}" fill-opacity="0.42"/>`;
    };
    const node = (x, s) =>
        `<rect x="${r(x)}" y="${r(s.y)}" width="${barW}" height="${r(Math.max(s.h, 1))}" rx="3" fill="${s.color}" fill-opacity="0.95">` +
        (s.tip ? `<title>${s.tip}</title>` : '') + `</rect>`;
    const leader = (x1, y1, x2, y2) => Math.abs(y1 - y2) < 3 ? '' :
        `<path d="M${r(x1)},${r(y1)} L${r(x2)},${r(y2)}" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1" fill="none"/>`;
    const label = (x, cy, anchor, name, color, val) =>
        `<text x="${r(x)}" y="${r(cy)}" text-anchor="${anchor}" dominant-baseline="central" font-size="15">` +
        `<tspan fill="${color}" font-weight="600">${name}</tspan> ` +
        `<tspan fill="#ffffff" font-weight="700">${fmt(val)}</tspan>` +
        `<tspan fill="#9aa7bd" font-size="11"> kWh</tspan></text>`;

    // Ribbons: source bar → pool left face (same y-band), pool right face → sink bar
    const ribbons = [
        ...src.map(s => ribbon(s.color, leftX + barW, poolX, s.y, s.y + s.h, s.y, s.y + s.h)),
        ...snk.map(s => ribbon(s.color, poolX + barW, rightX, s.y, s.y + s.h, s.y, s.y + s.h))
    ].join('');

    const nodes = [
        ...src.map(s => node(leftX, s)),
        `<rect x="${r(poolX)}" y="${r(yTop)}" width="${barW}" height="${r(usableH)}" rx="3" fill="${C.pool}" fill-opacity="0.95">` +
        `<title>Total energy through the system: ${fmt(inTotal)} kWh</title></rect>`,
        ...snk.map(s => node(rightX, s))
    ].join('');

    const labels = [
        ...src.map((s, i) => leader(leftX, s.center, leftX - 12, srcLabelY[i]) +
            label(leftX - 12, srcLabelY[i], 'end', s.name, s.color, s.val)),
        ...snk.map((s, i) => leader(rightX + barW, s.center, rightX + barW + 12, snkLabelY[i]) +
            label(rightX + barW + 12, snkLabelY[i], 'start', s.name, s.color, s.val)),
        `<text x="${r(leftX + barW / 2)}" y="42" text-anchor="middle" font-size="11" letter-spacing="1" fill="#8a9bb5">CAME IN</text>`,
        `<text x="${r(rightX + barW / 2)}" y="42" text-anchor="middle" font-size="11" letter-spacing="1" fill="#8a9bb5">WENT TO</text>`,
        `<text x="${r(poolX + barW / 2)}" y="38" text-anchor="middle" font-size="12" fill="#c7d2e0">` +
        `<tspan font-weight="700">${fmt(inTotal)}</tspan> kWh</text>`,
        `<text x="${r(poolX + barW / 2)}" y="${r(yBot + 18)}" text-anchor="middle" font-size="11" letter-spacing="1" fill="#8a9bb5">TOTAL</text>`
    ].join('');

    el.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" ` +
        `aria-label="Yearly energy flow: ${fmt(inTotal)} kWh in; home ${fmt(homeBase)}, Model 3 ${fmt(t.model3 || 0)}, Model X ${fmt(t.modelX || 0)}, exported ${fmt(t.gridExport)}, losses ${fmt(loss)} kWh">` +
        `${ribbons}${nodes}${labels}</svg>`;
}

// Function to create charts for current time navigator state
function createChartsForTime() {
    if (window.timeNavigator) {
        createCharts();
    }
}

function createTemperatureChart(todayData) {
    const ctx = document.getElementById('temperatureChart').getContext('2d');

    // Destroy existing chart
    if (temperatureChart) {
        temperatureChart.destroy();
    }

    // Get yesterday's data relative to current time context
    let currentTime, dataSource;
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        currentTime = window.timeNavigator.getCurrentTime();
        dataSource = window.timeNavigator.getFilteredData();
    } else {
        currentTime = new Date();
        dataSource = energyData;
    }

    const yesterday = new Date(currentTime);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    const yesterdayData = sliceDataRange(dataSource, yesterday, endOfYesterday);

    // Filter data down to the collector's sampling cadence
    const filteredData = todayData.filter((point, index) => {
        if (index === 0) return true; // Always include first point

        const date = convertToPDT(point.LocalTimestamp);
        return date.getMinutes() % DATA_INTERVAL_MINUTES === 0; // e.g. :00, :15, :30, :45
    });

    const filteredYesterdayData = yesterdayData.filter((point, index) => {
        if (index === 0) return true; // Always include first point

        const date = convertToPDT(point.LocalTimestamp);
        return date.getMinutes() % DATA_INTERVAL_MINUTES === 0; // e.g. :00, :15, :30, :45
    });

    const timeLabels = filteredData.map(point => {
        const date = convertToPDT(point.LocalTimestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    });

    const outdoorTemps = filteredData.map(point =>
        (point.WeatherTemperatureF && point.WeatherTemperatureF > -50) ? point.WeatherTemperatureF : null
    );

    // Yesterday's temperature data
    const outdoorTempsYesterday = filteredYesterdayData.map(point =>
        (point.WeatherTemperatureF && point.WeatherTemperatureF > -50) ? point.WeatherTemperatureF : null
    );

    // Generate simple forecast for remaining hours (only for outdoor temperature) - only in live mode
    const now = window.timeNavigator && !window.timeNavigator.isInLiveMode()
        ? window.timeNavigator.getCurrentTime()
        : new Date();

    // Create forecast points to fill the rest of the day until 11:59 PM - only in live mode
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59);

    currentTime = new Date(now);
    // Start from the next 15-minute interval
    currentTime.setMinutes(Math.ceil(currentTime.getMinutes() / 15) * 15, 0, 0);

    while (currentTime <= endOfDay) {
        // Simple forecast: cooler at night, warmer during day
        const hour = currentTime.getHours();
        let tempAdjustment = 0;
        if (hour >= 6 && hour <= 18) {
            // Daytime: slightly warmer
            tempAdjustment = Math.sin((hour - 6) / 12 * Math.PI) * 4;
        } else {
            // Nighttime: cooler
            tempAdjustment = -3;
        }

        timeLabels.push(currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
        outdoorTemps.push(null);

        // Move to next 15-minute interval
        currentTime.setMinutes(currentTime.getMinutes() + 15);
    }

    const datasets = [
        // Yesterday's data (darker shades, thinner lines)
        {
            label: 'Outdoor Temperature (Yesterday)',
            data: outdoorTempsYesterday,
            borderColor: '#cc9900', // Darker shade of yellow
            backgroundColor: 'rgba(204, 153, 0, 0.05)',
            tension: 0.4,
            borderWidth: 2, // 25% thinner than 3
            pointRadius: 1.5, // 25% smaller than 2
            pointBackgroundColor: '#cc9900',
            spanGaps: true
        },
        // Today's data
        {
            label: 'Outdoor Temperature',
            data: outdoorTemps,
            borderColor: '#ffcc00',
            backgroundColor: 'rgba(255, 204, 0, 0.1)',
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 2,
            pointBackgroundColor: '#ffcc00',
            spanGaps: true
        }
    ];

    temperatureChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimation(),
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff'
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 12
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + '°F';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

// Heat-pump / HVAC chart: indoor temp + heat/cool setpoints across the day (12am–11:59pm),
// with outdoor temp for context. Reads Bryant thermostat fields written by the collector.
function createHvacChart() {
    const canvas = document.getElementById('hvacChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (hvacChart) {
        hvacChart.destroy();
    }

    // Resolve the current time context (live vs. history scrubbing)
    let currentTime, dataSource;
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        currentTime = window.timeNavigator.getCurrentTime();
        dataSource = window.timeNavigator.getFilteredData();
    } else {
        currentTime = new Date();
        dataSource = energyData;
    }

    const dayStart = new Date(currentTime);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(currentTime);
    dayEnd.setHours(23, 59, 59, 999);

    const dayData = sliceDataRange(dataSource || [], dayStart, dayEnd);

    // Thin to the collector's sampling cadence, matching the other day charts
    const filteredData = dayData.filter((point, index) => {
        if (index === 0) return true;
        return convertToPDT(point.LocalTimestamp).getMinutes() % DATA_INTERVAL_MINUTES === 0;
    });

    const timeLabels = filteredData.map(point =>
        convertToPDT(point.LocalTimestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );

    const pos = (v) => (typeof v === 'number' && v > 0) ? v : null;
    const indoorTemps = filteredData.map(p => pos(p.ThermostatCurrentTempF));
    const heatSetpoints = filteredData.map(p => pos(p.ThermostatHeatSetpointF));
    const coolSetpoints = filteredData.map(p => pos(p.ThermostatCoolSetpointF));
    // Prefer the heat pump's own outdoor sensor; fall back to the weather feed
    const outdoorTemps = filteredData.map(p =>
        pos(p.ThermostatOutdoorTempF) ??
        ((p.WeatherTemperatureF && p.WeatherTemperatureF > -50) ? p.WeatherTemperatureF : null)
    );

    updateHvacStats(filteredData, dayData);

    // Show only the setpoint relevant to the current mode: Cool mode hides the
    // heat setpoint, any other mode hides the cool setpoint.
    const latestPoint = filteredData.length ? filteredData[filteredData.length - 1] : {};
    const currentMode = latestPoint.ThermostatMode || latestPoint.ThermostatSystemModeRaw || '';
    const isCoolMode = /cool/i.test(currentMode);

    const datasets = [];
    if (isCoolMode) {
        datasets.push({
            label: 'Cool Setpoint',
            data: coolSetpoints,
            borderColor: '#42a5f5',
            backgroundColor: 'rgba(66, 165, 245, 0.08)',
            borderWidth: 2,
            stepped: true,
            pointRadius: 0,
            spanGaps: true
        });
    } else {
        datasets.push({
            label: 'Heat Setpoint',
            data: heatSetpoints,
            borderColor: '#ff7043',
            backgroundColor: 'rgba(255, 112, 67, 0.08)',
            borderWidth: 2,
            stepped: true,
            pointRadius: 0,
            spanGaps: true
        });
    }
    datasets.push(
        {
            label: 'Indoor Temperature',
            data: indoorTemps,
            borderColor: '#26c6da',
            backgroundColor: 'rgba(38, 198, 218, 0.1)',
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 2,
            pointBackgroundColor: '#26c6da',
            spanGaps: true
        },
        {
            label: 'Outdoor Temperature',
            data: outdoorTemps,
            borderColor: '#ffcc00',
            backgroundColor: 'rgba(255, 204, 0, 0.05)',
            tension: 0.4,
            borderWidth: 2,
            borderDash: [5, 4],
            pointRadius: 0,
            spanGaps: true
        }
    );

    hvacChart = new Chart(ctx, {
        type: 'line',
        data: { labels: timeLabels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimation(),
            plugins: {
                legend: { labels: { color: '#ffffff' } }
            },
            scales: {
                x: {
                    ticks: { color: '#888', maxTicksLimit: 12 },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                y: {
                    ticks: {
                        color: '#888',
                        callback: function (value) { return value + '°F'; }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        }
    });
}

// Populate the HVAC stat grid and header summary from the most recent thermostat reading
function updateHvacStats(filteredData, dayData) {
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    const statsEl = document.getElementById('hvacStats');
    const summaryEl = document.getElementById('hvacSummary');

    // Latest online reading of the day, else the most recent reading overall
    const source = dayData && dayData.length ? dayData : [];
    let latest = null;
    for (let i = source.length - 1; i >= 0; i--) {
        if (source[i].ThermostatIsOnline) { latest = source[i]; break; }
    }
    if (!latest && source.length) latest = source[source.length - 1];

    const online = !!(latest && latest.ThermostatIsOnline);
    if (statsEl) statsEl.classList.toggle('hvac-offline', !online);

    if (!online) {
        ['hvacMode', 'hvacStatus', 'hvacIndoor', 'hvacHumidity', 'hvacOutdoor', 'hvacHeatSet',
            'hvacCoolSet', 'hvacFan', 'hvacHold', 'hvacAirflow', 'hvacFilter', 'hvacCoolingKwh',
            'hvacHpHeatKwh', 'hvacFanKwh', 'hvacEfficiency'].forEach(id => set(id, '--'));
        if (summaryEl) summaryEl.textContent = latest ? 'Offline' : 'No data';
        return;
    }

    const temp = (v) => (typeof v === 'number' && v > 0) ? `${Math.round(v)}°F` : '--';
    const kwh = (v) => (typeof v === 'number') ? `${v.toFixed(1)} kWh` : '--';
    const num = (v, suffix) => (typeof v === 'number' && v > 0) ? `${Math.round(v)}${suffix}` : '--';

    const titleCase = (s) => (typeof s === 'string' && s.length)
        ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const mode = latest.ThermostatMode || latest.ThermostatSystemModeRaw || '--';
    const status = titleCase(latest.ThermostatConditioning || latest.ThermostatActivity ||
        latest.ThermostatStatus || (latest.ThermostatIsActivelyRunning ? 'Running' : 'Idle'));

    set('hvacMode', mode);
    set('hvacStatus', status);
    set('hvacIndoor', temp(latest.ThermostatCurrentTempF));
    set('hvacHumidity', num(latest.ThermostatHumidity, '%'));
    set('hvacOutdoor', temp(latest.ThermostatOutdoorTempF ||
        (latest.WeatherTemperatureF > -50 ? latest.WeatherTemperatureF : 0)));
    set('hvacHeatSet', temp(latest.ThermostatHeatSetpointF));
    set('hvacCoolSet', temp(latest.ThermostatCoolSetpointF));

    // Only the setpoint relevant to the current mode is shown: Cool mode hides
    // the Heat Set tile, any other mode hides the Cool Set tile.
    const inCoolMode = /cool/i.test(mode);
    const toggleTile = (id, show) => {
        const el = document.getElementById(id);
        const tile = el ? el.closest('.hvac-stat') : null;
        if (tile) tile.style.display = show ? '' : 'none';
    };
    toggleTile('hvacHeatSet', !inCoolMode);
    toggleTile('hvacCoolSet', inCoolMode);
    set('hvacFan', latest.ThermostatFanMode || '--');
    set('hvacHold', latest.ThermostatHoldActive ? 'On' : 'Off');
    set('hvacAirflow', num(latest.ThermostatAirflowCfm, ' CFM'));
    set('hvacFilter', num(latest.ThermostatFilterLevelPercent, '%'));
    set('hvacCoolingKwh', kwh(latest.ThermostatCoolingKwhToday));
    set('hvacHpHeatKwh', kwh(latest.ThermostatHpHeatKwhToday));
    set('hvacFanKwh', kwh(latest.ThermostatFanKwhToday));

    const rating = (v) => (typeof v === 'number' && v > 0)
        ? (Math.round(v * 10) / 10).toString() : '--';
    set('hvacEfficiency', `${rating(latest.ThermostatSeer)} / ${rating(latest.ThermostatHspf)}`);

    if (summaryEl) {
        const zone = latest.ThermostatZoneName ? `${latest.ThermostatZoneName}: ` : '';
        const setpoint = /cool/i.test(mode) ? latest.ThermostatCoolSetpointF
            : /heat/i.test(mode) ? latest.ThermostatHeatSetpointF
                : latest.ThermostatTargetTempF;
        summaryEl.textContent =
            `${zone}${temp(latest.ThermostatCurrentTempF)} → ${temp(setpoint)} (${mode})`;
    }
}

function createSolarChart(todayData) {
    const ctx = document.getElementById('solarChart').getContext('2d');

    // Destroy existing chart
    if (solarChart) {
        solarChart.destroy();
    }

    // Get yesterday's data relative to current time context
    let currentTime, dataSource;
    if (window.timeNavigator && !window.timeNavigator.isInLiveMode()) {
        currentTime = window.timeNavigator.getCurrentTime();
        dataSource = window.timeNavigator.getFilteredData();
    } else {
        currentTime = new Date();
        dataSource = energyData;
    }

    const yesterday = new Date(currentTime);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    const yesterdayData = sliceDataRange(dataSource, yesterday, endOfYesterday);

    updateSolarKwhStats(todayData, dataSource, currentTime);

    // Get all solar data (not filtered by time) for both days to find meaningful start/end points
    const allTodayData = todayData;
    const allYesterdayData = yesterdayData;

    // Function to find meaningful solar start point (last 0kW before production begins)
    function findSolarStartPoint(data) {
        if (data.length === 0) return null;

        // Sort data by time
        const sortedData = data.sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));

        // Find the last 0kW point before production starts
        for (let i = 0; i < sortedData.length - 1; i++) {
            const currentPower = Math.max(0, sortedData[i].SolarPowerKw || 0);
            const nextPower = Math.max(0, sortedData[i + 1].SolarPowerKw || 0);

            if (currentPower === 0 && nextPower > 0) {
                const date = convertToPDT(sortedData[i].LocalTimestamp);
                return (date.getHours() - 6) * 60 + date.getMinutes(); // Minutes since 6am
            }
        }

        return null; // No start point found
    }

    // Function to find meaningful solar end point (first 0kW where production ends)
    function findSolarEndPoint(data) {
        if (data.length === 0) return null;

        // Sort data by time
        const sortedData = data.sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));

        // Find the first point where solar drops to 0 and stays 0 for the rest of the day
        for (let i = 0; i < sortedData.length; i++) {
            const solarPower = Math.max(0, sortedData[i].SolarPowerKw || 0);

            if (solarPower === 0) {
                // Check if this is after some production (not initial zeros)
                const hasHadProduction = sortedData.slice(0, i).some(point => Math.max(0, point.SolarPowerKw || 0) > 0);

                if (hasHadProduction) {
                    // Check if all remaining points are also 0
                    const remainingPoints = sortedData.slice(i);
                    const allZero = remainingPoints.every(point => Math.max(0, point.SolarPowerKw || 0) === 0);

                    if (allZero) {
                        const date = convertToPDT(sortedData[i].LocalTimestamp);
                        return (date.getHours() - 6) * 60 + date.getMinutes(); // Minutes since 6am
                    }
                }
            }
        }

        return null; // No end point found
    }

    // Find start and end points for both datasets
    const todayStartPoint = findSolarStartPoint(allTodayData);
    const todayEndPoint = findSolarEndPoint(allTodayData);
    const yesterdayStartPoint = findSolarStartPoint(allYesterdayData);
    const yesterdayEndPoint = findSolarEndPoint(allYesterdayData);

    // Determine the overall start and end times for the chart
    let chartStartMinute = null;
    let chartEndMinute = null;

    // Use the earliest start point and latest end point from both days
    if (todayStartPoint !== null && yesterdayStartPoint !== null) {
        chartStartMinute = Math.min(todayStartPoint, yesterdayStartPoint);
    } else if (todayStartPoint !== null) {
        chartStartMinute = todayStartPoint;
    } else if (yesterdayStartPoint !== null) {
        chartStartMinute = yesterdayStartPoint;
    }

    if (todayEndPoint !== null && yesterdayEndPoint !== null) {
        chartEndMinute = Math.max(todayEndPoint, yesterdayEndPoint);
    } else if (todayEndPoint !== null) {
        chartEndMinute = todayEndPoint;
    } else if (yesterdayEndPoint !== null) {
        chartEndMinute = yesterdayEndPoint;
    }

    // Fallback to reasonable defaults if no meaningful points found
    if (chartStartMinute === null) chartStartMinute = 0; // 6:00 AM
    if (chartEndMinute === null) chartEndMinute = 14 * 60; // 8:00 PM

    // Forecast solar for the rest of today using the prediction engine's 7-day
    // median per-slot profile scaled by today's weather (same model as the kWh
    // header estimate), truncated where the sun goes down.
    let predictedPowerAt = null;
    let predictionStartMinute = null;
    let predictionEndMinute = null;
    if (todayData.length > 0 &&
        typeof buildDailyProfiles === 'function' && typeof computeSolarScale === 'function') {
        const profiles = buildDailyProfiles(dataSource, currentTime);
        const solarScale = computeSolarScale(todayData, profiles.solar, currentTime);
        const slots = PREDICTION_CONFIG.SLOTS_PER_DAY;
        const slotMinutes = (24 * 60) / slots;

        // Profile value at a chart minute (minutes since 6am), linearly
        // interpolated between 15-min slot midpoints so the dots don't step
        const profilePowerAt = function (minute) {
            const pos = (minute + 360) / slotMinutes - 0.5;
            const s0 = Math.min(slots - 1, Math.max(0, Math.floor(pos)));
            const s1 = Math.min(slots - 1, s0 + 1);
            const frac = Math.min(1, Math.max(0, pos - s0));
            return Math.max(0, (profiles.solar[s0] * (1 - frac) + profiles.solar[s1] * frac) * solarScale);
        };

        // Start the forecast at the last measured point (not wall-clock now, which
        // can lag it) and anchor it there: fade the offset between the last measured
        // power and the profile over the first 45 minutes so the dots continue the
        // line instead of stepping up or down.
        const sortedToday = [...todayData].sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));
        const lastPoint = sortedToday[sortedToday.length - 1];
        const lastDate = convertToPDT(lastPoint.LocalTimestamp);
        predictionStartMinute = (lastDate.getHours() - 6) * 60 + lastDate.getMinutes();
        const anchorOffset = Math.max(0, lastPoint.SolarPowerKw || 0) - profilePowerAt(predictionStartMinute);
        const ANCHOR_FADE_MINUTES = 45;

        predictedPowerAt = function (minute) {
            const fade = Math.max(0, 1 - (minute - predictionStartMinute) / ANCHOR_FADE_MINUTES);
            return Math.max(0, profilePowerAt(minute) + anchorOffset * fade);
        };

        // Find where predicted production ends (sunset) and truncate there
        for (let minute = predictionStartMinute; minute <= 18 * 60; minute += 5) {
            if (profilePowerAt(minute) > 0.05) predictionEndMinute = minute;
        }
        if (predictionEndMinute !== null && predictionEndMinute > predictionStartMinute) {
            chartEndMinute = Math.max(chartEndMinute, predictionEndMinute);
        } else {
            predictedPowerAt = null; // sun is already down, nothing left to forecast
        }
    }

    // Filter data to meaningful time range and convert to time-of-day
    const todayTimeData = allTodayData
        .map(point => {
            const date = convertToPDT(point.LocalTimestamp);
            const minutesSince6am = (date.getHours() - 6) * 60 + date.getMinutes();
            return {
                minutes: minutesSince6am,
                power: Math.max(0, point.SolarPowerKw || 0)
            };
        })
        .filter(d => d.minutes >= chartStartMinute && d.minutes <= chartEndMinute);

    const yesterdayTimeData = allYesterdayData
        .map(point => {
            const date = convertToPDT(point.LocalTimestamp);
            const minutesSince6am = (date.getHours() - 6) * 60 + date.getMinutes();
            return {
                minutes: minutesSince6am,
                power: Math.max(0, point.SolarPowerKw || 0)
            };
        })
        .filter(d => d.minutes >= chartStartMinute && d.minutes <= chartEndMinute);

    // Create time labels for the meaningful range (5-minute intervals)
    const timeLabels = [];
    const todaySolarPowerData = [];
    const yesterdaySolarPowerData = [];
    const predictedSolarPowerData = [];

    for (let minute = Math.floor(chartStartMinute / 5) * 5; minute <= chartEndMinute; minute += 5) {
        // Convert minutes back to time format
        const hour = Math.floor(minute / 60) + 6;
        const min = minute % 60;

        // Handle negative hours (before 6am) and hours beyond 24
        let displayHour = hour;
        let ampm = 'AM';

        if (hour < 0) {
            displayHour = 12 + hour; // e.g., -1 becomes 11 PM previous day
            ampm = 'PM';
        } else if (hour === 0) {
            displayHour = 12;
            ampm = 'AM';
        } else if (hour < 12) {
            displayHour = hour;
            ampm = 'AM';
        } else if (hour === 12) {
            displayHour = 12;
            ampm = 'PM';
        } else {
            displayHour = hour - 12;
            ampm = 'PM';
        }

        const timeLabel = `${displayHour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')} ${ampm}`;
        timeLabels.push(timeLabel);

        // Find closest today data point (within 2 minutes)
        const todayMatch = todayTimeData.find(d => Math.abs(d.minutes - minute) <= 2);
        todaySolarPowerData.push(todayMatch ? todayMatch.power : null);

        // Find closest yesterday data point (within 2 minutes)
        const yesterdayMatch = yesterdayTimeData.find(d => Math.abs(d.minutes - minute) <= 2);
        yesterdaySolarPowerData.push(yesterdayMatch ? yesterdayMatch.power : null);

        // Forecast for the rest of today, truncated at sunset. Only plot a dot
        // every DATA_INTERVAL_MINUTES to match the collector's sampling cadence.
        if (predictedPowerAt && minute > predictionStartMinute && minute <= predictionEndMinute &&
            minute % DATA_INTERVAL_MINUTES === 0) {
            predictedSolarPowerData.push(predictedPowerAt(minute));
        } else {
            predictedSolarPowerData.push(null);
        }
    }

    const datasets = [{
        label: 'Today\'s Solar Production (kW)',
        data: todaySolarPowerData,
        borderColor: '#ffcc00',
        backgroundColor: 'rgba(255, 204, 0, 0.2)',
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 2,
        spanGaps: true
    }];

    // Predicted solar for the rest of today, styled like the Powerwall forecast dots
    if (predictedPowerAt && predictedSolarPowerData.some(val => val !== null)) {
        datasets.push({
            label: '',
            predictionFor: 'Today\'s Solar Production (kW)',
            data: predictedSolarPowerData,
            borderColor: 'transparent', // No connecting lines
            backgroundColor: 'rgba(255, 204, 0, 0.3)',
            pointStyle: 'circle',
            pointRadius: 2,
            pointBorderColor: '#ffcc00',
            pointBackgroundColor: 'rgba(255, 204, 0, 0.5)',
            fill: false,
            showLine: false
        });
    }

    // Only add yesterday's data if we have any
    if (yesterdayTimeData.length > 0) {
        datasets.push({
            label: 'Yesterday\'s Solar Production (kW)',
            data: yesterdaySolarPowerData,
            borderColor: '#888888',
            backgroundColor: 'rgba(136, 136, 136, 0.1)',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 1,
            spanGaps: true
        });
    }

    solarChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimation(),
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff',
                        filter: function (legendItem) {
                            // Hide legend items with empty labels (predicted data)
                            return legendItem.text !== '';
                        }
                    },
                    onClick: function (e, legendItem, legend) {
                        // Toggle the clicked dataset and its prediction dataset together
                        const chart = legend.chart;
                        const idx = legendItem.datasetIndex;
                        const show = !chart.isDatasetVisible(idx);
                        chart.setDatasetVisibility(idx, show);
                        const label = chart.data.datasets[idx].label;
                        chart.data.datasets.forEach((ds, i) => {
                            if (ds.predictionFor === label) {
                                chart.setDatasetVisibility(i, show);
                            }
                        });
                        chart.update();
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 12
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + ' kW';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

// Updates the "X kWh so far / ~Y kWh expected" summary in the solar chart header.
// Produced-so-far integrates today's measured power. The rest-of-day estimate reuses
// the prediction engine's 7-day median per-slot solar profile, scaled by how today's
// recent production compares to that profile (so a cloudy or clear day shifts the
// estimate instead of blindly assuming today matches yesterday).
function updateSolarKwhStats(todayData, dataSource, currentTime) {
    const statsEl = document.getElementById('solarKwhStats');
    if (!statsEl) return;

    if (todayData.length === 0) {
        statsEl.textContent = '';
        return;
    }

    // Integrate measured solar power over each sample interval, capped at
    // 30 minutes so collector outages don't inflate the total
    let producedKwh = 0;
    const sorted = [...todayData].sort((a, b) => convertToPDT(a.LocalTimestamp) - convertToPDT(b.LocalTimestamp));
    for (let i = 0; i < sorted.length - 1; i++) {
        let dtHours = (convertToPDT(sorted[i + 1].LocalTimestamp) - convertToPDT(sorted[i].LocalTimestamp)) / 3600000;
        dtHours = Math.min(Math.max(dtHours, 0), 0.5);
        producedKwh += Math.max(0, sorted[i].SolarPowerKw || 0) * dtHours;
    }

    let remainingKwh = null;
    if (typeof buildDailyProfiles === 'function' && typeof computeSolarScale === 'function') {
        const profiles = buildDailyProfiles(dataSource, currentTime);
        const solarScale = computeSolarScale(todayData, profiles.solar, currentTime);

        const slotMinutes = (24 * 60) / PREDICTION_CONFIG.SLOTS_PER_DAY;
        const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes() + currentTime.getSeconds() / 60;

        remainingKwh = 0;
        for (let s = 0; s < PREDICTION_CONFIG.SLOTS_PER_DAY; s++) {
            const slotStart = s * slotMinutes;
            const slotEnd = slotStart + slotMinutes;
            if (slotEnd <= nowMinutes) continue;
            // Count only the not-yet-elapsed portion of the current slot
            const fraction = slotStart < nowMinutes ? (slotEnd - nowMinutes) / slotMinutes : 1;
            remainingKwh += profiles.solar[s] * solarScale * fraction * (slotMinutes / 60);
        }
    }

    const fmt = kwh => (Math.round(kwh * 10) / 10).toFixed(1);
    if (remainingKwh !== null) {
        statsEl.innerHTML =
            `<span class="kwh-value">${fmt(producedKwh)} kWh</span> so far &nbsp;•&nbsp; ` +
            `~<span class="kwh-value">${fmt(remainingKwh)} kWh</span> to go &nbsp;•&nbsp; ` +
            `~<span class="kwh-value">${fmt(producedKwh + remainingKwh)} kWh</span> total`;
    } else {
        statsEl.innerHTML = `<span class="kwh-value">${fmt(producedKwh)} kWh</span> so far`;
    }
}

// Vertical marker lines where the charge automation is predicted to start or
// stop a car (events supplied by generateBatteryPredictions)
const autoChargeMarkersPlugin = {
    id: 'autoChargeMarkers',
    afterDatasetsDraw(chart) {
        const cfg = chart.options.plugins.autoChargeMarkers;
        if (!cfg || !cfg.events || cfg.events.length === 0) return;
        const { ctx, chartArea, scales } = chart;

        ctx.save();
        cfg.events.forEach((event, i) => {
            const x = scales.x.getPixelForValue(event.chartIndex);
            if (x < chartArea.left || x > chartArea.right) return;

            ctx.strokeStyle = event.color;
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.font = '11px sans-serif';
            const width = ctx.measureText(event.label).width;
            let textX = x + 5;
            if (textX + width > chartArea.right) textX = x - width - 5;
            // Stagger labels vertically so nearby markers stay readable
            const textY = chartArea.top + 14 + (i % 3) * 15;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.fillRect(textX - 3, textY - 11, width + 6, 15);
            ctx.fillStyle = event.color;
            ctx.fillText(event.label, textX, textY);
        });
        ctx.restore();
    }
};

// House load excluding car charging (kW). LoadPowerKw is the whole-home draw
// measured at the Powerwall gateway, so it already includes the heat pump; we
// subtract only the cars' charger power. Implausible charger readings (e.g. a
// Supercharger session away from home reporting >20 kW) are ignored so they
// don't wrongly deflate the house load.
function houseLoadExcludingCars(point) {
    const load = Math.max(0, point.LoadPowerKw || 0);
    let cars = 0;
    const m3 = point.Model3ChargerPowerKw || 0;
    const mx = point.ModelXChargerPowerKw || 0;
    if (point.Model3IsCharging && m3 > 0 && m3 <= 20) cars += m3;
    if (point.ModelXIsCharging && mx > 0 && mx <= 20) cars += mx;
    return Math.max(0, load - cars);
}

// Finds the evening "crossover": the last time in the day solar can no longer
// cover the house load (heat pump included, cars excluded), after which the
// Powerwall must discharge to run the house. Combines today's actual data with
// the rest-of-day prediction so the marker works whether the crossover has
// already happened or is still ahead. Returns { chartIndex, time } (chartIndex
// may be fractional, interpolated between samples) or null if there is no such
// crossover (e.g. solar never exceeds the house load).
//
// Crucially this must NOT be fooled by curtailment: once the Powerwall is full
// the inverter throttles production down toward the house load (or toward
// whatever a charging car draws), so the recorded SolarPowerKw collapses even
// though the panels could still cover the house — that made the marker land far
// too early (e.g. 5:13 PM on a day the Powerwall actually held 100% until 6 PM).
// So the measured side treats any slot where the Powerwall is full and NOT
// discharging as "still covered", and the predicted side uses the DELIVERABLE
// (uncurtailed) solar rather than the curtailed produced line.
function computeSolarLoadCrossover(todayData, predictions, actualDataCount) {
    const solar = [];
    const load = [];
    const times = [];

    // Actual, measured portion of the day
    todayData.forEach(p => {
        const l = houseLoadExcludingCars(p);
        const measured = Math.max(0, p.SolarPowerKw || 0);
        // Powerwall full, not discharging, and not leaning on grid import ⇒ the house
        // is running on solar and production is merely curtailed; the low reading isn't
        // a real deficit. (The grid guard excludes the rare full-but-idle slot where the
        // grid, not solar, covers a deficit — that IS past the crossover.)
        const stillCovered = (p.BatteryPercentage || 0) >= 99.5 &&
            (p.BatteryPowerKw || 0) < 0.3 && (p.GridPowerKw || 0) < 0.5;
        solar.push(stillCovered ? Math.max(measured, l) : measured);
        load.push(l);
        times.push(convertToPDT(p.LocalTimestamp));
    });

    // Predicted remainder (aligned with the prediction datasets on the x-axis).
    // Use deliverable (uncurtailed) solar — the produced forecast's evening tail is
    // the curtailed median profile and crosses the load far too early.
    const predSolar = predictions.deliverableSolar || predictions.solar || [];
    const predLoad = predictions.houseLoad || [];
    const predTimes = predictions.times || [];
    for (let j = 0; j < predSolar.length; j++) {
        solar.push(predSolar[j]);
        load.push(predLoad[j]);
        times.push(predTimes[j] || null);
    }

    // Walk the day and keep the LAST surplus->deficit transition (the evening
    // crossover). Morning ramp-ups are deficit->surplus and are skipped.
    let result = null;
    for (let i = 0; i < solar.length - 1; i++) {
        if (solar[i] == null || load[i] == null || solar[i + 1] == null || load[i + 1] == null) continue;
        const d0 = solar[i] - load[i];
        const d1 = solar[i + 1] - load[i + 1];
        if (d0 >= 0 && d1 < 0) {
            const frac = d0 / (d0 - d1); // 0..1 where solar meets load between i and i+1
            const chartIndex = i + frac;
            let time = null;
            if (times[i] && times[i + 1]) {
                time = new Date(times[i].getTime() + frac * (times[i + 1].getTime() - times[i].getTime()));
            } else {
                time = times[i] || times[i + 1];
            }
            result = { chartIndex, time };
        }
    }
    return result;
}

// Vertical marker at the evening solar/house-load crossover (see
// computeSolarLoadCrossover). Drawn as an amber line with a sun label.
const solarCrossoverPlugin = {
    id: 'solarCrossover',
    afterDatasetsDraw(chart) {
        const cfg = chart.options.plugins.solarCrossover;
        const marker = cfg && cfg.marker;
        if (!marker) return;
        const { ctx, chartArea, scales } = chart;

        // Interpolate the pixel X for a possibly-fractional category index
        const i0 = Math.floor(marker.chartIndex);
        const x0 = scales.x.getPixelForValue(i0);
        const x1 = scales.x.getPixelForValue(i0 + 1);
        const x = x0 + (marker.chartIndex - i0) * (x1 - x0);
        if (x < chartArea.left || x > chartArea.right) return;

        const color = '#ffcc33';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        const timeText = marker.time
            ? marker.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : '';
        const label = `☀︎ = 🏠 ${timeText}`;
        ctx.font = '11px sans-serif';
        const width = ctx.measureText(label).width;
        let textX = x + 5;
        if (textX + width > chartArea.right) textX = x - width - 5;
        const textY = chartArea.bottom - 8;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(textX - 3, textY - 11, width + 6, 15);
        ctx.fillStyle = color;
        ctx.fillText(label, textX, textY);
        ctx.restore();
    }
};

// Charge-automation health warning shown INSIDE the battery chart (a charge_stop
// that failed or is blocked by its cooldown needs manual action). Rendered as an
// overlay pinned to the top of the chart's plot area so it reads as part of the
// chart, not a separate box above it. pointer-events:none keeps the legend and
// canvas underneath clickable. warning = { severity, message } or null to hide.
function updateBatteryAutomationBanner(warning) {
    const wrapper = document.querySelector('#batteryChartContainer .chart-wrapper');
    if (!wrapper) return;
    let banner = document.getElementById('batteryAutomationWarning');
    if (!warning) {
        if (banner) banner.remove();
        return;
    }
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'batteryAutomationWarning';
    }
    // Keep it inside the chart wrapper even if the chart was rebuilt/moved
    if (banner.parentElement !== wrapper) wrapper.appendChild(banner);
    banner.className = 'automation-warning ' +
        (warning.severity === 'critical' ? 'automation-warning-critical' : 'automation-warning-caution');
    banner.textContent = '⚠️ ' + warning.message;
}

// Remembers the user's show/hide selection per line across chart rebuilds
// (mode switches and periodic refreshes destroy and recreate the chart).
// Keyed by a stable identity ("today:Powerwall", "yesterday:Model 3", ...).
const batteryDayVisibility = {};

// Stable visibility key for a battery dataset, independent of transient label
// suffixes like " (Yesterday)" / " (Simulated)". Predictions share their
// parent line's key so they restore together.
function batteryVisKey(ds) {
    if (ds.dayGroup === 'yesterday') {
        return 'yesterday:' + ds.label.replace(' (Yesterday)', '');
    }
    const base = (ds.predictionFor || ds.label).replace(' (Simulated)', '');
    return 'today:' + base;
}

function createBatteryChart(todayData) {
    const ctx = document.getElementById('batteryChart').getContext('2d');

    // Destroy existing chart, but first remember which lines are shown/hidden
    // so the selection survives the rebuild.
    if (batteryChart) {
        batteryChart.data.datasets.forEach((ds, i) => {
            if (ds.visKey) batteryDayVisibility[ds.visKey] = batteryChart.isDatasetVisible(i);
        });
        batteryChart.destroy();
    }

    // Anchor "today"/"yesterday" to the time being viewed so Historical mode
    // shows the selected day minus one, not always the real calendar yesterday.
    const currentTime = (window.timeNavigator && !window.timeNavigator.isInLiveMode())
        ? window.timeNavigator.getCurrentTime()
        : new Date();

    // Get yesterday's data (relative to the viewed day)
    const yesterday = new Date(currentTime);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    const yesterdayData = sliceDataRange(energyData, yesterday, endOfYesterday);

    const timeLabels = todayData.map(point => {
        const date = convertToPDT(point.LocalTimestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    });

    const powerwallData = todayData.map(point => point.BatteryPercentage || 0);

    // Function to create vehicle data with proper gap handling
    function createVehicleData(vehiclePrefix, dataSet) {
        const vehicleData = [];
        let lastKnownLevel = null;
        let lastKnownTimestamp = null;

        // First, find the last datapoint before the dataSet to establish starting level
        const dataSetStart = new Date(currentTime);
        if (dataSet === todayData) {
            dataSetStart.setHours(0, 0, 0, 0);
        } else {
            dataSetStart.setTime(yesterday.getTime());
        }

        // Look for last available data before dataSet
        for (let i = energyData.length - 1; i >= 0; i--) {
            const point = energyData[i];
            const pointDate = convertToPDT(point.LocalTimestamp);

            if (pointDate < dataSetStart && point[`${vehiclePrefix}IsAvailable`] && point[`${vehiclePrefix}Battery`] != null) {
                lastKnownLevel = point[`${vehiclePrefix}Battery`];
                lastKnownTimestamp = pointDate;
                break;
            }
        }

        // Process dataSet
        for (let i = 0; i < dataSet.length; i++) {
            const point = dataSet[i];
            const pointDate = convertToPDT(point.LocalTimestamp);

            if (point[`${vehiclePrefix}IsAvailable`] && point[`${vehiclePrefix}Battery`] != null) {
                // Vehicle is available with valid battery data
                lastKnownLevel = point[`${vehiclePrefix}Battery`];
                lastKnownTimestamp = pointDate;
                vehicleData.push(lastKnownLevel);
            } else if (i === 0 && lastKnownLevel !== null && dataSet === todayData) {
                // Special case: first data point of today with no battery data
                // Use the last known level from yesterday to fill the gap
                vehicleData.push(lastKnownLevel);
            } else if (lastKnownLevel !== null) {
                // Vehicle data not available but we have a last known level
                // For gaps, we omit the datapoint (push null)
                vehicleData.push(null);
            } else {
                // No previous data available
                vehicleData.push(null);
            }
        }

        // Always ensure we have a datapoint for the current time (last datapoint)
        if (vehicleData.length > 0 && lastKnownLevel !== null) {
            // Replace the last datapoint with the last known level to ensure continuity
            vehicleData[vehicleData.length - 1] = lastKnownLevel;
        }

        return {
            data: vehicleData,
            lastKnownLevel: lastKnownLevel
        };
    }

    // Create vehicle datasets for yesterday
    const model3YesterdayResult = createVehicleData('Model3', yesterdayData);
    const modelXYesterdayResult = createVehicleData('ModelX', yesterdayData);

    // Create vehicle datasets for today
    const model3Result = createVehicleData('Model3', todayData);
    const modelXResult = createVehicleData('ModelX', todayData);

    // Create yesterday's powerwall data
    const powerwallYesterdayData = yesterdayData.map(point => point.BatteryPercentage || 0);

    // Generate predictions for the rest of the day
    const predictions = generateBatteryPredictions(todayData);
    const actualDataCount = todayData.length;

    // Check if simulation is active
    const isSimulationActive = window.batterySimulator && window.batterySimulator.isSimulationActive();

    const datasets = [
        // Yesterday's Powerwall data (darker shade) - hidden by default
        {
            label: 'Powerwall (Yesterday)',
            dayGroup: 'yesterday',
            hidden: true,
            data: powerwallYesterdayData,
            borderColor: '#006600', // Darker shade of green
            backgroundColor: 'rgba(0, 102, 0, 0.05)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 1
        },
        // Actual Powerwall data
        {
            label: 'Powerwall',
            dayGroup: 'today',
            data: powerwallData,
            borderColor: '#00cc00',
            backgroundColor: 'rgba(0, 204, 0, 0.1)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 2
        },
        // Predicted Powerwall data (no legend)
        {
            label: '',
            dayGroup: 'today',
            predictionFor: 'Powerwall',
            data: Array(actualDataCount).fill(null).concat(predictions.powerwall),
            borderColor: 'transparent', // No connecting lines
            backgroundColor: 'rgba(0, 204, 0, 0.3)',
            pointStyle: 'circle',
            pointRadius: 2,
            pointBorderColor: '#00cc00',
            pointBackgroundColor: 'rgba(0, 204, 0, 0.6)',
            showLine: false
        }
    ];

    // Add yesterday's Model 3 dataset if we have data
    if (model3YesterdayResult.lastKnownLevel !== null) {
        datasets.push({
            label: 'Model 3 (Yesterday)',
            dayGroup: 'yesterday',
            hidden: true,
            data: model3YesterdayResult.data,
            borderColor: '#aa2222', // Darker shade of red
            backgroundColor: 'rgba(170, 34, 34, 0.05)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 1
        });
    }

    // Add Model 3 dataset if we have data
    if (model3Result.lastKnownLevel !== null) {
        const model3Label = isSimulationActive ? 'Model 3 (Simulated)' : 'Model 3';
        const model3BorderColor = isSimulationActive ? '#ff8888' : '#ff4444';
        const model3BackgroundColor = isSimulationActive ? 'rgba(255, 136, 136, 0.2)' : 'rgba(255, 68, 68, 0.1)';
        const model3BorderWidth = isSimulationActive ? 3 : 2;

        datasets.push({
            label: model3Label,
            dayGroup: 'today',
            data: model3Result.data,
            borderColor: model3BorderColor,
            backgroundColor: model3BackgroundColor,
            tension: 0.4,
            borderWidth: model3BorderWidth,
            spanGaps: true, // This will connect across null values
            pointStyle: 'circle',
            pointRadius: 3,
            borderDash: isSimulationActive ? [5, 5] : []
        });

        // Add Model 3 predictions if available
        if (predictions.model3.some(val => val !== null)) {
            const predictionColor = isSimulationActive ? '#ff8888' : '#ff4444';
            const predictionBgColor = isSimulationActive ? 'rgba(255, 136, 136, 0.4)' : 'rgba(255, 68, 68, 0.3)';

            datasets.push({
                label: '',
                dayGroup: 'today',
                predictionFor: model3Label,
                data: Array(actualDataCount).fill(null).concat(predictions.model3),
                borderColor: 'transparent',
                backgroundColor: predictionBgColor,
                pointStyle: isSimulationActive ? 'rectRot' : 'circle',
                pointRadius: isSimulationActive ? 4 : 2,
                pointBorderColor: predictionColor,
                pointBackgroundColor: predictionBgColor,
                showLine: false
            });
        }
    }

    // Add yesterday's Model X dataset if we have data
    if (modelXYesterdayResult.lastKnownLevel !== null) {
        datasets.push({
            label: 'Model X (Yesterday)',
            dayGroup: 'yesterday',
            hidden: true,
            data: modelXYesterdayResult.data,
            borderColor: '#223377', // Darker shade of blue
            backgroundColor: 'rgba(34, 51, 119, 0.05)',
            tension: 0.4,
            borderWidth: 2,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 1
        });
    }

    // Add Model X dataset if we have data
    if (modelXResult.lastKnownLevel !== null) {
        const modelXLabel = isSimulationActive ? 'Model X (Simulated)' : 'Model X';
        const modelXBorderColor = isSimulationActive ? '#7799ff' : '#4477ff';
        const modelXBackgroundColor = isSimulationActive ? 'rgba(119, 153, 255, 0.2)' : 'rgba(68, 119, 255, 0.1)';
        const modelXBorderWidth = isSimulationActive ? 3 : 2;

        datasets.push({
            label: modelXLabel,
            dayGroup: 'today',
            data: modelXResult.data,
            borderColor: modelXBorderColor,
            backgroundColor: modelXBackgroundColor,
            tension: 0.4,
            borderWidth: modelXBorderWidth,
            spanGaps: true,
            pointStyle: 'circle',
            pointRadius: 3,
            borderDash: isSimulationActive ? [5, 5] : []
        });

        // Add Model X predictions if available
        if (predictions.modelX.some(val => val !== null)) {
            const predictionColor = isSimulationActive ? '#7799ff' : '#4477ff';
            const predictionBgColor = isSimulationActive ? 'rgba(119, 153, 255, 0.4)' : 'rgba(68, 119, 255, 0.3)';

            datasets.push({
                label: '',
                dayGroup: 'today',
                predictionFor: modelXLabel,
                data: Array(actualDataCount).fill(null).concat(predictions.modelX),
                borderColor: 'transparent',
                backgroundColor: predictionBgColor,
                pointStyle: isSimulationActive ? 'rectRot' : 'circle',
                pointRadius: isSimulationActive ? 4 : 2,
                pointBorderColor: predictionColor,
                pointBackgroundColor: predictionBgColor,
                showLine: false
            });
        }
    }

    // Restore the user's remembered show/hide selection. Defaults (yesterday
    // hidden, today shown) apply only until the user first toggles something.
    datasets.forEach(ds => {
        ds.visKey = batteryVisKey(ds);
        const saved = batteryDayVisibility[ds.visKey];
        if (saved !== undefined) {
            ds.hidden = !saved;
        }
    });

    // Auto start/stop markers removed 2026-07-23: they mirrored the OLD forecast logic
    // (predetermined stop/start times), but the unified controller is reactive and has no
    // future times to draw. The "🤖 Automation Log" card is the record of what actually
    // happened. (The evening solar/load crossover marker below is unaffected.)
    const markerEvents = [];

    // Evening solar/house-load crossover marker (see computeSolarLoadCrossover)
    const crossover = computeSolarLoadCrossover(todayData, predictions, actualDataCount);

    // Automation health banner — now driven by automation-log.js from the controller's log
    // (fires on a failed car command). Re-apply the latest log-derived warning whenever the
    // chart rebuilds so it survives refreshes.
    updateBatteryAutomationBanner(window.automationLogWarning || null);

    batteryChart = new Chart(ctx, {
        type: 'line',
        plugins: [autoChargeMarkersPlugin, solarCrossoverPlugin],
        data: {
            labels: timeLabels.concat(predictions.labels),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartAnimation(),
            plugins: {
                autoChargeMarkers: {
                    events: markerEvents
                },
                solarCrossover: {
                    marker: crossover
                },
                legend: {
                    labels: {
                        color: '#ffffff',
                        filter: function (legendItem) {
                            // Hide legend items with empty labels (predicted data)
                            return legendItem.text !== '';
                        }
                    },
                    onClick: function (e, legendItem, legend) {
                        // Toggle the clicked dataset and its prediction dataset together
                        const chart = legend.chart;
                        const idx = legendItem.datasetIndex;
                        const show = !chart.isDatasetVisible(idx);
                        chart.setDatasetVisibility(idx, show);
                        const label = chart.data.datasets[idx].label;
                        chart.data.datasets.forEach((ds, i) => {
                            if (ds.predictionFor === label) {
                                chart.setDatasetVisibility(i, show);
                            }
                        });
                        chart.update();
                        // Keep the Yesterday/Today group buttons in sync
                        syncBatteryDayToggleButtons();
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 12
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: '#888',
                        callback: function (value) {
                            return value + '%';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });

    // Reflect the current per-day visibility on the Yesterday/Today toggle buttons
    syncBatteryDayToggleButtons();
}

// --- Yesterday/Today group toggles for the Battery Levels chart ---
// Datasets are tagged with dayGroup ('yesterday' or 'today'). These helpers
// show/hide a whole group at once, while individual lines can still be toggled
// via the legend. Yesterday's lines start hidden (today-only on load).

// Show or hide every dataset belonging to a day group.
function setBatteryDayGroupVisibility(group, show) {
    if (!batteryChart) return;
    batteryChart.data.datasets.forEach((ds, i) => {
        if (ds.dayGroup === group) {
            batteryChart.setDatasetVisibility(i, show);
        }
    });
    batteryChart.update();
    syncBatteryDayToggleButtons();
}

// Flip a day group: if any of its lines are showing, hide them all; else show all.
function toggleBatteryDayGroup(group) {
    if (!batteryChart) return;
    let anyVisible = false;
    batteryChart.data.datasets.forEach((ds, i) => {
        if (ds.dayGroup === group && ds.label !== '' && batteryChart.isDatasetVisible(i)) {
            anyVisible = true;
        }
    });
    setBatteryDayGroupVisibility(group, !anyVisible);
}

// Update the pressed/active look of the toggle buttons to match chart state.
function syncBatteryDayToggleButtons() {
    if (!batteryChart) return;
    const groups = { yesterday: 'batteryYesterdayToggle', today: 'batteryTodayToggle' };
    Object.keys(groups).forEach(group => {
        const btn = document.getElementById(groups[group]);
        if (!btn) return;
        let anyVisible = false;
        batteryChart.data.datasets.forEach((ds, i) => {
            if (ds.dayGroup === group && ds.label !== '' && batteryChart.isDatasetVisible(i)) {
                anyVisible = true;
            }
        });
        btn.classList.toggle('active', anyVisible);
        btn.setAttribute('aria-pressed', anyVisible ? 'true' : 'false');
    });
}

// Wire the toggle buttons once (the chart itself is recreated on every refresh).
document.addEventListener('DOMContentLoaded', function () {
    const yBtn = document.getElementById('batteryYesterdayToggle');
    if (yBtn) yBtn.addEventListener('click', () => toggleBatteryDayGroup('yesterday'));
    const tBtn = document.getElementById('batteryTodayToggle');
    if (tBtn) tBtn.addEventListener('click', () => toggleBatteryDayGroup('today'));
});