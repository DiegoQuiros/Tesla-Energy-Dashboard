function updateEnergyFlowCharts(latest) {
    // Update the house scene
    updateEnergyFlowHouse(latest);
}

// Scale the fixed 1100x600 scene stage to fill its (responsive) container.
function scaleFlowStage() {
    const viz = document.querySelector('.flow-visualization');
    const stage = document.getElementById('flowStage');
    if (!viz || !stage) return;
    const w = viz.clientWidth;
    if (w > 0) stage.style.transform = `scale(${w / 1100})`;
}

// Cable direction convention: every cable path is drawn FROM the house TO the device.
//   forward (default)  = energy leaving the house  (house -> device)
//   reverse            = energy arriving at the house (device -> house)
// Higher power animates faster (shorter dash cycle).
function setCableFlow(id, active, reverse, kw, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', !!active);
    el.classList.toggle('reverse', !!reverse);
    if (color) el.style.stroke = color;
    if (active) {
        const dur = Math.max(0.45, Math.min(1.5, 1.2 - Math.min(Math.abs(kw) || 0, 10) * 0.09));
        el.style.animationDuration = dur.toFixed(2) + 's';
    }
}

// Update the energy-flow house scene when data changes
function updateEnergyFlowHouse(latest) {
    const solarPower = latest.SolarPowerKw || 0;
    const gridPower = latest.GridPowerKw || 0;       // + importing, - exporting
    const batteryPower = latest.BatteryPowerKw || 0; // - charging, + discharging

    // Per-vehicle charge power (what the cars are drawing right now)
    const m3Charge = (latest.Model3IsCharging && latest.Model3ChargerPowerKw) ? latest.Model3ChargerPowerKw : 0;
    const mxCharge = (latest.ModelXIsCharging && latest.ModelXChargerPowerKw) ? latest.ModelXChargerPowerKw : 0;

    // ---- numeric readouts ----
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setText('flowSolarValue', `${solarPower.toFixed(1)} kW`);
    setText('flowPowerwallValue', `${Math.abs(batteryPower).toFixed(1)} kW`);

    const housePower = Math.max(0, (latest.LoadPowerKw || 0) - m3Charge - mxCharge);
    setText('flowHomeValue', `${housePower.toFixed(1)} kW`);

    setText('flowGridValue', `${Math.abs(gridPower).toFixed(1)} kW`);
    setText('flowGridLabel', gridPower > 0.1 ? 'IMPORTING' : gridPower < -0.1 ? 'EXPORTING' : 'GRID');

    // Sun dims a little at night / when barely producing
    const sunGlow = document.getElementById('sunGlow');
    if (sunGlow) sunGlow.style.opacity = (0.45 + Math.min(1, solarPower / 8) * 0.55).toFixed(2);

    // ---- animated energy flows ----
    const AMBER = '#ffce5c', BLUE = '#7fb2ff', GREEN = '#4dd08a';
    // Solar always flows sun -> house (into the house = reverse)
    setCableFlow('flowSolar', solarPower > 0.05, true, solarPower, AMBER);
    // Grid: importing (grid -> house) = reverse/blue; exporting (house -> grid) = forward/green
    setCableFlow('flowGrid', Math.abs(gridPower) > 0.1, gridPower > 0, gridPower, gridPower > 0 ? BLUE : GREEN);
    // Powerwall: charging (house -> pw) = forward; discharging (pw -> house) = reverse
    setCableFlow('flowPw', Math.abs(batteryPower) > 0.05, batteryPower > 0, batteryPower, GREEN);
    // Cars only ever receive energy (wall -> car = forward)
    setCableFlow('flowCar1', !!latest.Model3IsCharging, false, m3Charge, GREEN);
    setCableFlow('flowCar2', !!latest.ModelXIsCharging, false, mxCharge, GREEN);

    // Keep the scene sized to its container. Deferred to the next frame so it also
    // works on the first update, which runs while #dashboard is still display:none
    // (the element has no width yet until the reveal at the end of updateDashboard).
    requestAnimationFrame(scaleFlowStage);
}

// Keep the scene scaled on load, on resize, and when the dashboard is first revealed.
(function initFlowStageScaling() {
    if (window._flowStageInit) return;
    window._flowStageInit = true;
    const attach = () => {
        const viz = document.querySelector('.flow-visualization');
        if (viz && 'ResizeObserver' in window) new ResizeObserver(scaleFlowStage).observe(viz);
        window.addEventListener('resize', scaleFlowStage);
        scaleFlowStage();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();
})();

function createEnergyCreationChart(data, labels, colors) {
    const ctx = document.getElementById('energyCreationChart').getContext('2d');

    // Destroy existing chart
    if (energyCreationChart) {
        energyCreationChart.destroy();
    }

    if (data.length === 0) {
        // Show empty state
        data = [1];
        labels = ['No Energy Creation'];
        colors = ['#333'];
    }

    energyCreationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#1e1e1e',
                cutout: '70%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#ffffff',
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value.toFixed(1)} kW (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function createEnergyUsageChart(data, labels, colors) {
    const ctx = document.getElementById('energyUsageChart').getContext('2d');

    // Destroy existing chart
    if (energyUsageChart) {
        energyUsageChart.destroy();
    }

    if (data.length === 0) {
        // Show empty state
        data = [1];
        labels = ['No Energy Usage'];
        colors = ['#333'];
    }

    energyUsageChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#1e1e1e',
                cutout: '70%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#ffffff',
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value.toFixed(1)} kW (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}