# Weather refinement knowledge base

Established: 2026-11-05. Last reference review: 2026-11-05.
Purpose: durable evidence for Sky Peek's daily audit and user-approved forecast refinement. This is a working reference, not a claim of meteorological expertise or an acquired training dataset. Sources can change; reopen relevant documentation before implementation.

## Evidence rules

- Label statements as source-backed principle, observed project fact, hypothesis, or unknown. Attach URLs to scientific claims and file references to implementation claims.
- Never invent observations, scores, timestamps, provider capabilities, or explanations for an error. A plausible weather explanation is a hypothesis until supported by observations and relevant diagnostic fields.
- Forecast agreement is not measured accuracy. Several services may share upstream models; provider count does not establish independence.
- Keep raw forecast snapshots captured before the forecast cutoff, observation provenance, quality flags, transformations, versions, and availability timestamps. Never replace an old forecast with a newer run to score its past performance.
- Missing observations are unknown, not dry weather, zero wind, or a successful forecast. Report exclusions and coverage alongside scores.
- Data collection/knowledge-base maintenance is authorized. Algorithm, configuration, and infrastructure changes await the user's option selection.

## Primary reference register

All below were opened on 2026-11-05 unless explicitly marked inaccessible. Summaries are intentionally limited to the cited material; topic links are starting points, not evidence that every linked chapter was reviewed.

| ID | Source | What it supports / application | Limits |
|---|---|---|---|
| R1 | [NOAA JetStream](https://www.noaa.gov/jetstream) | Authoritative educational starting point for atmosphere, synoptic meteorology, upper-air charts, radar, thunderstorms, and clouds. Follow the relevant chapter before diagnosing a regime. | Landing page reviewed; individual chapters require targeted reading. |
| R2 | [ECMWF probabilistic verification](https://confluence.ecmwf.int/pages/viewpage.action?pageId=255078889) | Distinguishes accuracy, skill against a reference, and utility. Reliability diagrams compare issued probabilities with event frequencies; Brier score evaluates binary probabilities. | Retrieved page identifies itself as an older version. Check its current-version link before relying on changed guidance. |
| R3 | [DTC Model Evaluation Tools](https://dtcenter.org/software-tools/model-evaluation-tools-met) | Established framework for point, gridded, spatial, ensemble, and probabilistic verification and aggregation. Useful independent implementation reference. | Overview reviewed; not installed or integrated. |
| R4 | [NWS API documentation](https://www.weather.gov/documentation/services-web-api) | Official API for forecasts, observations, and alerts; cache behavior and operational interface reference. | API delivery is not a guarantee of observation completeness or instant availability. Verify field schema and units. |
| R5 | [NOAA NCEI Integrated Surface Database](https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database) | Candidate historical station observations: temperature, wind, present weather, and precipitation with varying accumulation periods. | Dataset not downloaded. Audit station metadata, flags, coverage, and accumulation periods before pairing. ISDLite omits some detail. |
| R6 | [NOAA ASOS User's Guide](https://www.weather.gov/media/asos/aum-toc.pdf) | Instrument/reporting reference for interpreting airport observations. | March 1998 guide: historical background, not a current sensor or reporting specification. Validate current details separately. |
| R7 | [Open-Meteo Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api) | Documentation says the continuous series stitches the first hours of successive runs; individual full horizons require Single Runs API. | A stitched series cannot by itself establish a fixed-lead forecast's skill. It is model forecast data, not independent station truth. No archive downloaded. |
| R8 | [NOAA National Blend documentation](https://vlab.noaa.gov/web/mdl/nbm-documentation) | Candidate operational blending reference and possible benchmark. | Search located it, but page retrieval returned HTTP 403. Contents unverified; do not attribute specific blending methods to it yet. |

## Verification protocol — proposed project policy

The following are recommended experiment rules, not claims that the current app implements them.

1. Define the question first: variable, location, observation type, valid interval, lead, units, and forecast availability cutoff. Fix one primary success metric and material regression limits before evaluation.
2. Pair comparable quantities. Temperature at a target time differs from daily maximum; sustained wind differs from gust; rain differs from any precipitation. An hour-ending accumulation differs from an hour-starting interval. Confirm provider definitions, station reporting windows, and timezone/DST conversion explicitly.
3. Audit observation representativeness: station distance, elevation, terrain/coast/urban setting, instrument exposure, reporting cadence, and quality flags. A nearby airport is an imperfect proxy for a user's location. Do not impose a universal temperature lapse-rate correction without evidence.
4. Use signed bias, MAE, and RMSE for deterministic temperature/wind-speed forecasts. With error e=forecast-observation: bias=mean(e), MAE=mean(abs(e)), RMSE=sqrt(mean(e²)). Positive temperature bias means too warm. These are distinct summaries, not a single overall accuracy percentage.
5. For an explicitly defined binary precipitation event, Brier=mean((p-y)²), with p in [0,1] and y in {0,1}; lower is better. Also inspect reliability, event counts, base rate, and missed events/false alarms at predeclared decision thresholds. A low score dominated by dry hours is insufficient evidence of useful wet-weather forecasts. CRPS is a future option only if predictive distributions are actually available; retrieve its formal specification before implementation.
6. Compare on identical cases and exact leads against the existing blend, NWS, each available provider, and an equal-weight blend. Add persistence/climatology only with explicitly defined, cutoff-safe constructions. Publish both paired comparisons and all-source coverage; shared-case filtering can conceal difficult missing cases.
7. Fit corrections only on past training data. Use chronological development and untouched future test periods or rolling-origin evaluation. Keep all versions of the same weather event together; overlapping hours/leads are dependent. Quantify uncertainty using suitable time/event blocks rather than assuming every row is independent.
8. Stratify by exact lead, region/station, season, local hour, precipitation occurrence, and documented weather regime when sample size supports it. Predefine strata; exploratory discoveries require a new holdout confirmation. Avoid claiming universal improvement from a single place or season.
9. Require practically meaningful held-out improvement, uncertainty assessment, sufficient event diversity, coverage disclosure, and no unacceptable regressions before recommending promotion. There is no universal number of days proving skill. Seven/thirty-day UI milestones are not statistical certification.
10. Shadow-score candidates, version every mapping/fusion/matching change, preserve the old baseline, and define rollback criteria. User selects an option before implementation.

## Meteorological diagnosis checklist

Use these as questions to investigate, not automatic corrections or explanations:

- Temperature: Is error time-of-day dependent? Are station elevation, cloud cover, frontal timing, coastal effects, or local exposure consistent with the hypothesis?
- Wind: Are height, averaging interval, gust/sustained meaning, direction convention, and units compatible? Direction requires circular/vector treatment; never average 359° and 1° arithmetically.
- Precipitation: Are event type, probability threshold, accumulation interval, trace handling, and station detection compatible? Could spatial displacement explain a point mismatch? Inspect radar and gauges before asserting it.
- Frozen precipitation/thunderstorms: Does the proposed adjustment require vertical profiles or storm diagnostics we do not collect? Surface temperature alone is insufficient evidence for a precipitation-type correction.
- Blending: Does improvement persist out of sample? Are upstream models shared? Does freshness weighting improve measured skill or only favor more frequent requests?

## Current implementation facts and audit questions

Code inspected 2026-11-05; recheck after changes:

- `src/weather/config.ts`: fusion-v1 starts NWS at 0.4 and other sources at 0.2 in US coverage. Comments explicitly call these assumptions, not measured superiority. Freshness half-lives and triggers are also hypotheses.
- `src/weather/accuracy.ts`: captures nominal leads 1/3/6/12/24/48 h; stores capture/availability/issue timestamps and fusion version; scores temperature with bias/MAE/RMSE, wind with the same summaries, precipitation proxy with Brier score.
- `src/weather/accuracyStore.ts` and README: browser IndexedDB storage, memory fallback, approximately 400-day retention. `service.ts` skips forecast accuracy capture in hidden tabs. Therefore unattended daily access and representative collection are not established by the repository alone.
- `src/screens/Settings.tsx`: an accuracy JSONL export exists. No exported dataset has been inspected for this preparation.
- Matching policy in `accuracy.ts`: 10-minute time tolerance, 15 km distance, 150 m elevation difference, two reports for dry classification, two-hour truth grace. These are implementation choices requiring sensitivity checks, not universal standards. Unknown station elevation can pass selection in `service.ts`.
- Rain truth combines present-weather reports/text and precipitationLastHour in an hour-starting bucket. Audit hour-ending accumulation alignment and dry-report sufficiency before interpreting Brier as true PoP skill. This is a code-grounded concern, not a validated runtime defect.
- Temperature truth rejects QC flags matching X/Q; wind truth applies range checks. Verify actual field units and quality-control handling against current NWS schema and raw samples before trusting comparisons.
- `independentDays` is computed as distinct UTC calendar days with pairs; naming does not prove statistical independence. Reporting pools some leads; use exact leads for tuning.
- `buildReport` reports the current fusion version and joins truth by target internally. Before multi-version or combined-scope analysis, verify callers isolate scope and explicitly separate historical versions. Do not pool exports blindly.

## Dataset acquisition plan (not executed)

Start with Sky Peek JSONL exports for the actual target locations and immutable provider/blend forecasts. Obtain matching NWS observations with original metadata and QC; use NCEI historical station data for background/coverage checks, not a substitute for missing issued forecasts. Consider model single-run archives for separate model experiments only after verifying licensing, run availability, variables, and lead definitions. Preserve acquisition time, query, station/run IDs, source URL, raw units, and checksums. Do not upload API keys or precise user locations into reports.

## Maintenance

Read DAILY_NOTES.md and DAILY_REVIEW.md on every scheduled review. Update this file only for verified new knowledge, changed source documentation, or confirmed project behavior; add date and reason to the change history. Never silently convert a hypothesis into a fact.

- 2026-11-05: Established source register, project inspection, experiment rules, and explicit evidence/access limitations. No tuning or measured skill claim.

## Review cadence and historical pilot — 2026-11-05

Recommended project policy, not an externally prescribed meteorological schedule:
- Daily: collection/operational health, coverage and anomalies; descriptive scores only. Correct confirmed implementation defects separately from statistical tuning.
- Weekly: summarize paired results, weather-event coverage, and hypotheses. Do not change weights in response to each weekly ranking.
- Monthly: scheduled candidate evaluation, not automatic retraining or deployment. Change only after held-out evidence and user selection. Defer if evidence is weak; rare/seasonal events require longer observation.
- Seasonal: review generalization and model/provider changes. No fixed duration guarantees skill.

Historical data can support calibration only when archived forecasts are matched to observations at the same location, variable, valid interval and lead. Historical observations alone support climatology and context but cannot establish past provider errors. Reanalysis is not an issued forecast or independent station measurement. The Open-Meteo stitched historical forecast series is not a fixed-lead archive; investigate individual runs before acquisition. Archived underlying models cannot reconstruct unavailable historical commercial-provider forecasts or the actual Sky Peek blend.

Proposed initial pilot: one user-selected region and suitable stations, temperature at 6/24/48-hour leads, approximately 12–24 months if compatible archives permit, chronological development/validation/test separation plus a subsequent live shadow test. This duration is an acquisition target, not a sufficiency threshold. Keep historical and live results separate and account for upstream version changes. Compare a simple past-only bias correction with unchanged baseline before attempting flexible weighting. Precipitation calibration follows validation of event/accumulation semantics.

Sources rechecked: NOAA NCEI ISD and Open-Meteo historical forecast documentation (R5/R7). DTC documentation index https://dtcenter.org/software-tools/model-evaluation-tools-met/documentation identifies confidence-interval references; detailed methods still require reading before implementation. No historical data acquired. Target region/stations remain unspecified. Existing daily automation remains unchanged.

### Confirmed operating rule — 2026-11-05

User confirmed daily monitoring and evidence-triggered refinement. Calendar checkpoints never require tuning. A finding triggers investigation, not an automatic adjustment; recommendations require supporting evidence and implementation awaits the user's choice. Continue monitoring is a valid outcome. The general historical pilot approach is accepted; geography remains to be selected.

## Implemented safeguards handoff — incorporated 2026-11-05

Reference: [Safeguards handoff](../safeguards-handoff.md). User confirms implementation is already in the code. Treat the document as implementation context, not a new instruction to modify code or repeat its fault-injection procedure. The author's test results below are reported evidence, not independently rerun verification.

The handoff describes sanitization of invalid values, temperature-based response quarantine, age eligibility, station fallback, separation/labeling of precipitation meanings, nullable missing values, source attribution, stale warnings, and persistent safeguard events. These protect data integrity; they do not demonstrate improved forecast skill or catch plausible but incorrect forecasts. Numeric limits are implementation policy, not universal meteorological impossibility boundaries; the handoff's claim that all limits exceed all recorded weather has not been independently established.

Daily interpretation requirements:
- Safeguard events are aggregated by scope, UTC day, rule, source, and field. `out_of_range` counts removed values; audit-rule counts represent audit runs. Never sum these into a single incident rate or equate a larger count with worsening forecast accuracy. Normalize against an appropriate denominator when available.
- Read first/last timestamps, outcome, source, field, and sample. Distinguish fallback, blank, kept-last-good, labeled, warned, and kept-all. Source disagreement alone does not justify rejection or reweighting.
- Safeguards use a separate IndexedDB database (`sky-peek-safeguards`); browser access/export remains necessary. Logging errors are swallowed and a timeout protects refreshes, so an empty log does not prove no safeguards fired or no errors occurred.
- The handoff reports 253 passing tests, type checking/build success, and simulated live NWS fault injection. Those checks were not repeated during incorporation. Tomorrow.io/WeatherAPI live behavior and clicking the real export remain unverified in the handoff.

Carry-forward gaps (handoff-reported; confirm current code before action): unchecked radar tap values; unlogged truth/getPlaceNow rejections; future/forged issue times retaining a bad batch; sensitive stale warnings; missing hours omitted when fallback unavailable; unresolved real dew-point conflict; no independent code review. Track these as open investigation topics, not newly reproduced defects. The historical live-test example is not today's production incident.

Daily priority: investigate recurrent or impactful fallback/quarantine/blank/stale outcomes, inspect precipitation semantics and dew-point conflicts, and report export/log coverage limitations. Recommend specific evidence-backed options; do not change safeguards or fusion simply to reduce the number of logged events.

### Implementation follow-up — 2026-11-05

See DAILY_NOTES.md and updated ../safeguards-handoff.md for code corrections and validation evidence. `/lab` is now the browser-local monitoring workspace. Precipitation truth policy is `present_weather_in_hour_v2`; legacy unknown-policy rain records are excluded from rain scoring. Reports isolate fusion version/location and enforce forecast availability cutoffs. The original implementation snapshot above is historical; do not assume all listed gaps remain unchanged. Full raw station metadata, unattended collection, and held-out statistical validation remain open. No measured accuracy improvement or historical dataset acquisition is claimed.

## Primary objective — confirmed 2026-11-05

Deliver a dependable, useful weather experience using free, openly available data within applicable usage limits. Improve accuracy where evidence supports it, while measuring request cost, freshness, coverage, and reliability together. Free access is not the same as open-source software or an open-data license; verify each source's terms, attribution, access model, and permitted use before adopting or expanding it. Configured budget ceilings are internal safeguards, not verified provider entitlements.

Prefer a strong primary source, caching, reuse, and graceful fallback. Additional sources must justify their marginal request cost through coverage, freshness, resilience, or held-out accuracy benefit. Existing optional keyed providers may remain available for comparison; success must not depend on adding paid services or polling every provider. Do not increase request frequency or add a provider merely to obtain consensus. Any consensus/median shadow experiment should reuse already-captured compatible forecasts first.

Evaluate candidate changes as tradeoffs: paired forecast error and event performance; counted request units by source and actual accounting window; 429/cooldown and budget-denial evidence; stale/missing coverage; cache reuse and latency where instrumented; and fallback outcomes. Explicitly mark uninstrumented measures as unknown. Provider accounting may count units differently from HTTP calls; the ledger is per browser, not account-wide. Alert availability and core forecast access take priority over optional experiments. A small accuracy improvement at disproportionate request cost may be a worse product outcome. No automatic tuning.
