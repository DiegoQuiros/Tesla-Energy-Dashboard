function updateEnergyFlowCharts(latest) {
    const solarPower = latest.SolarPowerKw || 0;
    const batteryPower = latest.BatteryPowerKw || 0; // Negative = charging, Positive = discharging
    const gridPower = latest.GridPowerKw || 0; // Negative = exporting, Positive = importing

    // Energy Creation Sources
    const energyCreation = [];
    const creationLabels = [];
    const creationColors = [];

    if (solarPower > 0) {
        energyCreation.push(solarPower);
        creationLabels.push('Solar Panels');
        creationColors.push('#ffcc00');
    }

    if (batteryPower > 0) {
        energyCreation.push(batteryPower);
        creationLabels.push('Powerwall Discharge');
        creationColors.push('#ff4444');
    }

    if (gridPower > 0) {
        energyCreation.push(gridPower);
        creationLabels.push('Grid Import');
        creationColors.push('#ff6b35');
    }

    // Calculate total energy creation
    const totalCreation = solarPower + (batteryPower > 0 ? batteryPower : 0) + (gridPower > 0 ? gridPower : 0);

    // Energy Usage Destinations
    const energyUsage = [];
    const usageLabels = [];
    const usageColors = [];

    // Powerwall charging (negative battery power)
    if (batteryPower < 0) {
        energyUsage.push(Math.abs(batteryPower));
        usageLabels.push('Powerwall Charging');
        usageColors.push('#00cc00');
    }

    // Grid export (negative grid power)
    if (gridPower < 0) {
        energyUsage.push(Math.abs(gridPower));
        usageLabels.push('Grid Export');
        usageColors.push('#00ff88');
    }

    // Thermostat power consumption - only if thermostat status is not OFF
    let thermostatPower = 0;
    if (latest.ThermostatIsOnline && latest.ThermostatStatus && latest.ThermostatStatus !== 'OFF') {
        // Check if actively running (full 5.6kW) or just fan running (~0.9kW for Air Wave)
        if (latest.ThermostatIsActivelyRunning) {
            thermostatPower = 5.6;
        } else {
            // Thermostat is ON but not actively heating/cooling - could be fan running (Air Wave)
            thermostatPower = 0.9;
        }
    }

    if (thermostatPower > 0) {
        energyUsage.push(thermostatPower);
        usageLabels.push('Thermostat');
        usageColors.push('#4a9eff');
    }

    // Model 3 charging
    const model3ChargingPower = (latest.Model3IsCharging && latest.Model3ChargerPowerKw) ? latest.Model3ChargerPowerKw : 0;
    if (model3ChargingPower > 0) {
        energyUsage.push(model3ChargingPower);
        usageLabels.push('Model 3 Charging');
        usageColors.push('#ff6666');
    }

    // Model X charging
    const modelXChargingPower = (latest.ModelXIsCharging && latest.ModelXChargerPowerKw) ? latest.ModelXChargerPowerKw : 0;
    if (modelXChargingPower > 0) {
        energyUsage.push(modelXChargingPower);
        usageLabels.push('Model X Charging');
        usageColors.push('#6677ff');
    }

    // Calculate house power as remainder to ensure total creation = total usage
    const categorizedUsage = Math.abs(batteryPower < 0 ? batteryPower : 0) +
        (gridPower < 0 ? Math.abs(gridPower) : 0) +
        thermostatPower +
        model3ChargingPower +
        modelXChargingPower;

    const housePower = Math.max(0, totalCreation - categorizedUsage);
    if (housePower > 0.1) {
        energyUsage.push(housePower);
        usageLabels.push('House');
        usageColors.push('#9f7aea');
    }

    // Calculate totals (should be equal now)
    const totalCreationSum = energyCreation.reduce((sum, val) => sum + val, 0);
    const totalUsageSum = energyUsage.reduce((sum, val) => sum + val, 0);

    document.getElementById('totalCreation').textContent = `${totalCreationSum.toFixed(1)} kW`;
    document.getElementById('totalUsage').textContent = `${totalUsageSum.toFixed(1)} kW`;

    // Create or update charts
    createEnergyCreationChart(energyCreation, creationLabels, creationColors);
    createEnergyUsageChart(energyUsage, usageLabels, usageColors);
}

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

