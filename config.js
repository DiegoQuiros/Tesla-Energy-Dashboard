// Configuration - Update this URL to your Azure Blob Storage public URL
const AZURE_BLOB_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/energy-data.json';
const DAILY_SUMMARY_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/daily-summary.json';

let energyData = [];
let dailySummaryData = []; // Per-day kWh totals maintained by the collector job
let solarChart = null;
let batteryChart = null;
let temperatureChart = null;
let dailySolarChart = null;
let energyCreationChart = null;
let energyUsageChart = null;
let lastDataTimestamp = null; // Store the timestamp of the last data update

// Battery capacities in kWh
const BATTERY_CAPACITIES = {
    MODEL_3: 52.4, // kWh - Model 3 Standard Range Plus
    MODEL_X: 100, // kWh - Model X
    POWERWALL: 13.5 // kWh - Tesla Powerwall
};
