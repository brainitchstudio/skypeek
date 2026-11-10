# Daily audit notebook

Persistent working notes for future reviews. Entries distinguish facts, hypotheses, and unknowns. This file is not a substitute for raw logs.

## 2026-11-05 — Preparation

Evidence: README, accuracy.ts, accuracyStore.ts, config.ts, and targeted service.ts/Settings.tsx/adapter inspection; authoritative pages registered in KNOWLEDGE_BASE.md.

Verified: starting blend weights are assumptions; current accuracy capture is browser-local and skips hidden tabs; JSONL export exists. No real-world forecast export or matched observational dataset was examined today. No accuracy estimate or improvement claim is justified yet.

Hypotheses requiring checks: precipitation accumulation-window alignment; dry-event classification; observation QC/units; station representativeness; combined-version/scope handling. These are investigation topics, not confirmed defects.

Unknown: target evaluation locations, actual log availability to scheduled runs, sample/event counts, completeness, measured blend skill, and notification delivery observed by the user.

Pending decision: none requested for documentation preparation. All algorithm changes remain subject to user selection.

Next review priorities:
1. Locate authorized real accuracy exports/browser data and establish a repeatable daily access path.
2. Inspect raw field semantics, time windows, QC, station metadata, and forecast cutoffs before scoring.
3. Produce the first coverage baseline; propose options if data access is missing.
4. Check whether references or project behavior changed; update only with evidence.

### Cadence and historical-data discussion

Recorded daily operational checks, weekly descriptive summaries, monthly evidence-gated candidate reviews, and seasonal generalization review as a proposed policy. Daily checking does not imply daily tuning. Historical pilot proposed, not acquired: matched archived forecasts and station observations; target region needed. Avoid treating stitched model history as fixed-lead forecasts or substituting model archives for actual commercial-provider history. Next step: establish target geography and compatible archive coverage before downloading. No schedule or algorithm changes made.

### User-confirmed operating rule

The user confirmed: monitor daily; do not tune simply because a review date arrives. Investigate specific findings that warrant attention, recommend a change only with supporting evidence, and wait for the user's selection before implementation. Weekly/monthly/seasonal reviews are analysis checkpoints, not tuning deadlines. User also accepted the general historical-data recommendations; initial target city/region remains unspecified.

### Safeguards handoff incorporated

Read `docs/safeguards-handoff.md`; user states safeguards are already implemented. Linked the handoff into the knowledge base and daily review. No code changes or fault-injection tests performed. Author-reported verification remains attributed, not independently confirmed.

Next checks now include safeguard aggregation/count semantics, fallback/quarantine/blank outcomes, log/export availability, precipitation mismatches, and recurring dew-point conflicts. Carry forward the handoff's known gaps, including radar tap validation, unlogged rejections, timestamp retention behavior, and missing-hour presentation. Do not mistake historical test examples for new incidents or low event counts for measured forecast accuracy. Numeric guardrails are implementation thresholds, not independently verified universal physical limits.

### Safeguard corrections and /lab implementation

User authorized code/log/test improvements and requested `/lab`. Implemented local dashboard with location/window/exact-lead/version filters, collection health, provider status, deterministic error tables, precipitation-proxy scores, daily trends, safeguard search/outcome filters/details, raw forecast/observation inventory, JSONL export, and browser-local notes. Notes do not synchronize with this project file. No weights changed or historical data imported.

Corrections include guarded radar values with diagnostics, visible session archive health and exported health, best-effort bounded operational diagnostics, distinct safeguard outcome aggregation/count units, assembled-snapshot evidence for sampled fallback outcomes, safeguard retention pruning, wind observation QC, rejection diagnostics, precipitation-policy versioning without misbucketed hour-ending amounts, cutoff/scope/version isolation, and recovery from future-dated cached issue times. Original handoff updated with attributed evidence and limits.

Validation: 263 tests passed across 16 files; production build passed and includes `/lab`; TypeScript checks passed. Browser checked overview, accuracy, safeguard explorer, and record inventory. Actual UI raw-export download parsed successfully: 544 source_forecast records and one audit_health record; health was ok/IndexedDB. Zero observations in this initial browser dataset, so no measured skill result. Screenshot: lab-preview.png. Export is in the browser Downloads folder; no synthetic observations were inserted into its dataset. The existing preview server was reused and left running.

Still open: reliable unattended/shared collection; full raw observation metadata and current schema/unit validation; precipitation dry-proxy representativeness; end-to-end live commercial-provider validation; historical data region/archive acquisition; and held-out candidate experiments. Session health resets on reload; diagnostic storage can itself fail. Tests establish specific behaviors, not universal data validity or improved meteorological skill. Next daily run should inspect actual exports and coverage before recommending tuning.

### Objective clarified: free-source quality within request budgets

User confirmed the primary goal is a quality experience from free/openly available sources without exhausting limits. Updated knowledge base, review checklist, dashboard objective and request ledger visibility, and daily automation. Accuracy is one dimension alongside freshness, availability, and request efficiency. Consensus remains a possible shadow experiment using existing snapshots; it is not implemented or authorized as live weighting. No source, quota, weight, or fetch cadence changed. Open issues: radar/search spend is counted but not gated by the ledger; browser quotas are not shared account-wide; cache-hit rate and historical request-per-success metrics are not yet instrumented. These must not be presented as solved.

### 2026-11-05, 9:05 a.m. Central — scheduled code/log review

See 2026-11-05-0905-review.md. Selection-only scope in this trigger conflicts with current weighted-average implementation. Claude's orchestration completion could not be established; no implementation edits made. All 263 tests pass. Existing 2:29 a.m. export has 544 forecasts, no observations; no measured accuracy conclusion. Direct radar request gating remains unresolved. Recommended next step is an orchestration handoff, with a fresh /lab export for runtime evidence.

### 2026-11-05, 9:24 a.m. Central — daily orchestration audit follow-up

Review window: since 9:05 a.m. Central (15:05 UTC); checked at 15:24 UTC. Read knowledge base, checklist, notebook, and safeguards handoff. No new project JSONL export or orchestration handoff located; weather source modification times remain earlier than the previous review. The same Downloads export contains 544 forecasts, one audit-health record, and no observations. It is historical evidence, not a current browser or quota snapshot. No new runtime accuracy/429/latency/cache-efficiency measurement is available.

Prior findings and pending options remain unchanged: establish Claude's handoff before implementation edits; obtain a fresh /lab export with observations for runtime verification; keep direct-request gating on the unresolved list. Selection-only clarification in the preceding review takes precedence over older blending/calibration proposals. No code, weights, configuration, or source requests changed; no redundant test run. Daily notes updated only. User was notified of these same findings at 9:05; no duplicate notification warranted.

### 2026-11-06, 9:21 a.m. Central — daily audit

Window: since 2026-11-05 15:24 UTC through 2026-11-06 15:21 UTC. Read audit guidance and safeguards handoff. No new orchestration handoff or project JSONL export located. Downloads still contains only the Nov 5 08:29 UTC export: 544 forecasts, one audit-health record, zero observations. No current paired accuracy, rate-limit incidence, cache-hit rate, latency, or account-wide usage can be measured from that export.

Code changes observed outside the unchanged weather orchestration folder: budget source IDs now include IEM, NOAA radar, and HRRR; IEM live/history fetches check remaining capacity and bench after HTTP 429. This is code evidence only, not a validated provider entitlement or observed quota outcome. Open-Meteo grid/point and point-alert paths still use spend without reserve/dispatch. Weighted averaging remains in fusion.ts; the previously reported selection-only scope discrepancy is unresolved. No implementation edits made pending handoff/user decision. Existing documents with earlier blend experiments are historical, not authorization to tune.

Options remain: (1) obtain orchestration handoff and a current /lab export (recommended), (2) authorize focused direct-request quota enforcement review after handoff, (3) continue monitoring without tuning. Existing missing-observation and coordination gaps were already notified; no duplicate alert solely for persistent absence. Test outcome recorded below.

Validation: npm test passed 434 tests across 32 files (previous recorded run: 263/16). This demonstrates expanded automated coverage, not measured meteorological improvement. No code changed and no production build rerun. No new actionable runtime failure established. Documentation updated; pending decisions preserved.

### 2026-11-06, 1:42 p.m. Central — code/log review follow-up

Window: since today's 9:21 a.m. review through 19:42 UTC. No new orchestration handoff, project export, or newer Downloads export found. Weather orchestration and API modification times remain earlier than today's prior review; selection-only scope discrepancy and direct-request quota gaps persist. Targeted reinspection confirms main service requests reserve/dispatch, handle errors, and preserve official-alert state on unsuccessful polls; those code properties do not establish live provider health. No new runtime data establishing accuracy, request efficiency, 429 frequency, freshness or coverage was available.

Completion of Claude's implementation remains unconfirmed, so no implementation edits made. Earlier same-day 434-test passing result is carried forward, not rerun or claimed as a new check. No changes warrant redundant testing or a new notification. Pending actions remain orchestration handoff and fresh /lab records (save exported JSONL under docs/weather-audit/exports for repeatable file-based review); monitoring without tuning remains valid. This is continued code inspection, not a successful current runtime accuracy audit.
