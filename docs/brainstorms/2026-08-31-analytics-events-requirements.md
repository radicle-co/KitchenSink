---
title: First-party analytics events — one store, two capture doors
date: 2026-08-31
status: ready-for-planning
reviewed: 2026-09-01 (six-persona ce-doc-review; all 14 findings resolved by owner walk-through)
origin: ce-brainstorm dialogue (owner, 2026-08-31) + market landscape scan; greenlit by the U15 report's "Owner rulings" §2 (docs/reports/2026-08-31-002-u15-reimport-and-measure.md)
relates_to: specs/015-publishing-rewards/plan.md (recognition telemetry gap), docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md (erasure posture precedent)
---

# First-party analytics events — one store, two capture doors

## Problem frame

Nothing records what people actually do in the product. The U15 measurement run had to reconstruct
suggestion-ranking behaviour by SQL archaeology after the fact, and the importer's report is now the only
ranking-quality instrument. 015's recognition features (US5/US6) are blocked on the same gap: no cook/save
events exist anywhere, so "cooked 40 times" has nothing to count. The owner's ruling (2026-08-31) greenlit
an events pipeline as its own effort, with two boundaries fixed in advance: events stay OUT of
`ingredient_resolutions` (the machine-judgement ledger), and OFF the domain wire contract.

What exists today and stays: Vercel Web Analytics (page views, web only, behind the deny-all redaction
interceptor) and Sentry (errors, both apps). Neither records interaction events nor anything our own
systems can query.

## Actors

- A1. Owner-operator — queries events by SQL for ranking quality, funnel health, calibration.
- A2. Cook (signed-in user) — generates events by searching for ingredients, picking suggestions, saving
  recipes, viewing recipes. Every event has a signed-in actor today: the app has no signed-out surface.
  If truly-anonymous viewing ever ships, actor-less events are a new decision, not an implicit one.
- A3. Recipe author — future beneficiary: recognition counts on their recipes are computed FROM these
  events (015 consumes; this effort only ensures the data exists and its history is never lost).

## Key decisions (settled in dialogue; amended by owner walk-through 2026-09-01)

- KD1. **One system serves both consumers.** The same event stream answers the operator's SQL and,
  eventually, the product's aggregate count reads. No vendor sits between the product and its own numbers.
- KD2. **Events live in the recipe database** as an append-only, fact-table-shaped store. A warehouse
  cannot serve product reads and every free warehouse tier is either non-commercial (Databricks Free
  Edition terms) or real money for the half we get free (Redshift Serverless ≈ $1.50/hr active). The
  table is deliberately warehouse-SHAPED so an S3/Athena export door exists when volume ever justifies it.
- KD3. **Two capture doors, one store.** The server records server-visible actions inline (saves, recipe
  views); a small non-domain ingestion route receives client-only facts (suggestion search outcomes and
  picks) from web and mobile. Clients never carry a third-party SDK for this. ⛔ **The doors are
  bound to families (R12):** credit-bearing families are server-door only.
- KD4. **Erasure ANONYMIZES, never deletes.** On account erasure the user id is nulled AND the typed
  query text on that user's search/pick events is blanked; event rows survive and aggregate counts never
  decrement. Accepted consequences: anonymized rows stop contributing to distinct-user dedup (aggregates
  over them count events, not people), and the residual re-identification long-tail — an anonymized row's
  timestamp + subject correlated against other systems' logs — is ACCEPTED residual risk, consistent with
  ADR-0027's pseudonymous-ULID precedent. (House precedent: `eraseIdentityRow`'s scrub-but-keep.) No
  surveyed vendor supports these semantics natively — a further reason the store is ours.
- KD5. **No third-party vendor now** ("plain Postgres for now" — owner, 2026-08-31). The market scan is
  recorded below so a future analysis-projection pick is fast; PostHog Cloud EU won the paper comparison
  (stable free tier, EU residency, SQL access, open-source exit) with Amplitude second (best analysis UX,
  worst free-tier durability record). A vendor, if ever added, is a server-side fan-out projection —
  disposable by construction, never the system of record.
- KD6. **Counts are lifetime action counts.** A folded count records that actions happened; it never
  decrements — not on unsave, not on erasure (KD4). Current-state questions ("which recipes are in
  collections now") are answered by the domain tables, never by this store.

## Requirements

- R1. Web and mobile emit a **query-outcome event** for each settled ingredient search: the query, the
  suggestion list the server returned, and the outcome — a pick (recording the picked suggestion's
  GROUP and POSITION WITHIN THAT GROUP, plus its provenance) or no pick. Both halves of capture rate —
  opportunities and picks — are therefore recorded. The events travel through a dedicated ingestion
  route that is not part of the domain API contract; ⚠️ planning must design that seam deliberately —
  the contract guards enforce route/schema parity in both directions, so "off the contract" means a
  chosen mechanism (non-`api/` mount or a pinned-exclusion entry) plus ONE shared home for the payload
  schema so neither client redeclares it.
- R2. The server records a save event (collection add) and a recipe-view event at the handlers that
  already observe them, with no client involvement. Views have a named job: R4's funnel questions
  (view→save conversion, SC5).
- R3. Events land in one append-only store in the recipe database, keyed by an opaque user ULID and the
  subject (recipe id, food id, or query) the event is about.
- R4. The operator can answer ranking-quality and funnel questions with plain SQL over the store, with no
  export step. (Operator queries share the request-path instance; if they ever contend, the levers are a
  read replica or the R9 export tier — not a new store.)
- R5. Events FOLD into simple stored per-recipe counts (saves, views; cooks when 015 ships the
  affordance), and R10's deletion may only touch rows already folded — recognition history is never
  lost. ⛔ The request-path count-serving contract (API surface, latency bar, and the events↔counts
  consistency details) is DEFERRED to 015's resumption, when its counting rules (OQ2) are real. Any
  future count read must apply the same visibility boundary as reading the recipe itself.
- R6. Account erasure nulls the user id AND blanks the query text on the user's events, in the recipe
  erasure sweep — which gains an anonymization statement; the erasure-coverage gate's existing
  de-identifying machinery classifies it. Rows and previously folded counts survive.
- R7. Event capture and emission are fire-and-forget AND resource-isolated: a failed or slow analytics
  write never blocks, errors, or delays a user-facing action, and analytics writes are bounded (pool-capped)
  with an explicit shed-under-pressure policy — analytics load is dropped first, user load never.
- R8. The event vocabulary is extensible without a wire-contract change — adding an event type (e.g.,
  `recipe_cooked` when 015 lands) is additive.
- R9. The store's shape supports aging out to S3 (export/archival seam) without redesign — append-only,
  timestamped, no in-place mutation except R6's anonymization.
- R10. **Retention: raw event rows are kept 6 months** (owner, 2026-09-01), then deleted — but only after
  R5's fold has counted them.
- R11. **Delivery semantics, per family:** at-most-once is accepted for query-outcome and view events (an
  occasionally lost row is noise); every client-emitted event carries an idempotency key so network
  retries cannot double-count; save counts remain reconcilable against the collections table (the source
  of truth for saves), even if the reconciliation job is unbuilt in v1.
- R12. **Door binding:** event families that feed user-visible credit (saves; cooks when they exist) are
  server-observed ONLY — the client ingestion route rejects them. Recognition aggregates read
  server-door families exclusively.
- R13. The ingestion route enforces a per-user rate cap (the service's existing throttle machinery), and
  bounds payload size (AE3).

**Accepted v1 risk (recorded):** query-outcome data (query, position, provenance) is client-asserted and
unverifiable; acceptable while these numbers feed only internal SQL analysis. ⚠️ If picks ever feed an
automated ranking signal or any user-visible metric, an integrity/anomaly bar is owed first.

## Scope boundaries

**In scope:** the events store, both capture doors, the three v1 event families (query outcomes incl.
picks, saves, views), the fold-into-counts step, the retention job, the erasure sweep step, and the SQL
query surface.

**Deferred for later:**

- The "Mark as cooked" affordance — 015's product work; the pipeline is cook-ready (R8, R12).
- The request-path count-serving contract and its consistency details — deferred to 015's resumption
  (R5); the fold keeps full history available for it.
- Any vendor analysis projection (PostHog et al.) and its server-side forwarder — deferred whole (KD5).
- The S3/Athena archival tier — the R9 seam is designed now, built when volume justifies.
- The save-count reconciliation job (R11's seam is stated; the job ships when counts are consumed).
- Dashboards/BI — SQL is the v1 query surface.

**Outside this product's identity:** ad-tech, cross-site tracking, session replay, selling or sharing
behavioural data. Events exist for product quality and recognition, nothing else.

## Success criteria

- SC1. The next U15-style measurement answers pick-position AND capture-rate questions from the events
  store by SQL, with no reconstruction — both the opportunities and the picks are rows.
- SC2. 015's recognition work, when unblocked, finds save (and later cook) history fully preserved —
  folded counts plus up to 6 months of raw rows — and builds no telemetry of its own.
- SC3. An erased account leaves every recipe's counts unchanged and no personally-keyed or
  personally-authored content behind: user id nulled, query text blanked.
- SC4. Analytics failure is invisible to users, PROVEN: integration tests that force the analytics path
  to fail or hang assert the user-facing response is unchanged in status, body, and bounded latency.
- SC5. View→save conversion for a recipe is answerable by SQL — the view family's named job.

## Acceptance examples

- AE1. A cook types "salt"; the picker renders its two groups (own ingredients, then catalog); the cook
  taps the first row of the CATALOG group: one query-outcome event records query "salt", the served
  list, outcome pick, group catalog, position-in-group 1.
- AE2. A cook types "buckwheat honey", sees suggestions, and picks none: a query-outcome event records
  the query, the served list, and outcome no-pick — capture rate's denominator.
- AE3. The ingestion route receives a malformed, oversized, or over-rate payload — or a SERVER-DOOR
  family like a save event (R12): it is dropped (logged), answers harmlessly, and nothing user-facing is
  affected.
- AE4. A user with 12 events erases their account: 12 rows remain with a null user id and blanked query
  text, the recipes they saved keep their counts, and the erasure-coverage gate classifies the table's
  anonymization statement.
- AE5. The retention job runs on rows older than 6 months: every row it deletes has already been folded
  into stored counts; a recipe's lifetime save count is identical before and after the deletion.

## Outstanding questions

- OQ1 (016 pass, non-blocking): consent/disclosure posture for first-party functional-plus-analytics
  events under legitimate interest, and review of the 6-month retention default (R10) — record in the
  016 framework when it lands; nothing here ships third-party trackers.
- OQ2 (015's rule to make): whether an author's own views/saves count toward their recipes' recognition
  aggregates. The store records actor + subject; the consumer decides — and the count-serving contract
  is deferred until it does (R5).
- OQ3 (planning-time): view-event volume treatment — write-per-read is fine at current scale; R7's shed
  policy and sampling are the levers if it ever isn't.

## Sources (market scan, 2026-08-31)

Landscape research recorded in dialogue: PostHog pricing/EU/deletion-API (posthog.com/pricing,
posthog.com/blog/posthog-cloud-eu), Mixpanel pricing (mixpanel.com/pricing), Amplitude free-tier
contraction (amplitude.com/pricing; userpilot.com/blog/amplitude-pricing), Databricks Free Edition
non-commercial terms (databricks.com/legal/databricks-free-edition), Redshift Serverless 4-RPU pricing
(aws.amazon.com/about-aws/whats-new/2025/06/amazon-redshift-serverless-4-rpu-capacity-option), Tinybird
latency/limits (tinybird.co/docs/forward/pricing/limits), Axiom free tier (axiom.co/pricing), self-host
ops weight (cotera.co/articles/posthog-self-hosted-guide).
