// Single source of truth for settings used by BOTH the dashboard and the C#
// collector job. The dashboard loads this as a plain <script> (must come before
// config.js); the C# job extracts the object literal below and parses it as JSON
// (SharedConfig.cs). Because of that JSON parsing, keep property names quoted and
// values JSON-compatible — // line comments and trailing commas are fine.
const SHARED_CONFIG = {
    // How often the Azure container collector samples data (minutes). Drives the
    // dashboard's refresh scheduling, the downsampling of chart points, and the
    // spacing of the solar forecast dots so they all match the real cadence.
    "DATA_INTERVAL_MINUTES": 15,

    // Battery capacities in kWh
    "BATTERY_CAPACITIES": {
        "MODEL_3": 52.4,        // Model 3 Standard Range Plus
        "MODEL_X": 100,         // Model X
        "POWERWALL": 13.5       // Tesla Powerwall
    },

    // Prediction tuning constants (validated by backtest against ~80 days of
    // collected data). Used by prediction-generator.js for the "Battery Levels
    // Today" chart and by ChargeAutomationManager.cs, whose C# port of that
    // prediction decides the once-per-day solar-surplus charge trigger.
    "PREDICTION_CONFIG": {
        "PROFILE_DAYS": 7,              // prior days used to build solar/load profiles
        "SLOTS_PER_DAY": 96,            // 15-minute slots in a day
        "MAX_POWERWALL_RATE_KW": 5,     // Powerwall max charge/discharge rate
        "LOAD_BLEND_MINUTES": 120,      // fade from live measured load into the historical profile
        "RECENT_LOAD_MINUTES": 45,      // window for smoothing the current house load
        "GRID_DECAY_MINUTES": 60,       // fade out the current grid import (snapshot only describes right now)
        "SOLAR_SCALE_WINDOW_HOURS": 3,  // window of today's solar used to estimate weather vs profile
        "MIN_EV_CHARGE_KW": 1.2,        // below ~5A the car won't charge at all
        "DEFAULT_EV_CHARGE_LIMIT": 85,  // cars normally charge to 85% (raised from 80% on 2026-07-20)
        "DEFAULT_WALL_CONNECTOR_KW": 6, // fallback wall connector power (24A x 249V)
        "WALL_CONNECTOR_VOLTAGE": 249   // home wall connector voltage, for amps -> kW conversion
    },

    // Solar-surplus charge automation thresholds. Used by
    // ChargeAutomationManager.cs to decide the once-per-day start/stop commands,
    // and by prediction-generator.js to mirror those decisions in the "Battery
    // Levels Today" forecast so the chart shows what the automation will do.
    "CHARGE_AUTOMATION": {
        "HIGH_POWERWALL_CHARGE_KW": 4.8,       // Powerwall absorbing (nearly) all it can -> solar about to be wasted
        "LOW_POWERWALL_CHARGE_KW": 1.5,        // lower trigger bar when the Powerwall is nearly full
        "NEARLY_FULL_PERCENT": 95,             // "nearly full" for the low trigger bar
        "MIN_SOLAR_HOURS_LEFT": 3.0,           // don't start a charge without this much useful solar left
        "STOP_MIN_IMPROVEMENT_PERCENT": 2.0    // don't interrupt a charge for less predicted Powerwall gain than this
    }
};
