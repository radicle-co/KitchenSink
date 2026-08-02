# Metrics: Recipe Importing

**Branch**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Source**: [product-spec.md](./product-spec.md), [../spec.md](../spec.md)

## Principle

Every metric below names what it measures, what would make it lie, and the decision it informs. A metric with
no decision attached is a dashboard, not a metric.

## North star

**Recipes successfully imported and confirmed per active user, per month.**

Deliberately measured at **confirmation**, not at import submission. An import that produces a draft the user
abandons has delivered nothing. Counting submissions would let extraction quality regress while the headline
number rose.

## Product metrics

| ID  | Metric                          | Definition                              | Target    | Informs                                              |
| --- | ------------------------------- | --------------------------------------- | --------- | ---------------------------------------------------- |
| M-1 | Draft confirmation rate         | confirmed drafts ÷ drafts created       | ≥ 70%     | Is review a reasonable step or an abandonment cliff? |
| M-2 | Time to confirmed recipe        | p50 from submission to confirmation     | ≤ 60s     | The "under a minute" vision claim                    |
| M-3 | Fields corrected per draft      | mean user edits before confirming       | ≤ 3       | Extraction quality as the user experiences it        |
| M-4 | Import share of recipe creation | imported ÷ all recipes created          | ≥ 25%     | Whether the feature earns its maintenance cost       |
| M-5 | Duplicate-resolution rate       | imports resolving to an existing recipe | (observe) | Dedup working, and how much content overlaps         |
| M-6 | Channel mix                     | share by url / instagram / file / ocr   | (observe) | Where to invest next; whether OCR justified P1       |

**What would make these lie**: M-1 rises if we silently auto-fill missing fields — which is exactly what the
design forbids. If M-1 is ever "improved" by defaulting values, the metric has been gamed and the product is
worse. Pair M-1 with M-3: falling corrections with a rising confirmation rate is genuine improvement; rising
corrections with a rising confirmation rate is not.

## Quality metrics

| ID  | Metric                 | Definition                                                   | Target    | Source          |
| --- | ---------------------- | ------------------------------------------------------------ | --------- | --------------- |
| Q-1 | Extraction accuracy    | field-level accuracy on the hand-verified corpus             | ≥ 85%     | SC-002, CI gate |
| Q-2 | Clean JSON-LD yield    | JSON-LD sources whose draft misses at most `servings`        | ≥ 95%     | SC-003, CI gate |
| Q-3 | Extractor strategy mix | share of imports resolved by JSON-LD / microdata / heuristic | (observe) | Runtime SLI     |
| Q-4 | Ingredient parse rate  | lines parsed to a structured quantity                        | ≥ 80%     | Runtime SLI     |
| Q-5 | No-recipe-found rate   | fetched successfully but nothing extractable                 | ≤ 10%     | Runtime SLI     |

Q-1 and Q-2 are **CI gates that fail the build**, not dashboards. Q-3 is the early-warning signal: a rising
heuristic share means the web's markup is drifting away from what we parse well, and it will show up in Q-1
only after the corpus is refreshed. **A Q-3 shift of more than 10 percentage points toward the heuristic
strategy triggers an out-of-cycle corpus refresh (D-009)** — this is the one metric wired to an action rather
than a dashboard.

## Reliability and performance

| ID  | Metric                    | Target                               | Source     |
| --- | ------------------------- | ------------------------------------ | ---------- |
| R-1 | Import job success rate   | ≥ 97% excluding user-caused failures | SLO        |
| R-2 | URL import latency        | p95 ≤ 15s · p99 ≤ 30s                | SC-004, k6 |
| R-3 | Draft confirm latency     | p95 ≤ 400ms                          | SC-004, k6 |
| R-4 | Circuit-breaker open time | (observe)                            | SLI        |
| R-5 | Load shed rate (`429`)    | ≈ 0 at expected load                 | k6 soak    |

R-1 deliberately **excludes** blocked sources and no-recipe-found: those are the system working correctly, and
counting them as failures would create pressure to weaken the blocklist.

## Safety and compliance

| ID  | Metric                                      | Target    | Why                                                    |
| --- | ------------------------------------------- | --------- | ------------------------------------------------------ |
| S-1 | Duplicate public recipes per source         | **0**     | SC-005; a non-zero value means the unique index failed |
| S-2 | Imported-public recipes lacking attribution | **0**     | Legal exposure (HAZ-015/023)                           |
| S-3 | `imported_paid` recipes made public         | **0**     | Never permitted (REQ-CN-003)                           |
| S-4 | OCR images outliving their draft            | **0**     | Privacy (HAZ-035)                                      |
| S-5 | SSRF guard rejections                       | (observe) | A sudden rise indicates probing, not a bug             |

S-1 through S-4 are **invariants, not targets**. Any non-zero reading is an incident, not a trend to improve.
S-5 is the one security metric that is expected to be non-zero — it counts attacks being stopped.

## Adoption gates

| Phase       | Gate                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| Launch      | Q-1 ≥ 85%, R-2 met, S-1..S-4 all zero in soak, ATP-012 fully passed        |
| Post-launch | M-1 ≥ 70% within 30 days; if below, investigate M-3 before adding channels |
| Instagram   | Ungated only when the Meta credential exists (D-002) — no product gate     |

## Deliberately not measured

- **Import submissions** as a headline — see north star.
- **OCR accuracy against SC-002** — OCR is excluded from that bar by design; measuring it there would drag the
  figure down for a reason unrelated to the extractor.
- **Per-domain success rates published externally** — useful internally, but publishing a "sites we parse
  badly" list invites both embarrassment and gaming.
