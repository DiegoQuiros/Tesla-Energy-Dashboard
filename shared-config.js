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

        // On a sunny day the car keeps charging off the surplus (which the
        // Powerwall, already full, would otherwise curtail) until this many
        // minutes before the solar/house-load crossover, then it is stopped so
        // the freed solar tops the Powerwall to 100% with margin before sunset
        // (the stop also arms the gentle evening HVAC shed — see the collector's
        // EvaluateEveningHvacAsync). The stop
        // moves earlier than this only when the afternoon can't otherwise refill
        // the Powerwall to 100% by the crossover (the car drains it as solar
        // fades). Replaces the old "reached 100% at some point" test, which let
        // the car bleed the Powerwall down all evening once it had briefly
        // touched 100% at midday.
        "STOP_LOCK_IN_MARGIN_MINUTES": 75,

        // Nightly grid-independence heat-pump routine (ChargeAutomationManager,
        // EvaluateNightlyHvacAsync — collector-side only; not mirrored on the
        // dashboard). Priority is grid independence over cooling: run the heat pump
        // as much as the overnight battery budget allows, but never let the pack
        // drain to where it would have to import from the grid before the next
        // morning's solar refills it.
        //
        // Step 1 — at the first collector cycle at/after START_HOUR each night, pick
        // the DYNAMIC starting cool setpoint: forecast the night at BASELINE_COOL_SETPOINT_F
        // and, if the predicted LOW would fall below MIN_SOC_PERCENT, step the modeled
        // setpoint up 1 °F at a time (to at most MAX_COOL_SETPOINT_F) until the LOW clears
        // the floor — then set that. On a low-charge night (the Powerwall drains from ~100%
        // at the afternoon crossover and is well below full by bedtime) 78 °F could empty
        // the pack, so the start setpoint rises as needed.
        // Step 2 — every STEP_INTERVAL_HOURS after that, re-forecast at the current
        // setpoint; if the LOW dips below MIN_SOC_PERCENT, raise the cool setpoint by 1 °F
        // (up to MAX_COOL_SETPOINT_F). Up-only after the baseline: never lowered again
        // overnight (a raised setpoint is the safe state for grid independence); it resumes
        // on the thermostat's own schedule.
        // DONE — the night's job is finished the moment morning solar production climbs
        // above DONE_SOLAR_KW: the pre-dawn low is well behind us and the pack is recovering
        // ("we made it through the night"), so there's nothing left to protect. This is a
        // cleaner stop than waiting for a full 100% refill (which can be late or never on a
        // cloudy day). The cycle then resets and starts again at START_HOUR the same day.
        "NIGHT_HVAC_START_HOUR": 22,                 // 10 PM — first cycle at/after this starts the routine
        "NIGHT_HVAC_MORNING_END_HOUR": 12,           // hard backstop: window closes at noon if solar never reaches DONE_SOLAR_KW
        "NIGHT_HVAC_DONE_SOLAR_KW": 3,               // morning solar above this => made it through the night, stop for the day
        "NIGHT_HVAC_BASELINE_COOL_SETPOINT_F": 78,   // lowest (coolest) start-of-night setpoint the search begins from
        "NIGHT_HVAC_MAX_COOL_SETPOINT_F": 82,        // max comfortable temperature — never start at, or step to, above this
        "NIGHT_HVAC_STEP_INTERVAL_HOURS": 1,         // re-evaluate (and possibly step up) this often after the baseline
        "NIGHT_HVAC_MIN_SOC_PERCENT": 5,             // keep the overnight forecast LOW at/above this
        "NIGHT_HVAC_FORECAST_HORIZON_HOUR": 14,      // cap the overnight forecast at 2 PM next day (backstop when 100% is never reached)

        // Setpoint -> load sensitivity for the overnight forecast, so the dynamic
        // start-of-night setpoint search AND the hourly step-ups can estimate how much
        // house load each +1 °F above the 78 °F baseline sheds (without it, "model again
        // one degree higher" would return the same LOW and the search would be moot).
        // ROUGH first-order model — calibrate against collected HVAC-vs-load data. Biased
        // conservative: a LOWER kW/°F makes the model credit each degree with less saving,
        // so the search lands on a HIGHER (safer) starting setpoint.
        "NIGHT_HVAC_KW_SAVED_PER_DEGREE": 0.3,       // house-load kW shed per °F above the 78 °F baseline
        "NIGHT_HVAC_MIN_HOUSE_LOAD_KW": 0.3          // non-HVAC overnight floor the modeled load can't drop below
    },

    // Unified energy controller (2026-07-23) — the single reactive controller
    // (ChargeAutomationManager.RunAsync in ChargeAutomationManager.Controller.cs) that
    // REPLACES the old start/stop/evening/nightly routines. Collector-side only; not
    // mirrored on the dashboard chart. Actions are logged to automation-log.json.
    "UNIFIED_CONTROLLER": {
        "TARGET_PERCENT": 97,            // Powerwall "full enough" target; act when BELOW this and discharging
        "OVERNIGHT_FLOOR_PERCENT": 5,    // overnight forecast low must stay at/above this (raise heat pump if not)
        "OVERNIGHT_RECOVER_PERCENT": 15, // step the heat pump back DOWN toward base only when the overnight low is at/above this (dead band vs the 5% floor prevents flapping)
        "CAR_PROTECT_SOC_PERCENT": 50,   // a charging car at/below this SOC is protected — shed the heat pump instead of stopping it
        "COMFORT_MIN_F": 76,             // coolest allowed cool setpoint (only reached when excess solar would otherwise be wasted)
        "COMFORT_BASE_F": 78,            // resting/night cool setpoint — day and night floor for normal operation
        "COMFORT_MAX_F": 82,             // hottest (least cooling) allowed — the survival ceiling the step-ups climb to
        "DRAIN_DEBOUNCE_CYCLES": 2,      // consecutive cycles of "below target AND discharging" before a reactive car stop (rejects a passing cloud)
        "MIN_CAR_KWH": 1,                // a car must be able to take at least this many kWh (headroom below its limit) to be worth starting
        "MIN_SOLAR_KW": 0.1,             // "solar is producing" threshold for allowing a car start (rule: never start with no solar)
        "USER_LOCK_HOURS": 2,            // after a detected MANUAL car start/stop, the automation won't override it for this long
        "AUTO_SETTLE_MINUTES": 30,       // minimum gap after one automated car action before the opposite one (let rates settle / don't instantly restart)
        "MAX_FAILED_ATTEMPTS_PER_DAY": 3,// give up a repeatedly-failing car command after this many tries in a Pacific day
        "LOG_MAX_ENTRIES": 1000,         // cap the automation-log.json ring buffer at this many newest entries

        // Storm / reduced-solar pre-charge: raise BOTH cars' charge limit to 100% when a
        // solar shortfall is coming (grid-avoidance beats battery-degradation), back to 85%
        // once the forecast has been clear a while. Uses Open-Meteo daily shortwave radiation.
        // KILL-SWITCH (2026-07-23): storm/reduced-solar charge-limit management is DISABLED.
        // set_charge_limit currently returns result:true but floors the car to its 50% minimum
        // instead of applying the requested %, and a drizzle weather code (WMO 51/53) was falsely
        // tripping storm mode despite good radiation — so this feature could only drive the cars
        // DOWN to 50%, overriding manual limits every cycle. Flip back to true once set_charge_limit
        // is verified to apply the requested % and the storm trigger is fixed.
        "STORM_CHARGE_LIMIT_ENABLED": false,
        "NORMAL_CHARGE_LIMIT": 85,       // everyday car charge-limit ceiling
        "STORM_CHARGE_LIMIT": 100,       // pre-charge ceiling when a shortfall is coming
        "STORM_LOOKAHEAD_DAYS": 3,       // scan this many upcoming days for a shortfall
        "STORM_SOLAR_MJ_THRESHOLD": 16,  // a day whose shortwave_radiation_sum (MJ/m²) is below this counts as a poor-solar day (a clear summer day here is ~28-30; CALIBRATE)
        "STORM_EXIT_CLEAR_HOURS": 24     // the forecast must stay clear this long before dropping the limit back to 85% (enter fast, exit slow)
    }
};
