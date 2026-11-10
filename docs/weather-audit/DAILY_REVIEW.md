# Daily audit instructions

Read KNOWLEDGE_BASE.md, DAILY_NOTES.md, and ../safeguards-handoff.md first. Maintain these files in the project folder. Report in the existing audit chat and use its scheduled notification to draw the user's attention.

1. Read pending decisions and previously approved actions. Do not interpret silence as approval.
2. Establish the review window in UTC and America/Chicago, available exports/logs, locations, versions, and last successful collection. If browser records are inaccessible, say so; source files cannot substitute for observations.
3. Check orchestration failures, retry/budget pressure, missing/stale fields, provider disagreement, safeguard events, and forecast/observation coverage. Separate operational health from forecast skill.
4. Validate units, event semantics, time intervals, QC, station matching, cutoffs, scope, and versions before scoring. Keep proxy precipitation scores clearly labeled.
5. Compare identical cases and exact leads; include sample/event counts, coverage, limitations, and uncertainty. Never call distinct days statistically independent without analysis.
6. Consult primary documentation for new scientific claims. Record source URL, access date, supported claim, and limitations. Update the knowledge base as needed, not merely to create daily churn.
7. Append a dated notebook entry: evidence examined, findings, hypotheses, unknowns, source changes, pending decision, and next check. Preserve previous entries and correct errors transparently. Reference dataset paths and reproducible analysis artifacts when available.
8. Present a concise chat report with ranked findings and numbered actions, recommendation, and monitoring option where useful. Call attention to the decision needed and wait for the user. Maintain documentation autonomously; obtain the user's selection before changing algorithm, configuration, infrastructure, or underlying data.

Report template:
- Window and evidence accessed
- Operational findings
- Accuracy findings, coverage, and uncertainty (or explicit unavailable status)
- Verified facts versus hypotheses
- Numbered next actions and recommendation
- Pending user decision

Safeguards-specific daily checks: inspect event outcomes and first/last timestamps; separate removed-value counts from audit-run counts; track recurrent quarantine, fallback, blanks, stale warnings, precipitation mismatches, and dew-point conflicts. Check log/export access and completeness. Carry forward handoff gaps and attribute its historical test results. Do not treat an empty log as proof of safety, disagreement as provider error, or safeguard counts as forecast skill. Changes still require the user’s choice.

## Primary objective — confirmed 2026-11-05

Deliver a dependable, useful weather experience using free, openly available data within applicable usage limits. Improve accuracy where evidence supports it, while measuring request cost, freshness, coverage, and reliability together. Free access is not the same as open-source software or an open-data license; verify each source's terms, attribution, access model, and permitted use before adopting or expanding it. Configured budget ceilings are internal safeguards, not verified provider entitlements.

Prefer a strong primary source, caching, reuse, and graceful fallback. Additional sources must justify their marginal request cost through coverage, freshness, resilience, or held-out accuracy benefit. Existing optional keyed providers may remain available for comparison; success must not depend on adding paid services or polling every provider. Do not increase request frequency or add a provider merely to obtain consensus. Any consensus/median shadow experiment should reuse already-captured compatible forecasts first.

Evaluate candidate changes as tradeoffs: paired forecast error and event performance; counted request units by source and actual accounting window; 429/cooldown and budget-denial evidence; stale/missing coverage; cache reuse and latency where instrumented; and fallback outcomes. Explicitly mark uninstrumented measures as unknown. Provider accounting may count units differently from HTTP calls; the ledger is per browser, not account-wide. Alert availability and core forecast access take priority over optional experiments. A small accuracy improvement at disproportionate request cost may be a worse product outcome. No automatic tuning.
