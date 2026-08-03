// Configuration - Update this URL to your Azure Blob Storage public URL
const AZURE_BLOB_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/energy-data.json';
const DAILY_SUMMARY_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/daily-summary.json';
const AUTOMATION_LOG_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/automation-log.json';
// The unified controller's forward projection of its OWN start/stop rules, republished
// every collector cycle. The battery chart renders these markers instead of re-deciding
// them in JavaScript — see the header of ChargeAutomationManager.Plan.cs.
const AUTOMATION_PLAN_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/automation-plan.json';
// The 16-day weather/solar outlook, fetched from Open-Meteo by the collector and
// republished every cycle. The browser used to call Open-Meteo itself and fall back to
// NWS — which has no radiation data, so the fallback silently dropped the predicted-solar
// chart. See the header of WeatherForecastManager.cs.
const WEATHER_FORECAST_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/weather-forecast.json';
// The LLM-written daily recap, published once per day by AiBriefingManager.cs.
const AI_BRIEFING_URL = 'https://powermanagestorage.blob.core.windows.net/energy-data/ai-briefing.json';
// "Ask the Dashboard" chat API (AiChatServer.cs running as a Container App).
// Empty = card shows a "not configured" message on the public site. A dashboard
// served from localhost falls back to http://localhost:8080 regardless (see
// ai-chat.js), so local F5 testing needs no edit here.
const AI_CHAT_API_URL = 'https://builder-2025-10-18.proudpond-8cd99d0a.westus2.azurecontainerapps.io';

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

// A day counts as "grid-free" when imported grid energy is below this many kWh.
// Not exactly zero: rounding and brief transients can leave a few Wh on an
// otherwise fully self-supplied day.
const GRID_FREE_THRESHOLD_KWH = 0.1;

// Blended residential rate ($/kWh) used only to estimate the dollar value of the
// energy the solar + Powerwall system supplied instead of the grid. Tune to your
// utility's actual all-in rate; it drives the "Est. Saved" tile only.
const ELECTRICITY_RATE_PER_KWH = 0.27;

// Battery capacities in kWh — single source of truth in shared-config.js
const BATTERY_CAPACITIES = SHARED_CONFIG.BATTERY_CAPACITIES;

// Collector sampling cadence (minutes) — single source of truth in shared-config.js
const DATA_INTERVAL_MINUTES = SHARED_CONFIG.DATA_INTERVAL_MINUTES;

// How far past midnight the Battery Levels chart looks. The day the chart shows
// ends at 100%-or-not and then drains all night, so the interesting part of the
// forecast — the overnight low and the next morning's recharge — sits past
// midnight. Drives the chart's grid; the value lives in shared-config.js because
// the C# collector publishes the projection over exactly this horizon. Must be <= 24.
const BATTERY_CHART_EXTRA_HOURS = SHARED_CONFIG.PREDICTION_CONFIG.BATTERY_CHART_EXTRA_HOURS;
