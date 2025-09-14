// Battery Level Simulation System
class BatterySimulator {
    constructor() {
        this.simulationSettings = {
            Model3Amps: 0, // 0 means not charging
            ModelXAmps: 0, // 0 means not charging
            isActive: false
        };

        // Vehicle charging specifications
        this.chargingSpecs = {
            Model3: {
                minAmps: 5,
                maxAmps: 32,
                voltage: 249,
                batteryCapacity: BATTERY_CAPACITIES.MODEL_3
            },
            ModelX: {
                minAmps: 7,
                maxAmps: 48, // Model X typically supports higher amperage
                voltage: 249,
                batteryCapacity: BATTERY_CAPACITIES.MODEL_X
            }
        };

        this.createSimulationUI();
        this.bindEvents();
        console.log('Battery Simulator initialized');
    }

    createSimulationUI() {
        // Find the battery chart container
        const batteryContainer = document.getElementById('batteryChartContainer');
        if (!batteryContainer) {
            console.error('Battery chart container not found');
            return;
        }

        // Create simulation controls container
        const simulatorContainer = document.createElement('div');
        simulatorContainer.id = 'batterySimulator';
        simulatorContainer.className = 'battery-simulator-container';

        simulatorContainer.innerHTML = `
            <div class="simulator-header">
                <h4>🔮 Charging Simulation</h4>
                <button id="simulatorToggle" class="simulator-toggle-btn" title="Toggle simulation mode">
                    <span>Enable Simulation</span>
                </button>
            </div>
            <div id="simulatorControls" class="simulator-controls" style="display: none;">
                <div class="vehicle-controls">
                    <div class="vehicle-control-group">
                        <label class="vehicle-label">
                            <span class="vehicle-icon">🚗</span>
                            <span class="vehicle-name">Model 3</span>
                        </label>
                        <div class="charging-control">
                            <label class="charging-checkbox">
                                <input type="checkbox" id="model3ChargingEnabled" />
                                <span class="checkmark"></span>
                                <span>Charging</span>
                            </label>
                            <div class="amps-control">
                                <label for="Model3Amps">Amps:</label>
                                <input type="range" id="Model3Amps" 
                                       min="${this.chargingSpecs.Model3.minAmps}" 
                                       max="${this.chargingSpecs.Model3.maxAmps}" 
                                       value="${this.chargingSpecs.Model3.minAmps}"
                                       step="1" disabled />
                                <span id="Model3AmpsValue" class="amps-value">${this.chargingSpecs.Model3.minAmps}A</span>
                                <span id="Model3PowerValue" class="power-value">${this.calculatePower(this.chargingSpecs.Model3.minAmps, this.chargingSpecs.Model3.voltage)}kW</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="vehicle-control-group">
                        <label class="vehicle-label">
                            <span class="vehicle-icon">🚙</span>
                            <span class="vehicle-name">Model X</span>
                        </label>
                        <div class="charging-control">
                            <label class="charging-checkbox">
                                <input type="checkbox" id="modelXChargingEnabled" />
                                <span class="checkmark"></span>
                                <span>Charging</span>
                            </label>
                            <div class="amps-control">
                                <label for="ModelXAmps">Amps:</label>
                                <input type="range" id="ModelXAmps" 
                                       min="${this.chargingSpecs.ModelX.minAmps}" 
                                       max="${this.chargingSpecs.ModelX.maxAmps}" 
                                       value="${this.chargingSpecs.ModelX.minAmps}"
                                       step="1" disabled />
                                <span id="ModelXAmpsValue" class="amps-value">${this.chargingSpecs.ModelX.minAmps}A</span>
                                <span id="ModelXPowerValue" class="power-value">${this.calculatePower(this.chargingSpecs.ModelX.minAmps, this.chargingSpecs.ModelX.voltage)}kW</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="simulation-actions">
                    <button id="applySimulation" class="simulator-btn simulator-btn-primary">
                        Apply Simulation
                    </button>
                    <button id="resetSimulation" class="simulator-btn simulator-btn-secondary">
                        Reset to Actual
                    </button>
                </div>

                <div class="simulation-info">
                    <div class="info-item">
                        <span class="info-label">Total Charging Power:</span>
                        <span id="totalChargingPower" class="info-value">0.0 kW</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Est. Time to 90%:</span>
                        <span id="timeToNinety" class="info-value">--</span>
                    </div>
                </div>
            </div>
        `;

        // Insert the simulator after the chart title but before the chart wrapper
        const chartTitle = batteryContainer.querySelector('h3');
        if (chartTitle) {
            chartTitle.parentNode.insertBefore(simulatorContainer, chartTitle.nextSibling);
        }
    }

    bindEvents() {
        // Toggle simulation mode
        document.getElementById('simulatorToggle')?.addEventListener('click', () => {
            this.toggleSimulationMode();
        });

        // Model 3 controls
        document.getElementById('model3ChargingEnabled')?.addEventListener('change', (e) => {
            this.toggleVehicleCharging('Model3', e.target.checked);
        });

        document.getElementById('Model3Amps')?.addEventListener('input', (e) => {
            this.updateAmpsDisplay('Model3', parseInt(e.target.value));
        });

        // Model X controls
        document.getElementById('modelXChargingEnabled')?.addEventListener('change', (e) => {
            this.toggleVehicleCharging('ModelX', e.target.checked);
        });

        document.getElementById('ModelXAmps')?.addEventListener('input', (e) => {
            this.updateAmpsDisplay('ModelX', parseInt(e.target.value));
        });

        // Action buttons
        document.getElementById('applySimulation')?.addEventListener('click', () => {
            this.applySimulation();
        });

        document.getElementById('resetSimulation')?.addEventListener('click', () => {
            this.resetSimulation();
        });
    }

    toggleSimulationMode() {
        const controls = document.getElementById('simulatorControls');
        const toggleBtn = document.getElementById('simulatorToggle');

        if (!controls || !toggleBtn) return;

        this.simulationSettings.isActive = !this.simulationSettings.isActive;

        if (this.simulationSettings.isActive) {
            controls.style.display = 'block';
            toggleBtn.innerHTML = '<span>Disable Simulation</span>';
            toggleBtn.classList.add('active');

            // Initialize controls with current charging states
            this.initializeFromCurrentData();
        } else {
            controls.style.display = 'none';
            toggleBtn.innerHTML = '<span>Enable Simulation</span>';
            toggleBtn.classList.remove('active');

            // Reset to actual data
            this.resetSimulation();
        }
    }

    toggleVehicleCharging(vehiclePrefix, isEnabled) {
        const ampsSlider = document.getElementById(`${vehiclePrefix}Amps`);
        const ampsValue = document.getElementById(`${vehiclePrefix}AmpsValue`);
        const powerValue = document.getElementById(`${vehiclePrefix}PowerValue`);

        if (isEnabled) {
            ampsSlider.disabled = false;
            const amps = parseInt(ampsSlider.value);
            this.simulationSettings[`${vehiclePrefix}Amps`] = amps;

            ampsValue.textContent = amps + 'A';
            powerValue.textContent = `${this.calculatePower(amps, this.chargingSpecs[vehiclePrefix].voltage)}kW`;
        } else {
            ampsSlider.disabled = true;
            this.simulationSettings[`${vehiclePrefix}Amps`] = 0;

            ampsValue.textContent = '0A';
            powerValue.textContent = '0.0kW';
        }

        this.updateTotalPower();
    }

    updateAmpsDisplay(vehiclePrefix, amps) {
        const ampsValue = document.getElementById(`${vehiclePrefix}AmpsValue`);
        const powerValue = document.getElementById(`${vehiclePrefix}PowerValue`);

        if (ampsValue && powerValue) {
            ampsValue.textContent = `${amps}A`;
            powerValue.textContent = `${this.calculatePower(amps, this.chargingSpecs[vehiclePrefix].voltage)}kW`;

            this.simulationSettings[`${vehiclePrefix}Amps`] = amps;
            this.updateTotalPower();
        }
    }

    updateTotalPower() {
        const model3Power = this.simulationSettings.Model3Amps > 0 ?
            this.calculatePower(this.simulationSettings.Model3Amps, this.chargingSpecs.Model3.voltage) : 0;
        const modelXPower = this.simulationSettings.ModelXAmps > 0 ?
            this.calculatePower(this.simulationSettings.ModelXAmps, this.chargingSpecs.ModelX.voltage) : 0;

        const totalPower = model3Power + modelXPower;

        const totalPowerElement = document.getElementById('totalChargingPower');
        if (totalPowerElement) {
            totalPowerElement.textContent = `${totalPower} kW`;
        }

        // Calculate estimated time to 90%
        this.updateTimeEstimates();
    }

    updateTimeEstimates() {
        if (!energyData || energyData.length === 0) return;

        const latest = energyData[energyData.length - 1];
        const currentModel3Level = latest.Model3Battery || 0;
        const currentModelXLevel = latest.ModelXBattery || 0;

        let timeToNinety = null;

        // Calculate time for Model 3 to reach 90%
        if (this.simulationSettings.Model3Amps > 0 && currentModel3Level < 90) {
            const model3Power = this.calculatePower(this.simulationSettings.Model3Amps, this.chargingSpecs.Model3.voltage);
            const percentageNeeded = 90 - currentModel3Level;
            const kWhNeeded = (percentageNeeded / 100) * this.chargingSpecs.Model3.batteryCapacity;
            const hoursNeeded = kWhNeeded / model3Power;
            timeToNinety = hoursNeeded;
        }

        // Calculate time for Model X to reach 90%
        if (this.simulationSettings.ModelXAmps > 0 && currentModelXLevel < 90) {
            const modelXPower = this.calculatePower(this.simulationSettings.ModelXAmps, this.chargingSpecs.ModelX.voltage);
            const percentageNeeded = 90 - currentModelXLevel;
            const kWhNeeded = (percentageNeeded / 100) * this.chargingSpecs.ModelX.batteryCapacity;
            const hoursNeeded = kWhNeeded / modelXPower;

            // Use the longer time if both vehicles are charging
            timeToNinety = timeToNinety ? Math.max(timeToNinety, hoursNeeded) : hoursNeeded;
        }

        const timeElement = document.getElementById('timeToNinety');
        if (timeElement) {
            if (timeToNinety !== null && timeToNinety > 0) {
                const hours = Math.floor(timeToNinety);
                const minutes = Math.round((timeToNinety - hours) * 60);
                timeElement.textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            } else {
                timeElement.textContent = '--';
            }
        }
    }

    calculatePower(amps, voltage) {
        return ((amps * voltage) / 1000).toFixed(1);
    }

    initializeFromCurrentData() {
        if (!energyData || energyData.length === 0) return;

        const latest = energyData[energyData.length - 1];

        // Initialize Model 3
        const model3Checkbox = document.getElementById('model3ChargingEnabled');
        const model3Slider = document.getElementById('Model3Amps');

        if (latest.Model3IsCharging && latest.Model3ChargeAmps > 0) {
            model3Checkbox.checked = true;
            const amps = Math.max(this.chargingSpecs.Model3.minAmps,
                Math.min(this.chargingSpecs.Model3.maxAmps, latest.Model3ChargeAmps));
            model3Slider.value = amps;
            this.toggleVehicleCharging('Model3', true);
        }

        // Initialize Model X
        const modelXCheckbox = document.getElementById('modelXChargingEnabled');
        const modelXSlider = document.getElementById('ModelXAmps');

        if (latest.ModelXIsCharging && latest.ModelXChargeAmps > 0) {
            modelXCheckbox.checked = true;
            const amps = Math.max(this.chargingSpecs.ModelX.minAmps,
                Math.min(this.chargingSpecs.ModelX.maxAmps, latest.ModelXChargeAmps));
            modelXSlider.value = amps;
            this.toggleVehicleCharging('ModelX', true);
        }
    }

    applySimulation() {
        if (!this.simulationSettings.isActive) return;

        console.log('Applying battery simulation:', this.simulationSettings);

        // Update the battery chart with simulated predictions
        if (typeof createBatteryChart === 'function') {
            const todayData = getTodayDataForCurrentTime();
            createBatteryChart(todayData);
        }

        // Show feedback
        this.showFeedback('Simulation applied successfully!', 'success');
    }

    resetSimulation() {
        // Reset simulation settings
        this.simulationSettings.Model3Amps = 0;
        this.simulationSettings.ModelXAmps = 0;

        // Reset UI controls
        document.getElementById('model3ChargingEnabled').checked = false;
        document.getElementById('modelXChargingEnabled').checked = false;
        this.toggleVehicleCharging('Model3', false);
        this.toggleVehicleCharging('ModelX', false);

        // Regenerate chart with actual data
        if (typeof createBatteryChart === 'function') {
            const todayData = getTodayDataForCurrentTime();
            createBatteryChart(todayData);
        }

        console.log('Simulation reset to actual data');
        this.showFeedback('Reset to actual data', 'info');
    }

    showFeedback(message, type) {
        // Create or update feedback element
        let feedback = document.getElementById('simulatorFeedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.id = 'simulatorFeedback';
            feedback.className = 'simulator-feedback';

            const actions = document.querySelector('.simulation-actions');
            if (actions) {
                actions.parentNode.insertBefore(feedback, actions.nextSibling);
            }
        }

        feedback.textContent = message;
        feedback.className = `simulator-feedback simulator-feedback-${type}`;
        feedback.style.display = 'block';

        // Auto-hide after 3 seconds
        setTimeout(() => {
            feedback.style.display = 'none';
        }, 3000);
    }

    // Get current simulation settings for use in predictions
    getSimulationSettings() {
        return this.simulationSettings;
    }

    // Check if simulation is currently active
    isSimulationActive() {
        return this.simulationSettings.isActive;
    }
}

// Global instance
let batterySimulator = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    // Wait for other components to initialize
    setTimeout(() => {
        batterySimulator = new BatterySimulator();
        window.batterySimulator = batterySimulator; // Make globally available
        console.log('Battery simulator initialized');
    }, 500);
});