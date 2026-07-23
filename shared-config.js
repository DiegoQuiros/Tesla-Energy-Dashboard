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
    // prediction decides the solar-surplus charge start/stop triggers.
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
        "WALL_CONNECTOR_VOLTAGE": 249,  // home wall connector voltage, for amps -> kW conversion

        // Afternoon delivery factor for the "potential solar" profile the
        // charge-automation STOP side uses (toPotentialSolarProfile). That profile
        // mirrors the strong morning ramp onto the afternoon, but the panels deliver
        // less after solar noon (orientation/temperature asymmetry). Backtesting a
        // full year of afternoon-charging days (where the car keeps solar uncurtailed,
        // so measured solar IS the deliverable amount) showed the raw potential runs
        // ~1.3x actual across the afternoon — roughly constant, not growing — which
        // let the STOP side's latest-safe time slide too late and miss 100% (the
        // 2026-07-21 incident: stopped 5:45 PM, only reached 93%). Scale post-solar-
        // noon potential by AFTERNOON_FACTOR, ramped in linearly over the first
        // RAMP_HOURS past noon (no cliff at noon):
        //   factor = 1 - (1 - AFTERNOON_FACTOR) * min(1, hoursPastSolarNoon / RAMP_HOURS)
        // 0.80 centers the deliverable-solar estimate (~1.0x, a hair optimistic in the
        // 3-5 PM decision window) so the stop lands at the true latest-safe moment —
        // later than a cautious manual stop when the day allows, without missing 100%.
        "POTENTIAL_AFTERNOON_FACTOR": 0.80,     // fraction of the mirrored-morning envelope the panels deliver post-noon
        "POTENTIAL_AFTERNOON_RAMP_HOURS": 1.0   // hours past solar noon to ramp from 1.0 down to AFTERNOON_FACTOR
    },

    // Solar-surplus charge automation thresholds. Used by
    // ChargeAutomationManager.cs to decide the start/stop commands, and by
    // prediction-generator.js to mirror those decisions in the "Battery
    // Levels Today" forecast so the chart shows what the automation will do.
    "CHARGE_AUTOMATION": {
        "HIGH_POWERWALL_CHARGE_KW": 4.8,       // Powerwall absorbing (nearly) all it can -> solar about to be wasted
        "LOW_POWERWALL_CHARGE_KW": 1.5,        // lower trigger bar when the Powerwall is nearly full
        "NEARLY_FULL_PERCENT": 95,             // "nearly full" for the low trigger bar
        "MIN_SOLAR_HOURS_LEFT": 3.0,           // don't start a charge without this much useful solar left
        "STOP_MIN_IMPROVEMENT_PERCENT": 2.0,   // don't interrupt a charge for less predicted Powerwall gain than this
        "STOP_NEAR_FULL_PERCENT": 97,          // near-full tier for the stop decision. The stop side protects a true 100% only when it is actually reachable (stop-now forecast hits it); otherwise the pack ends essentially full regardless, so it protects only this level and lets the car keep soaking surplus the full pack would otherwise curtail. Sits within the model's ~1.5pp forecast noise of 100%, so ordinary evening-load over-prediction no longer trips an aggressive too-early stop (2026-07-22 Model X 4:45 PM incident), while a genuine drain — one where stopping WOULD reach 100% — still triggers a protective stop
        "ACTION_COOLDOWN_HOURS": 2.0,          // a car's auto-start/auto-stop may repeat after this long (was once per day)
        "CROSSOVER_COOL_SETPOINT_F": 80,       // when an auto-stop fires at the crossover, raise a below-80 cool setpoint to this to shed evening HVAC load

        // On a sunny day the car keeps charging off the surplus (which the
        // Powerwall, already full, would otherwise curtail) until this many
        // minutes before the solar/house-load crossover, then it is stopped so
        // the freed solar tops the Powerwall to 100% with margin before sunset
        // and the evening HVAC load is shed (CROSSOVER_COOL_SETPOINT_F). The stop
        // moves earlier than this only when the afternoon can't otherwise refill
        // the Powerwall to 100% by the crossover (the car drains it as solar
        // fades). Replaces the old "reached 100% at some point" test, which let
        // the car bleed the Powerwall down all evening once it had briefly
        // touched 100% at midday.
        "STOP_LOCK_IN_MARGIN_MINUTES": 75
    }
};
