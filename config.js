// Configuration - Update this URL to your Azure Blob Storage public URL
const AZURE_BLOB_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/energy-data.json';
const DAILY_SUMMARY_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/daily-summary.json';

let energyData = [];
let dailySummaryData = []; // Per-day kWh totals maintained by the collector job
let solarChart = null;
let batteryChart = null;
let temperatureChart = null;
let dailySolarChart = null;
let hvacChart = null;
let energyCreationChart = null;
let energyUsageChart = null;
let lastDataTimestamp = null; // Store the timestamp of the last data update

// Battery capacities in kWh — single source of truth in shared-config.js
const BATTERY_CAPACITIES = SHARED_CONFIG.BATTERY_CAPACITIES;

// Collector sampling cadence (minutes) — single source of truth in shared-config.js
const DATA_INTERVAL_MINUTES = SHARED_CONFIG.DATA_INTERVAL_MINUTES;
