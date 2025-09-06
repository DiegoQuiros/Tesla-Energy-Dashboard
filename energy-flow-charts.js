function updateEnergyFlowCharts(latest) {
    // Update the house visualization
    updateEnergyFlowHouse(latest);
}

// Update the energy flow house visualization when data changes
function updateEnergyFlowHouse(latest) {
    // Update solar in the sun icon
    const solarPower = latest.SolarPowerKw || 0;
    document.getElementById('flowSolarValue').textContent = `${solarPower.toFixed(1)} kW`;

    // Update sun brightness based on solar production
    const sunIcon = document.querySelector('.sun-icon');
    if (sunIcon) {
        const brightness = Math.min(1, solarPower / 10);
        const opacity = 0.4 + (brightness * 0.6);
        sunIcon.style.opacity = opacity;
        sunIcon.style.boxShadow = `0 0 ${20 + brightness * 30}px rgba(255, 193, 7, ${0.3 + brightness * 0.5})`;
    }

    // Change Model 3 color when charging
    const model3Car = document.getElementById('model3Card');
    if (latest.Model3IsCharging) {
        model3Car.style.background = 'linear-gradient(135deg, #39833c 0%, #225e25 100%)';
        model3Car.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.6)';
    } else {
        /*model3Car.style.background = 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)';*/
        model3Car.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
    }

    // Change Model X color when charging
    const modelXCar = document.getElementById('modelXCard');
    if (latest.ModelXIsCharging) {
        modelXCar.style.background = 'linear-gradient(135deg, #39833c 0%, #225e25 100%)';
        modelXCar.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.6)';
    } else {
        /*modelXCar.style.background = 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)';*/
        modelXCar.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
    }

    // Update Powerwall
    const batteryPower = latest.BatteryPowerKw || 0;
    document.getElementById('flowPowerwallValue').textContent =
        `${Math.abs(batteryPower).toFixed(1)} kW • ${(latest.BatteryPercentage || 0).toFixed(0)}%`;

    // Update Powerwall unit color based on charging/discharging
    const powerwallUnit = document.querySelector('.powerwall-unit');
    const powerwallNode = document.querySelector('.flow-powerwall-node');

    if (batteryPower < 0) {
        // Charging
        powerwallUnit.style.background = 'linear-gradient(180deg, #4caf50 0%, #2e7d32 100%)';
        powerwallUnit.style.borderColor = '#66bb6a';
        powerwallUnit.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.6)';
        powerwallNode.style.borderColor = '#00cc00';
        powerwallNode.style.background = 'rgba(0, 204, 0, 0.15)';
    } else if (batteryPower > 0) {
        // Discharging
        powerwallUnit.style.background = 'linear-gradient(180deg, #ff9800 0%, #f57c00 100%)';
        powerwallUnit.style.borderColor = '#ffb74d';
        powerwallUnit.style.boxShadow = '0 4px 12px rgba(255, 152, 0, 0.6)';
        powerwallNode.style.borderColor = '#ff9800';
        powerwallNode.style.background = 'rgba(255, 152, 0, 0.15)';
    } else {
        // Idle
        powerwallUnit.style.background = 'linear-gradient(180deg, #4caf50 0%, #2e7d32 100%)';
        powerwallUnit.style.borderColor = '#66bb6a';
        powerwallUnit.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.4)';
        powerwallNode.style.borderColor = '#00cc00';
        powerwallNode.style.background = 'rgba(0, 204, 0, 0.15)';
    }

    // Calculate home consumption
    const model3ChargingPower = (latest.Model3IsCharging && latest.Model3ChargerPowerKw) ? latest.Model3ChargerPowerKw : 0;
    const modelXChargingPower = (latest.ModelXIsCharging && latest.ModelXChargerPowerKw) ? latest.ModelXChargerPowerKw : 0;
    const totalVehicleCharging = model3ChargingPower + modelXChargingPower;

    let thermostatPower = 0;
    if (latest.ThermostatIsOnline && latest.ThermostatStatus && latest.ThermostatStatus !== 'OFF') {
        thermostatPower = latest.ThermostatIsActivelyRunning ? 5.6 : 0.9;
    }

    const loadPower = latest.LoadPowerKw || 0;
    const housePower = Math.max(0, loadPower - totalVehicleCharging - thermostatPower);

    document.getElementById('flowHomeValue').textContent = `${housePower.toFixed(1)} kW`;

    // Grid display
    const gridPower = latest.GridPowerKw || 0;
    document.getElementById('flowGridValue').textContent = `${Math.abs(gridPower).toFixed(1)} kW`;

    const gridNode = document.querySelector('.flow-grid-node');
    const gridLabel = document.getElementById('flowGridLabel');
    const electricalTower = document.querySelector('.electrical-tower');

    if (gridPower > 0.1) {
        gridNode.style.borderColor = '#ff6b35';
        gridNode.style.background = 'rgba(255, 107, 53, 0.15)';
        gridLabel.textContent = 'IMPORTING';
        electricalTower.style.filter = 'brightness(1.2) drop-shadow(0 0 10px rgba(255, 107, 53, 0.5))';
    } else if (gridPower < -0.1) {
        gridNode.style.borderColor = '#00ff88';
        gridNode.style.background = 'rgba(0, 255, 136, 0.15)';
        gridLabel.textContent = 'EXPORTING';
        electricalTower.style.filter = 'brightness(1.2) drop-shadow(0 0 10px rgba(0, 255, 136, 0.5))';
    } else {
        gridNode.style.borderColor = '#4a9eff';
        gridNode.style.background = 'rgba(74, 158, 255, 0.15)';
        gridLabel.textContent = 'GRID';
        electricalTower.style.filter = 'brightness(1)';
    }
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