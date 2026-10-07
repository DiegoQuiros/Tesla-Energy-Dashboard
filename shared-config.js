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
        // Today's weather forecast anchors that scale until the window has seen enough daylight
        // (ComputeSolarScale): scale = w * measured + (1 - w) * forecast, w = E / (E + this), where E
        // is the kWh the solar profile expected over the window's usable samples and forecast =
        // today's predicted kWh (the "Predicted Solar Production" bar) / the POTENTIAL profile's
        // daily total. Median measured weight by hour: 7 AM 0.07, 8 AM 0.19, 10 AM 0.41, noon 0.49,
        // afternoon ~0.4. Without it two dim dawn readings clamped the whole day to 0.3 (2026-09-28
        // 07:30: 14.6 kWh to go on a 49.9 kWh forecast day, day peak 21%). Backtest 2026-04-15..09-27,
        // 8,162 forecasts 05:30-18:00 on Open-Meteo's archived day-of forecasts: pack % MAE to midnight
        // 9.79 -> 7.81 pp (both halves -20%, before 10 AM -26..-29%), bias -1.18 -> +1.54, "reaches 97%
        // today" right in 85.0 -> 92.3% of pre-noon forecasts, 09-06/07 storm 26.0 -> 16.2 (unlike the
        // rejected shrink toward 1, the forecast itself was dark); on the collector's own archived
        // outlooks (09-10..09-27) 12.67 -> 10.31. 10 and 40 score within 0.1 pp; the produced
        // profile's total as the base scores the same MAE with bias +2.21.
        "SOLAR_FORECAST_WEIGHT_KWH": 20,
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

        // Discharge-side conversion loss. The sims used to drain the modeled pack 1:1
        // with the AC net load, but the Powerwall's SOC falls FASTER than it delivers:
        // measured across 45 nights (2026-06-10 → 2026-07-27, 10 PM → 6:15 AM, nights
        // with home EV charging excluded), the SOC drop in kWh ran ~1.16x the delivered
        // load (per-night implied one-way efficiency: median 0.872, IQR 0.82–0.93) —
        // inverter conversion plus gateway/electronics overhead. That made every
        // overnight forecast optimistic: mean error +8.3 pp at 6:15 AM (median +7.9).
        // Model: packRate = acRate / EFFICIENCY − STANDBY while discharging (acRate < 0),
        // untouched while charging (the daytime surplus dwarfs the loss and the pack
        // clamps at 100% anyway). Fit by grid search replaying those 45 nights:
        // 0.92 / 0.10 zeroes the bias (+8.3 → −0.1 pp; MAE 9.6 → 5.5 pp) and the
        // optimum is flat (η 0.90–0.93 × standby 0.08–0.12 all within 0.1 pp), so the
        // physically-shaped pair — ~92% one-way inverter efficiency + ~100 W constant
        // overhead — was chosen over a pure divisor (0.80 alone scores the same but
        // buries the time-proportional overhead in the load-proportional term, which
        // would extrapolate wrong on longer winter nights). Remaining MAE is
        // night-to-night HVAC variance, not bias.
        "POWERWALL_DISCHARGE_EFFICIENCY": 0.92, // AC kWh delivered per SOC kWh drained while discharging
        "POWERWALL_STANDBY_DRAIN_KW": 0.10,     // constant gateway/electronics overhead while discharging
        // Temperature-matched house-load profile (ChargeAutomationManager.BuildDailyProfiles).
        // The load profile used to be the flat mean of the last PROFILE_DAYS days, which silently
        // assumes tonight is as hot as an average recent night. Now every past day in the pool is
        // weighted by how close its daily-mean outdoor temperature was to today's (measured so far,
        // then the 7-day per-slot reference + today's last-3-h anomaly carried forward):
        // w = exp(-0.5 * (|dT| / ANALOG_TEMP_SIGMA_F)^2), so a day 3 F off keeps 61 %, 6 F off 14 %.
        // Backtested 2026-07-21..09-10 (4,691 forecasts, every 15 min, scored to noon next day):
        // MAE 13.00 -> 11.32 pp, within-5-pp 40.8 -> 44.6 %, overnight-low MAE 7.09 -> 5.75;
        // untouched test half (08-12..09-10) 13.88 -> 10.97. SIGMA 2..4 all land within 0.4 pp;
        // do not retune it on the same data. A day needs ANALOG_MIN_DAY_SAMPLES slots with an
        // outdoor reading to count; with no eligible day the flat mean is used. Rejected by the
        // same backtest (don't re-add): shrinking/decaying the weather scale toward 1 (+17 pp on
        // the 09-06/07 storm), per-hour temperature regressions stacked on this (same physics).
        "ANALOG_TEMP_SIGMA_F": 3,
        "ANALOG_POOL_DAYS": 14,                 // how far back look-alike days are taken from (7 was the flat window; 14 measured 0.2 pp better)
        "ANALOG_MIN_DAY_SAMPLES": 48,           // half a day of samples with an outdoor temperature
        "TEMP_ANOMALY_HOURS": 3,                // today's temperature anomaly is the mean over this window and is carried forward
        // Off-grid, a full pack curtails the array: the recorded solar is then the house load, not
        // the sunshine. Samples with the pack at/above this are skipped when building the solar
        // profile AND when judging today's weather against it (the two must match, or a clear
        // full afternoon reads as clouds). The gateway reports no values between 98.5 and 100.
        "FULL_PACK_PERCENT": 99.5,

        // ── Pack at its INTAKE LIMIT (2026-09-26, Diego's 9/25 chart) ──
        // Below full, the pack can still refuse more power: it charges at a flat rate and the
        // inverter curtails the rest of the array, so extra house load is met by solar rising,
        // not by the pack charging slower (9/25 12:15-14:15: a flat 4.23-4.43 kW from 29% to 90%
        // while solar = load + ~4.3). Grid-connected the ceiling is a hard 5.0 kW (p99 5.00 every
        // month); OFF-GRID it sits lower and drifts (p99 5.00 in May, 4.82 Jul, 4.46 Sep; 4.38 above
        // 100°F outdoors), so no fixed kW alone can find it. Detector (IsAtIntakeLimit): off-grid,
        // below FULL_PACK_PERCENT and charging >= INTAKE_LIMIT_KW, OR the last three samples all
        // >= INTAKE_STEADY_MIN_KW and within INTAKE_STEADY_RANGE_KW of each other (a pack with room
        // takes solar − load, which moves with every cloud and appliance; a limited one does not).
        // Grid-connected: charging >= INTAKE_LIMIT_ON_GRID_KW. Scored against 107 unambiguous
        // load-step events since 2026-04-01 (solar covered >= 80% of the step = limited, <= 20% =
        // room): precision 0.90, recall 0.69. Fixed 4.0 kW alone: 0.81 / 0.75; fixed 4.4: 0.92 / 0.42;
        // "within X of a 3-day learned ceiling": 0.66 / 0.73 (rejected).
        // Used for: (1) solar samples taken at the limit are curtailed — skipped by the solar
        // PROFILE like full-pack samples (NOT by the weather scales: skipping them there measured
        // worse, 7.43 -> 7.75 pp); (2) the sims charge the pack no faster than the median rate of
        // at-limit samples over the last INTAKE_CEILING_DAYS (off-grid; grid-connected or fewer
        // than INTAKE_CEILING_MIN_SAMPLES = MAX_POWERWALL_RATE_KW); (3) solar banking treats a pack
        // at its limit like a full one (see UNIFIED_CONTROLLER BANK_*).
        // Day-forecast backtest, 642 forecasts 2026-04-15..09-25 (8/10/12/14 h, pack % until 9 PM):
        // MAE 7.43 -> 7.31 pp (1st half 6.02 -> 5.96, 2nd half 9.04 -> 8.85), bias -1.35 -> -1.24;
        // profile exclusion alone 7.33, ceiling alone 7.41.
        "INTAKE_LIMIT_KW": 4.3,
        "INTAKE_LIMIT_ON_GRID_KW": 4.9,
        "INTAKE_STEADY_MIN_KW": 3.0,
        "INTAKE_STEADY_RANGE_KW": 0.25,
        "INTAKE_CEILING_DAYS": 7,
        "INTAKE_CEILING_MIN_SAMPLES": 8,

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
    // OVERNIGHT_FLOOR_PERCENT) lives in UNIFIED_CONTROLLER below; the old
    // start/stop trigger thresholds that used to live here went out with the legacy
    // routines they fed.
    "CHARGE_AUTOMATION": {
        // The night window: the anchor decision fires at the first cycle at/after
        // START_HOUR, and the window is treated as closed by MORNING_END_HOUR.
        "NIGHT_HVAC_START_HOUR": 21,                 // 9 PM (was 10 PM until 2026-09-26: Diego is often asleep before 10) — first cycle at/after this makes the night's setpoint decision
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

        // ── Bedtime PULL-DOWN: what it costs to move the house to a new setpoint ──
        // (2026-08-10). The constant above is the SUSTAINED rate — the trickle of extra
        // cooling a warmer setpoint saves once the house is already sitting at it. It says
        // nothing about the far bigger, one-off cost of CHANGING the temperature the house
        // holds, and that omission is what made the chart's overnight forecast unusable on
        // exactly the night it matters most.
        //
        // 2026-08-09 is the case: at 10 PM the house sat at 84 °F, Diego lowered the
        // thermostat to 80 °F at 10:45, and the heat pump then ran essentially flat out
        // until 2:15 AM pulling the structure down. Measured overnight house energy was
        // 9.12 kWh against ~6.0 kWh on a night with no pull-down. The chart, which models
        // house load purely as a 7-day per-slot average, projected ~0.9 kW through that
        // window and said the pack would bottom out near 30% (21% once the new setpoint
        // was visible). It reached 2.1%.
        //
        // MEASURED over the 18 clean nights since the thermostat feed began (2026-07-22 —
        // the first night with per-slot indoor temperature AND cool setpoint recorded):
        //   * overnight energy vs the bedtime gap (indoor − setpoint) correlates at
        //     r = 0.77; nothing else comes close (mean overnight outdoor temp r = 0.25,
        //     the day's high r = 0.01, the setpoint alone r = 0.30).
        //   * three independent fits of the coefficient agree: a per-night OLS gives
        //     0.75 kWh/°F (90% CI 0.25–0.93), a 5-parameter slot simulation grid-searched
        //     on per-night energy gives 0.8–1.0 (leave-one-out MAE 0.46 kWh), and the
        //     2026-08-09 night on its own gives 3.1 kWh / 4 °F = 0.78.
        //   * physically it is the building's heat capacity divided by the heat pump's COP:
        //     0.85 kWh electric ≈ 3 kWh thermal ≈ 10,000 BTU per °F, normal for this house.
        // SWING_KW is how fast that energy is spent — the draw the compressor adds above
        // the profile while it is pulling down, measured at ~1.0–1.5 kW and implying
        // ~1.2 °F/h of travel (observed 2026-08-09: 84 → 79 °F in 3.5 h).
        // DEADBAND_F discounts the first quarter degree: the thermostat reports whole °F,
        // so a 1 °F indoor-vs-setpoint difference is often just rounding.
        //
        // Raising the setpoint above the indoor temperature is the reverse move: the
        // compressor idles, the house draws only its IDLE load for that hour (measured from
        // the compressor-off samples of the last ANALOG_POOL_DAYS), and the heat the heat
        // pump stops removing — the profile's HVAC share — warms the house at the same
        // 0.85 kWh per °F until it reaches the new setpoint. That is what makes the chart
        // move when the setpoint goes up, not only when it comes down.
        //
        // ── The EVENING coast (2026-09-26) ──
        // The term used to start at 8 PM, and a raise was credited as a flat "up to SWING_KW
        // less, floored at 0.3 kW". Both were wrong for the evening pre-shed (4 PM onward):
        //   * a 4–7 PM raise got NO credit, while the modeled house walked to the raised
        //     setpoint uncharged and was then charged the whole bedtime pull-down from
        //     there. 2026-09-25: compressor off 5:30–9 PM at ~0.55 kW, house 80 → 82 °F and
        //     no further; the 9/26 chart assumed 84 °F by 8 PM and projected 0% at dawn.
        //   * holding costs ~1.4 kW over idle at 5 PM but ~0.2 kW by 10 PM, and the evening
        //     idle draw is 0.5–1.0 kW (cooking, TV), not 0.3.
        // Replayed at 4–10 PM on every night 2026-07-22..09-25 (445 forecasts) with the
        // setpoint changes that actually followed, scored to 7 AM against the real pack:
        //   * 31 evenings with a ≥2 °F coast: MAE 9.72 → 6.75 pp, overnight-low bias
        //     −8.85 → −5.25 pp; the other evenings 6.45 → 5.93; all 8.03 → 6.32.
        //   * later half only (08-24..09-25): coast 8.05 → 5.88, others 6.59 → 6.09.
        //   * the modeled indoor temperature tracks the thermostat within ~0.4 °F through the
        //     evening; slowing the modeled warm-up "fit" better but put the house 1 °F too
        //     cool — it was hiding the pull-down residual below, so it was not taken.
        //   * start hour 3–5 PM and idle history 7–28 days all score within 0.02 pp.
        // The load PROFILE, inside this window, is built only from samples where the house
        // held its setpoint (a past evening's coast or pull-down would otherwise be counted
        // twice — once in the profile, once here): 6.49 → 6.34 pp of the above. Daytime
        // forecasts given the real schedule improve too (9 AM 13.90 → 12.34, 3 PM 6.73 →
        // 6.22); with the setpoint held — what the car gates and the day peak ask — no
        // 97% verdict changes and the peak moves −0.03 pp on average, while the evening
        // part is now honestly "held" (the old profile quietly assumed a typical coast).
        // COAST_MAX_RISE_F is read off the thermostat, not fitted to the pack: after a raise
        // the house gains ~1 °F in 30 min, ~1.7 by 1 h, ~2 by 2 h and levels off — +1 °F on
        // an 84 °F evening, +3 °F at 92–94 °F, never more across 32 coasts. Without it a 4 PM
        // pre-shed to 84 walked the modeled house 5.5 °F to 83.7 by 8:30 PM (9/25's real
        // house stopped at 82) and charged the 9 PM anchor a pull-down that never happens:
        // the 9/26 11:45 chart went 0% → 19% at dawn. Backtest-neutral (6.34 → 6.32) —
        // history has few coasts long enough to reach it.
        // Still pessimistic on coast nights (−5 pp at the overnight low): the pull-down
        // after ~10 PM is over-charged even from the right starting temperature.
        //
        // Backtested end to end (see PredictPowerwallDay): the projected pre-dawn low
        // scored at every 15-min cycle from 8 PM to 2 AM on all 19 nights, 475 forecasts.
        // Overall MAE 3.99 → 3.93 pp; on the 2026-08-09 cycles after the setpoint change
        // 5.86 → 2.89 pp and the worst single forecast 22.0 → 10.0 pp. A sustained
        // setpoint term on top of this was tried at 0.02–0.07 kW/°F and made every bucket
        // worse (MAE 3.93 → 4.18 at 0.02) — the pull-down carries the whole effect; do not
        // add one back without re-running that sweep.
        "HOUSE_THERMAL_KWH_PER_F": 0.85,   // house-load kWh to move the indoor temperature 1 °F
        "HOUSE_THERMAL_DEADBAND_F": 0.25,  // ignore this much of the indoor-vs-setpoint gap (1 °F reporting resolution)
        "HOUSE_HVAC_SWING_KW": 1.0,        // kW the heat pump adds above the profile while pulling down
        "HOUSE_COAST_MAX_RISE_F": 3,       // a coast warms the house at most this far above where it began (max measured +3 °F)
        "NIGHT_LOAD_MODEL_START_HOUR": 16, // the thermostat term applies from this hour (the evening pre-shed; was 20) ...
        "NIGHT_LOAD_MODEL_END_HOUR": 8,    // ... until this one
        "NIGHT_MAX_HOUSE_LOAD_KW": 2.4,    // ceiling on the adjusted overnight load (whole-house draw with the compressor flat out)

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
        "OVERNIGHT_FLOOR_PERCENT": 1,    // the ONE overnight line: raise the heat pump when the forecast low is under it, lower it when even a bad night one degree cooler stays at/above it (Diego 2026-10-03; was a separate 15% to descend)
        // Car priority hold (Diego, 2026-09-28): a car below 35% may not make the commute
        // (Model X at 18% vs the 21% the commute needs), so the car outranks comfort. While
        // EITHER car reads below CAR_PRIORITY_SOC_PERCENT, no automated move lowers the setpoint
        // below CAR_PRIORITY_HOLD_F: the comfort descent (rule G) stops there. The 9 PM
        // anchor (rule B) ignores the cars (Diego, 2026-10-03). It only blocks descents —
        // a setpoint already below the hold is left alone, and banking (rule F) still spends
        // solar that would otherwise be curtailed. Hard rule H4 carries the exception.
        // The same line decides the car stop (rule A, Diego 2026-09-28 — was a separate 50%):
        // a car below it is protected (the heat pump sheds first); at or above it the car is
        // stopped first, and the afternoon forecast stop (rule A2) may stop it.
        "CAR_PRIORITY_SOC_PERCENT": 35,
        // Rule A2, the forecast stop (Diego, 2026-09-28: "I'd stop the car around 3:50 when
        // the pack was ~96% so it could refill to 100%"): from this hour on, with the pack
        // below TARGET and draining, a charging car at/above CAR_PRIORITY_SOC_PERCENT is stopped
        // when the day forecast says the pack misses TARGET with it charging but reaches it
        // without — the start gate's test run in reverse. 3 PM, not noon: replaying the
        // 9/11-9/28 afternoons, every noon-2 PM firing (9/13, 9/24, 9/25, 9/27) was a car that
        // kept charging while the pack still reached 100% — below 97% the house fills the pack
        // first, which the forecast's co-charging model does not know.
        "FORECAST_STOP_START_HOUR": 15,
        "CAR_PRIORITY_HOLD_F": 81,
        "COMFORT_MIN_F": 76,             // coolest allowed cool setpoint (only reached when excess solar would otherwise be wasted)
        // Resting DAYTIME cool setpoint — where the house sits unless a rule has a reason to
        // move it, and the floor the daytime comfort descent (rule G) walks back down to.
        // LOWERED 80 -> 78 on 2026-09-26 (Diego: "78 is the best temperature; 80 is a
        // compromise I put up with to help the car and Powerwall charge"). Every degree
        // above 78 is now a cost a rule must justify (overnight survival, evening pre-shed,
        // car protection) — the old base made 78 look like "banking" and the unwind walked
        // it up to 80 at midday even with the pack forecast to fill. A/B replay of the plan
        // over 60 moments 2026-09-06..25: overnight low +2.8 pp mean, never under the 5% floor.
        // Banking still cools below it to COMFORT_MIN_F (2 degrees: 78 -> 76) with solar
        // that has nowhere to go — the precool lowers the evening's cooling cost.
        // The night uses NIGHT_ANCHOR (79) instead, not this.
        "COMFORT_BASE_F": 78,            // resting daytime cool setpoint (floor of the daytime descent, ceiling of banking's unwind)
        "COMFORT_MAX_F": 81,             // hottest the NIGHT may get: the 9 PM anchor's ceiling and the cap on survival
                                         // raises outside the evening window (Diego 2026-10-07: 82 -> 81 — see EVENING_MAX_F)

        // ── Evening pre-shed (2026-09-25, Diego's routine automated) ──
        // "I'd rather put up with the heat during the evening if that means I can lower the
        // setpoint at 10 PM." From the solar crossover (pack discharging) at/after
        // EVENING_SHED_START_HOUR until the 9 PM anchor, whenever the CONSERVATIVE estimate
        // says a NIGHT_ANCHOR_SETPOINT_F night would end under the floor, the controller steps
        // the setpoint up one degree per cycle toward EVENING_MAX_F — a separate ceiling
        // from COMFORT_MAX_F (currently 2 degrees higher), so the evening can run hotter than
        // the night is ever allowed to. The anchor then decides the night with the bedtime pull-down priced in
        // (see MeasurePriorNightLowPercent), so a hot evening cannot trick it into 79.
        "EVENING_MAX_F": 83,             // hottest the EVENING (4-9 PM) raises may go (Diego: 84 -> 82 on 2026-10-01, 82 -> 83 on 2026-10-07)
        "EVENING_SHED_START_HOUR": 16,   // earliest hour the pre-shed may act (the discharge gate makes the real time dynamic)
        "DRAIN_DEBOUNCE_CYCLES": 2,      // consecutive cycles of "below target AND discharging" before a reactive car stop (rejects a passing cloud)
        "MIN_CAR_KWH": 1,                // a car must be able to take at least this many kWh (headroom below its limit) to be worth starting
        "MIN_SOLAR_KW": 0.1,             // "solar is producing" threshold for allowing a car start (rule: never start with no solar)

        // Opening draw of a home charging session, per car, in kW — what the car
        // INSISTS on pulling in its first slots even when the sun cannot cover it.
        // RE-MEASURED 2026-07-27 over 607 daytime starts (Aug 2025 - Jul 2026), split
        // into SOLAR-MANAGED starts (opening amps <= 75% of the car's request — Tesla's
        // solar charging manager set the rate) vs FULL-RATE ones. The original 2.5/3.6
        // "floors" were a draw-vs-DRAIN confusion:
        //   * The old numbers were the median opening DRAW at low pre-start surplus —
        //     but that draw was solar-funded (surplus ramps between the pre-start sample
        //     and the opening one). The pack+grid contribution at the opening sample of
        //     a MANAGED start is median 0.00 kW at EVERY surplus level (Model 3; p90
        //     <= 0.8 kW below 2 kW of surplus, 0.00 above), confirming Diego's 2026-07-27
        //     8:15 AM observation: the manager holds the car AT the live surplus and the
        //     Powerwall stays even.
        //   * The starts that DO slam the pack are FULL-RATE ones (median pack+grid
        //     +1.9 to +2.0 kW, p90 8-9 kW at low surplus) — manual winter 32/48 A
        //     charging the automation never issues.
        //   * Above ~2 kW (M3) / ~3 kW (MX) of surplus the gate stops discriminating:
        //     the residual ~7-10% of managed starts that later show a sustained drain
        //     are clouds/house-load moves mid-session, which the reactive stop rule
        //     already handles. Raising the gate further just delays starts (~30 min per
        //     kW on a morning ramp) without reducing that rate.
        //   * Still true from the 2026-07-25 measurement: no time-of-day term (the
        //     hourly pattern is surplus in disguise), no ramp-in (the opening slot is
        //     the session's rate), and the car opens at min(request, manager's grant).
        // Used by ExpectedStartupDrawKw / StartupInsistKw in ChargeAutomationManager.
        // Controller.cs. Re-measure with the same archive replay if the cars, the wall
        // connector or Tesla's solar-charging behavior change.
        "STARTUP_DRAW_KW": {
            "MODEL_3": 1.5,              // was 2.5 until 2026-07-27; managed-start drains vanish once surplus >= ~2 kW (this + margin)
            "MODEL_X": 2.5               // was 3.6; kept higher than M3 — MX opens harder (med 3.4-4.8 kW) and has only been
                                         // solar-managed since May 2026 (0 managed starts before), so only ~3 months of evidence
        },

        // Headroom the solar surplus must have OVER the car's insisted-on opening draw
        // before a start is allowed, covering house load that moves between the decision
        // and the car actually drawing (mainly the heat pump cycling on: measured
        // slot-to-slot house-load steps are p90 +0.54 kW, p95 +1.18 kW).
        // This margin plus STARTUP_DRAW_KW is CONDITION (d) of the controller's start rule
        // (rule 1) — added 2026-07-25, ratified 2026-07-26. It is deliberately part of the
        // spec: grid imports among allowed starts went 8 -> 0 once a start had to fit inside
        // the LIVE surplus. Powerwall-first means a start may never be funded by the pack.
        // Re-examined 2026-07-27 with the managed/full-rate split: keeping it. At the new
        // lower floors it still trims the marginal starts (M3 sustained-drain 12 -> 10 of
        // 158/140 allowed) and costs only ~15 min on a morning ramp.
        "START_SURPLUS_MARGIN_KW": 0.5,
        "USER_LOCK_HOURS": 2,            // after a detected MANUAL car start/stop, the automation won't override it for this long
        "USER_LIMIT_LOCK_HOURS": 24,     // after a detected MANUAL charge-limit change (a limit the automation did not command),
                                         // the limit manager leaves that car's limit alone for this long — a limit is a deliberate
                                         // setting (a trip tomorrow), not a passing action, so it outlives the 2h start/stop lock.
                                         // Also seeded on the first observation after a deploy, so the limits the cars carry
                                         // the day automation comes on are treated as Diego's and respected for a day.
        "USER_SETPOINT_LOCK_HOURS": 1,   // after a detected MANUAL cool-setpoint change (one the automation did not write), no
                                         // heat-pump rule touches the thermostat for this long (Diego 2026-09-28: 9/27 he set 80
                                         // at 7:45 PM and the evening pre-shed raised it to 81 fifteen minutes later)
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
        "BANK_ENTER_PERCENT": 98.4,      // engage banking at/above this pack % ... Off-grid the pack reports in ~0.4% steps (97.4/97.7/98.1/98.5/100) and a FULL pack sits at 98.5: daytime 9/8-10/6, 224 samples read 98.49-98.50 vs 64 at >= 99 (2026-10-07; was 99, which missed 10/6 15:15-15:30)
        "BANK_EXIT_PERCENT": 97,         // ... and stay engaged until it falls below this (the pack crosses 99 between consecutive samples 16% of the time)
        "BANK_SMOOTH_SAMPLES": 3,        // median over this many samples (45 min) of the waste signal — clouds and the fridge move it by more than a degree's worth; do NOT widen (see above). Cooling also reads the latest sample alone (signal = max of the two, 2026-10-07), so this only slows the unwind
        "BANK_DISCHARGE_GUARD_KW": 0.75, // pack discharging more than this = the sun is not covering the house, so no solar is being wasted. A FULL pack off-grid trickles out a median 0.27 kW (p95 0.60) on its own, so the guard sits above that and below trickle + one banked degree (~1.0 kW). Measured 2026-09-26 over 235 full-pack daytime samples

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
    },

    // Phone alerts: web push to the dashboard added to the iPhone Home Screen
    // (PhoneAlertManager.cs; the 🔔 button in the Energy Flow header turns them on).
    // Every alert repeats each collector cycle (15 min) while its condition holds.
    "PHONE_ALERTS": {
        "ENABLED": true,
        // "Ready to go off-grid" fires once the Powerwall is back on the grid and has
        // recovered to this. Tesla publishes no minimum for Go Off-Grid, but the gateway
        // reconnects by itself at ~5% (every on-grid episode 9/11-9/26 began at
        // 4.9-6.1%), so going off-grid anywhere near that bounces straight back.
        // 15 -> 7 (Diego 2026-10-07): alert as soon as the morning sun lifts the pack
        // clear of the reconnect point.
        "OFF_GRID_READY_PERCENT": 7,
        // "Solar about to be curtailed": off-grid, no car plugged in at home, and the Powerwall
        // charging within this many kW of its intake ceiling (IntakeCeilingKw, ~4.3 kW in Sept
        // 2026) or already at it. Past the ceiling the inverter throws the rest of the array
        // away, so it's time to plug a car in. 0 = off.
        "CURTAIL_LEAD_KW": 0.6
    }
};
