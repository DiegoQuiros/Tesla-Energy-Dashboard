
function generateBatteryPredictions(todayData) {
    if (todayData.length === 0) {
        return { labels: [], powerwall: [], model3: [], modelX: [] };
    }

    const latest = todayData[todayData.length - 1];
    const now = convertToPDT(latest.LocalTimestamp);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59);

    const predictions = {
        labels: [],
        powerwall: [],
        model3: [],
        modelX: []
    };

    // Generate 15-minute interval predictions until end of day
    let currentTime = new Date(now);
    currentTime.setMinutes(Math.ceil(currentTime.getMinutes() / 15) * 15, 0, 0); // Round to next 15-minute mark

    // Convert current battery percentage to kWh for Powerwall
    let currentPowerwallKwh = ((latest.BatteryPercentage || 0) / 100) * BATTERY_CAPACITIES.POWERWALL;
    let currentModel3Level = latest.Model3Battery || 0;
    let currentModelXLevel = latest.ModelXBattery || 0;

    // Calculate total power consumption rate including thermostat
    let totalConsumptionKw = 0;

    // Add thermostat consumption only if status is not OFF
    if (latest.ThermostatIsOnline && latest.ThermostatStatus && latest.ThermostatStatus !== 'OFF') {
        if (latest.ThermostatIsActivelyRunning) {
            totalConsumptionKw += 5.6; // Full AC/heating power
        } else {
            totalConsumptionKw += 0.9; // Just fan running (Air Wave)
        }
    }

    // Add vehicle charging if active
    if (latest.Model3IsCharging && latest.Model3ChargerPowerKw) {
        totalConsumptionKw += latest.Model3ChargerPowerKw;
    }
    if (latest.ModelXIsCharging && latest.ModelXChargerPowerKw) {
        totalConsumptionKw += latest.ModelXChargerPowerKw;
    }

    // Add base house consumption (estimated from load power minus known consumers)
    const loadPower = latest.LoadPowerKw || 0;
    const knownConsumption = (latest.ThermostatIsOn && latest.ThermostatIsOnline ?
        (latest.ThermostatIsActivelyRunning ? 5.6 : 0.9) : 0) +
        (latest.Model3IsCharging ? (latest.Model3ChargerPowerKw || 0) : 0) +
        (latest.ModelXIsCharging ? (latest.ModelXChargerPowerKw || 0) : 0);
    const houseBaseConsumption = Math.max(0, loadPower - knownConsumption);
    totalConsumptionKw += houseBaseConsumption;

    // Get current solar and grid input
    const solarPowerKw = latest.SolarPowerKw || 0;
    const gridImportKw = Math.max(0, latest.GridPowerKw || 0);
    const totalEnergyInputKw = solarPowerKw + gridImportKw;

    // Net drain on Powerwall = total consumption - total energy input
    // If positive, Powerwall discharges; if negative, Powerwall charges
    const netPowerwallDrainKw = totalConsumptionKw - totalEnergyInputKw;

    console.log(`Powerwall prediction: Current=${currentPowerwallKwh.toFixed(1)}kWh, Net drain=${netPowerwallDrainKw.toFixed(1)}kW, Total consumption=${totalConsumptionKw.toFixed(1)}kW`);

    while (currentTime <= endOfDay) {
        predictions.labels.push(currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

        // Powerwall prediction based on net energy drain
        if (netPowerwallDrainKw > 0) {
            // Powerwall is discharging to meet demand
            const energyConsumedIn15Min = netPowerwallDrainKw * 0.25; // kW * 0.25 hours = kWh
            currentPowerwallKwh = Math.max(0, currentPowerwallKwh - energyConsumedIn15Min);
        } else if (netPowerwallDrainKw < 0) {
            // Excess energy is charging the Powerwall
            const energyGainedIn15Min = Math.abs(netPowerwallDrainKw) * 0.25;
            currentPowerwallKwh = Math.min(BATTERY_CAPACITIES.POWERWALL, currentPowerwallKwh + energyGainedIn15Min);
        }
        // If netPowerwallDrainKw is 0, no change to Powerwall

        // Convert kWh back to percentage
        const powerwallPercentage = (currentPowerwallKwh / BATTERY_CAPACITIES.POWERWALL) * 100;

        // Vehicle charging predictions (unchanged)
        if (latest.Model3IsCharging && latest.Model3ChargerPowerKw > 0) {
            // Calculate charging rate per 15 minutes
            const chargingRateKw = latest.Model3ChargerPowerKw;
            const percentageGainIn15Min = (chargingRateKw * 0.25 / BATTERY_CAPACITIES.MODEL_3) * 100;
            currentModel3Level = Math.min(100, currentModel3Level + percentageGainIn15Min);
        }

        if (latest.ModelXIsCharging && latest.ModelXChargerPowerKw > 0) {
            const chargingRateKw = latest.ModelXChargerPowerKw;
            const percentageGainIn15Min = (chargingRateKw * 0.25 / BATTERY_CAPACITIES.MODEL_X) * 100;
            currentModelXLevel = Math.min(100, currentModelXLevel + percentageGainIn15Min);
        }

        predictions.powerwall.push(powerwallPercentage);
        predictions.model3.push(latest.Model3IsAvailable ? currentModel3Level : null);
        predictions.modelX.push(latest.ModelXIsAvailable ? currentModelXLevel : null);

        currentTime.setMinutes(currentTime.getMinutes() + 15);
    }

    return predictions;
}
