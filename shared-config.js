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
        "EV_STARVE_SLOTS": 2,           // 15-min slots below MIN_EV_CHARGE_KW of surplus before a solar-following session is modeled as ending on its own (measured: rare, ~2.5% of session endings, and always within a slot or two of the surplus collapsing)
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
        "POTENTIAL_AFTERNOON_RAMP_HOURS": 1.0,  // hours past solar noon to ramp from 1.0 down to AFTERNOON_FACTOR

        // How far past midnight the Battery Levels chart (and therefore the projection
        // the collector publishes in automation-plan.json) runs, so the overnight drain
        // and the next morning's recharge are on screen. Shared because the C# projector
        // must produce exactly the horizon the dashboard grid renders.
        "BATTERY_CHART_EXTRA_HOURS": 12
    },

    // Overnight forecast settings for the unified controller's night anchor
    // (ChargeAutomationManager.PredictPowerwallOvernight and the 10 PM anchor in
    // ChargeAutomationManager.Controller.cs). Collector-side only — nothing in the
    // dashboard reads this block. The comfort ladder itself (COMFORT_MIN/BASE/MAX_F,
    // OVERNIGHT_FLOOR/RECOVER_PERCENT) lives in UNIFIED_CONTROLLER below; the old
    // start/stop trigger thresholds that used to live here went out with the legacy
    // routines they fed.
    "CHARGE_AUTOMATION": {
        // The night window: the anchor decision fires at the first cycle at/after
        // START_HOUR, and the window is treated as closed by MORNING_END_HOUR.
        "NIGHT_HVAC_START_HOUR": 22,                 // 10 PM — first cycle at/after this makes the night's setpoint decision
        "NIGHT_HVAC_MORNING_END_HOUR": 12,           // hard backstop: the night window closes at noon
        "NIGHT_HVAC_BASELINE_COOL_SETPOINT_F": 78,   // setpoint the overnight load projection is normalised against
        "NIGHT_HVAC_FORECAST_HORIZON_HOUR": 14,      // cap the overnight forecast at 2 PM next day (backstop when 100% is never reached)

        // Setpoint/weather -> load sensitivity for OVERNIGHT projections: the house load
        // a +1 °F cool-setpoint raise sheds, and equally the load an extra °F of outdoor
        // warmth adds (they are the same coefficient — cooling load tracks the difference
        // between them). Applies while cooling can actually run; once the outdoor
        // temperature sits COOLING_GATE_F below the setpoint the heat pump is idle and a
        // degree buys nothing, so the sensitivity is zero.
        //
        // MEASURED 2026-07-25, and it is SMALL — this is the whole-night sustained rate,
        // not the instantaneous one. Three routes agree:
        //   * 51 clean cooling-season nights: pack drop vs mean outdoor temperature =
        //     0.57 ±0.31 pp of pack per °F over a ~9 h night  ->  ~0.015 kW/°F.
        //   * 118-night backtest of the overnight-low estimator, sweeping this constant:
        //     the error minimum is flat from 0.010 to 0.016 (MAE 6.05 pp vs 6.12 raw);
        //     the cooling-season subset optimises at 0.021.
        //   * physics: the clip-model conductance (0.07–0.09 kW/°F instantaneous) times the
        //     measured overnight compressor duty cycle (~25 %) ≈ 0.02 kW/°F.
        //
        // WHY IT IS FLAT rather than graded by hour: the graded form was tested (weighting
        // each slot by an activity curve, so 1 AM counted more than 5 AM) and it was WORSE
        // than raw at every scale, while flat-with-gate was the only form that beat raw.
        // Over a whole night the envelope integrates; the hours do not separate. A degree
        // IS worth much more instantaneously in the afternoon (0.71 ±0.12 kW/°F measured
        // 10:00–20:00) — do NOT use this constant for a daytime decision.
        //
        // CONSEQUENCE worth knowing: at 0.015 kW/°F a degree moves the overnight low by
        // only ~0.9 pp, so the 78→82 °F ladder can shift it ~3.6 pp total. The overnight
        // heat-pump rule cannot rescue a night that is 10 pp short.
        //
        // Supersedes the fixed 0.3-guess NIGHT_HVAC_KW_SAVED_PER_DEGREE and the
        // activity-curve HVAC_RUN_KW_PER_F/OFFSET/RAMP/SOLAR_GAIN that briefly replaced it:
        // that curve was calibrated on the DAYTIME plateau and overstated a night ~20x,
        // which made the overnight-low estimator swing by 20+ pp on a 1 °F difference.
        // Re-fit with scratchpad/backtest_correction.py as more nights accumulate; summer
        // and cool mode only.
        "HVAC_OVERNIGHT_KW_PER_F": 0.015,  // sustained kW of house load per °F of cool setpoint (or of outdoor temp)
        "HVAC_COOLING_GATE_F": 10,         // outdoor this far below the setpoint => heat pump idle => zero sensitivity

        // ── Overnight-low estimator + 10 PM night anchor (2026-07-25) ──
        // Diego's yesterday-delta method widened to N prior nights, and a one-shot
        // "set it at 10 PM and forget it" setpoint decision. Chosen by an exhaustive
        // predictor search over 326 archived nights (aggregates, quantiles, walk-forward
        // ridge/OLS + conformal margins, k-NN analog nights — every family backtested
        // walk-forward, the winner adversarially re-computed):
        //   * median of the last up-to-5 clean prior nights beats last-night-only
        //     (summer MAE ~5.5 vs 6.5 pp) and nothing fancier reliably beats the median —
        //     regression won only by anti-conservative bias on an easier window (audit
        //     rejected it); analog nights lose to plain recency.
        //   * for the DECISION the p90 of those nights' drops ("assume a bad recent
        //     night") sits on the missed/false-alarm Pareto knee: over 73 summer nights,
        //     missed 2 / false-alarm 1 / set-and-forget 69.9% / mean discomfort 0.8 °F.
        //   * forensics: failures are decided BEFORE 10 PM — the median failed night
        //     arrives ~16 pp short vs the 2.7 pp total lever; a perfect oracle prevents
        //     only ~2-3 of 28 summer failures. The setpoint is margin insurance for
        //     near-miss nights (lows 5-10%), not a rescue tool, so the anchor also
        //     FLAGS doomed nights honestly instead of pretending 82 °F saves them.
        // A prior night is used only if it was CLEAN: fully measured, anchor sample
        // present, pack never floored (< 2%), no EV home-charging and no grid import
        // before its low (those pollute or truncate the measured drop).
        "NIGHT_PRIOR_NIGHTS": 5,           // how many clean prior nights the estimator aggregates
        "NIGHT_PRIOR_LOOKBACK_DAYS": 10,   // how far back it may look for them
        "NIGHT_CONSERVATIVE_PCTL": 90,     // decision percentile of the prior-night drops (90 = near-worst)
        "NIGHT_ANCHOR_SETPOINT_F": 79,     // the 10 PM starting setpoint on a normal night (Diego: "cool enough and not too hot")
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

        // Opening draw of a home charging session, per car, in kW — what the car
        // INSISTS on pulling in its first slots even when the sun cannot cover it.
        // MEASURED over 380 archived home-charging starts (Aug 2025 - Jul 2026):
        //   * The clock does not matter. Holding the surplus comparable (3-5 kW) and
        //     splitting by hour gives flat ~2.9-3.9 kW medians across 08:00-16:00 for
        //     both cars — the apparent time-of-day pattern in the raw numbers is the
        //     solar surplus in disguise, so there is deliberately no hour term.
        //   * The draw does not ramp in. Median power at t+0/+15/+30/+45/+60 min is
        //     flat (Model X 3.50/3.60/3.50/3.37/4.11 kW), so the opening slot already
        //     IS the session's rate.
        //   * The car opens at min(what it asks for, what the solar manager allows).
        //     A request at or below ~21 A is granted in full (0 of 62 starts throttled);
        //     32 A / 48 A requests are throttled almost always (204 of 242).
        //   * The throttle tracks the surplus once there IS one (opening amps ÷
        //     surplus-implied amps ~0.9-1.0 above 2 kW of surplus) but does NOT fall to
        //     zero with it: with under 1 kW of surplus the cars still opened at a median
        //     2.49 kW (Model 3, 10 A) and 3.63 kW (Model X, 15 A). THAT is the floor
        //     that drains the Powerwall on an early-morning start.
        // Used by ExpectedStartupDrawKw / StartupInsistKw in ChargeAutomationManager.
        // Controller.cs. Re-measure with the same archive replay if the cars, the wall
        // connector or Tesla's solar-charging behavior change.
        "STARTUP_DRAW_KW": {
            "MODEL_3": 2.5,              // median opening draw with no surplus to follow (~10 A)
            "MODEL_X": 3.6               // median opening draw with no surplus to follow (~15 A)
        },

        // Headroom the solar surplus must have OVER the car's insisted-on opening draw
        // before a start is allowed, covering house load that moves between the decision
        // and the car actually drawing (mainly the heat pump cycling on: measured
        // slot-to-slot house-load steps are p90 +0.54 kW, p95 +1.18 kW).
        // This margin plus STARTUP_DRAW_KW is CONDITION (d) of the controller's start rule
        // (rule 1) — added 2026-07-25, ratified 2026-07-26. It is deliberately part of the
        // spec: grid imports among allowed starts went 8 -> 0 once a start had to fit inside
        // the LIVE surplus. Powerwall-first means a start may never be funded by the pack.
        "START_SURPLUS_MARGIN_KW": 0.5,
        "USER_LOCK_HOURS": 2,            // after a detected MANUAL car start/stop, the automation won't override it for this long
        "AUTO_SETTLE_MINUTES": 30,       // minimum gap after one automated car action before the opposite one (let rates settle / don't instantly restart)
        "MAX_FAILED_ATTEMPTS_PER_DAY": 3,// give up a repeatedly-failing car command after this many tries in a Pacific day
        "LOG_MAX_ENTRIES": 1000,         // cap the automation-log.json ring buffer at this many newest entries

        // ── Curtailment banking: PROPORTIONAL sizing (2026-07-26) ──────────────────
        // Replaces the old "curtailment => jump straight to COMFORT_MIN_F, then snap back
        // to COMFORT_BASE_F" pair, which flapped: the down move was gated on three
        // conditions and the up move on only one, so any single sample losing the
        // justification handed control to the up rule.
        //
        // VERIFIED by a CLOSED-LOOP replay of the shipped C# (called by reflection out of the
        // built assembly, with each decision's own cooling written back onto the load and off
        // the export before the next one reads it) over 178 archived cooling days:
        // 386 writes (2.17/day), 105 banking episodes holding a median 120 min, 277 kWh of
        // otherwise-exported solar recaptured against 28 kWh taken from the pack. For scale,
        // the old rule managed 3 kWh/yr and flapped on every one of its 6 firing days; merely
        // lifting its `charging &&` gate gives 583 writes and 82 flapping days.
        //
        // The rule: convert the solar that has nowhere to go into whole degrees at
        // BANK_KW_PER_F, hold BANK_RESERVE_KW back, and move that many degrees. Leaving
        // some waste deliberately unused is what makes it stick — the justification is
        // still true on the next cycle, so nothing unwinds it.
        //
        // "Solar with nowhere to go" is measured as grid EXPORT plus any remaining pack
        // charge headroom, NOT solar - load. Over the 1,789 archived slots this rule
        // fires in, the pack is full and NOT charging (median BatteryPowerKw 0.00) while
        // the house exports a median 3.76 kW; 95% of those slots can absorb a full
        // degree, 81% two. Because export already nets out our own cooling, the signal is
        // self-correcting — but it must be normalised back to COMFORT_BASE_F (add our own
        // cooling back in) or the rule measures its own output and ratchets.
        //
        // Consequence measured in the same backtest: extra cooling during curtailment is
        // almost entirely paid for by export, not by the pack (277 kWh recaptured vs 28 kWh
        // of pack draw). Cost is comfort: ~1.4 h/cooling day at 76-77 F.
        //
        // NO DWELL TIMER, on purpose. A 45-min one was implemented and then removed: it cost
        // 17 kWh of recaptured solar and ADDED 20 kWh of pack drain, because it held the bank
        // open after the export had already died. The "3-4 writes in an hour" it was
        // suppressing are the ladder walking 78->77->76 in two consecutive cycles plus real
        // cloud transitions — NOT rules fighting. The distinction that matters: across all 65
        // reversals inside an hour, the SMALLEST waste-signal swing between them is 1.52 kW
        // against a 1.06 kW hysteresis band, so every reversal follows a genuine change in
        // conditions. The old flap reversed with nothing changing at all. Diego's call
        // (2026-07-26): 15-minute adjustments are fine, responsiveness is worth more.
        // Do NOT "fix" writes-per-hour by re-adding a clock — measure reversals-without-cause.
        //
        // Sweeps that FAILED, so don't retry them: hysteresis 0.35 -> 1.00 barely moves
        // anything and 1.42 breaks the rule outright (it can never release: 267 kWh of pack
        // drain, 3.6 h/day of cooling); wider smoothing is actively worse (7 samples doubles
        // the busy hours, because a lagging median keeps the cool-down signal alive after the
        // export has gone); requiring 2-3 consecutive confirmations before cooling costs
        // 33 kWh of capture and fixes nothing.
        "BANK_KW_PER_F": 0.71,           // house kW added per °F of cooling, MEASURED 10:00-20:00 (±0.12) — the DAYTIME instantaneous rate, NOT HVAC_OVERNIGHT_KW_PER_F
        "BANK_RESERVE_KW": 0.4,          // waste left deliberately unused so the trigger survives the action (0.4 beat 1.0 on recapture, both equally stable)
        "BANK_HYSTERESIS_KW": 0.35,      // half a degree of slack around each degree boundary, so a noisy sample can't cross back — this, not a dwell timer, is what keeps the rule stable
        "BANK_ENTER_PERCENT": 99,        // engage banking at/above this pack % ...
        "BANK_EXIT_PERCENT": 97,         // ... and stay engaged until it falls below this (the pack crosses 99 between consecutive samples 16% of the time)
        "BANK_SMOOTH_SAMPLES": 3,        // median over this many samples (45 min) of the waste signal — clouds and the fridge move it by more than a degree's worth; do NOT widen (see above)

        // Storm / reduced-solar pre-charge: raise BOTH cars' charge limit to 100% when a
        // solar shortfall is coming (grid-avoidance beats battery-degradation), back to 85%
        // as soon as the forecast is clear. Uses Open-Meteo daily shortwave radiation.
        // STATELESS: recomputed from the forecast every 15-min cycle, so the limit always
        // reflects the CURRENT forecast (no latched mode, no exit debounce — the old
        // STORM_EXIT_CLEAR_HOURS=24 slow-exit was removed 2026-07-25 because a frozen flag
        // held the cars at 100% after the weather cleared).
        "NORMAL_CHARGE_LIMIT": 85,       // everyday car charge-limit ceiling
        "STORM_CHARGE_LIMIT": 100,       // pre-charge ceiling when a shortfall is coming
        "STORM_LOOKAHEAD_DAYS": 3,       // scan this many upcoming days for a shortfall

        // Forecast radiation -> predicted production. Open-Meteo gives a daily
        // shortwave_radiation_sum in MJ/m²; multiplying by the month's factor gives the
        // kWh this array would make that day. CALIBRATED 2026-07-26 against 329 days of
        // collector history — see docs/solar-calibration.md for the method and for how to
        // redo this when more data has accumulated. Index 0 = January.
        //
        // High in winter, low in summer: a tilted array collects proportionally more than
        // a horizontal radiation sensor when the sun is low, and panels lose efficiency as
        // they get hot. Do NOT flatten these into one number — that was the old bug.
        "SOLAR_KWH_PER_MJ_BY_MONTH": [
            2.6351, 2.4800, 2.3500, 2.4351, 2.0496, 2.0723,
            2.0342, 2.1738, 2.3133, 2.5076, 2.3978, 2.4280
        ],

        // Predicted production below this many kWh makes it a shortfall day. 30 was the
        // best precision/recall balance over 320 day/night pairs against "did we import
        // more than 2 kWh overnight" (fires 17% of days, almost all Nov-Feb). Raising it
        // to 35 makes it fire EVERY day in December, i.e. it stops being a forecast and
        // becomes a calendar — don't.
        "STORM_SOLAR_KWH_THRESHOLD": 30
    }
};
