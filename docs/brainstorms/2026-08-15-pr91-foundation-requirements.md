---
title: PR 91 — foundation hardening, status substrate, and portfolio respec
date: 2026-08-15
status: ready for ce-plan
origin: conversation (owner rulings, 2026-08-14/15)
evidence: docs/reviews/2026-08-14-pr91-findings/ (24 reports, 12 of them adversarial)
---

# PR 91 — foundation hardening, status substrate, and portfolio respec

## Summary

PR 91 hardens the three shipped features, fixes every verified finding, builds a durable per-entity
status substrate on DynamoDB, and re-specs features 004–014 so the worktrees can rebase onto a
coherent portfolio. No new user-visible feature ships in this PR; the import UI follows in 004's own
branch.

## Problem frame

Three shipped features (001 recipe core, 002 auth, 003 food data) carry defects that a 24-report review
found and verified, including a **compound GDPR failure where all three defence layers are
simultaneously non-functional**. Meanwhile features 004–014 were specified independently and have
drifted into contradiction — two features owned photo import, two claimed the same ALB priority, and
several specify foreign keys across database boundaries that cannot exist.

Separately, asynchronous work (bulk import, food resolution, OCR) has no way to tell a client what is
happening. Producers cannot deliver a message anywhere durable: the event emitter is a console stub and
the AWS SDK for the bus is a dependency of no package.

## Requirements

### R1 — Message substrate

- **R1.1** Any backend producer — Fargate service, Lambda, or worker — MUST be able to deliver a
  message asynchronously to permanent storage. Producers MUST NOT require VPC attachment, a database
  connection, or a migration to do so.
- **R1.2** Messages MUST be grouped by entity, and a consumer MUST be able to read **all** messages for
  a group. Per-group history, not just the latest.
- **R1.3** Messages MUST NOT be lost or dropped once accepted.
- **R1.4** Producing MUST be fire-and-forget. A producer does not await consumers, does not know they
  exist, and does not handle their failures.
- **R1.5** The substrate MUST cost nothing at idle and MUST scale to high volume without added latency
  or loss.
- **R1.6** Consumers, not the substrate, decide which message in a group wins. The substrate performs
  **no** compaction, no supersession, no watermarking.
- **R1.7** Message expiry MUST be enforced, and is a **cost control**, not hygiene — without it storage
  alone reaches roughly $330/month by month 12.
- **R1.8** The notification service MUST be **notified** when messages arrive. Client polling is
  explicitly rejected.
- **R1.9** Producers MUST NOT know the storage technology. They depend on a published port; exactly one
  adapter knows the store.

### R2 — Food placeholders and status

- **R2.1** The food service MUST create a placeholder row when a recipe references an unresolved
  ingredient, and MUST advance its status until source data completes the entry.
- **R2.2** Placeholder status MUST be readable from the database at any time, so a client connecting
  mid-flight renders correct state from a read.
- **R2.3** Every placeholder MUST have a reachable terminal state. A stalled placeholder MUST NOT leave
  a user waiting indefinitely.
- **R2.4** A shell entry is **not** a recipe written into the food database. The single-writer rule
  stands; the food service's own resolution pipeline creates and advances it.

### R3 — Shipped-defect remediation

- **R3.1** Account erasure MUST actually erase, across every service that holds the user's data, and
  the UI MUST NOT claim more than it does.
- **R3.2** Every alarm MUST be capable of firing and MUST reach a human.
- **R3.3** Nutrition selection MUST be deterministic. Energy in kJ MUST NOT be stored as kcal.
- **R3.4** Every finding in `docs/reviews/2026-08-14-pr91-findings/` MUST be resolved, or explicitly
  recorded as rejected with a reason.

### R4 — Standards conformance

- **R4.1** One file-naming regime for every package. No hyphens, no underscores. _(landed: 028f88c9)_
- **R4.2** One file, one thing — one class, one component, one functionality. No god files.
- **R4.3** Every rule in `CODING_STANDARDS.md` that CAN be mechanically enforced MUST be, and the
  document MUST NOT contain two rules that contradict each other.

### R5 — Portfolio respec

- **R5.1** Features 004–014 get spec, plan and task updates only — **no implementation** in PR 91.
- **R5.2** No two features may claim the same ALB listener priority, and none may exceed the ceiling.
- **R5.3** No spec may declare a foreign key across a database boundary.
- **R5.4** Feature 011 MUST specify a reaper removing its own stale jobs and artifacts after 3 days,
  cross-referencing ADR-0016's window so the two do not drift.
- **R5.5** Feature 011 MUST specify that the consumer selects the most recent message in a group **by
  timestamp**, and MUST state the single-writer-per-group invariant that makes timestamp selection safe.

## Key decisions

| #   | Decision                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **DynamoDB** (`PK=group`, `SK=timestamp`) as the substrate                           | Only DynamoDB and a Postgres table satisfied all six requirements; every deliver-then-delete product (SQS, SNS→SQS) fails R1.2 outright, EventBridge replay is unordered and ungrouped, Kinesis costs $10.95–29.20/mo at idle, MSK Serverless idles at $547.50/mo, and Valkey bills storage per GB-**hour** ($61.32/GB-month). Postgres was excluded by owner ruling: producers must not need database access. |
| D2  | Producers `PutItem` directly; **no outbox, no relay**                                | The outbox solves dual-write _correctness_ between two sources of truth. Here the row is the sole source of truth. Flip condition: if automation ever derives durable state transactionally from the message stream, revisit.                                                                                                                                                                                  |
| D3  | **DynamoDB Streams → Lambda** for notification                                       | Ordering is guaranteed per partition key, so a group arrives in order for free. GetRecords via a Lambda trigger is **not billed**. The stream is the notification; the table is the truth — a consumer down beyond the 24h stream window recovers by `Query`, not by loss.                                                                                                                                     |
| D4  | Expiry via **TTL**, 3 days                                                           | Cost control (R1.7). Caveat: TTL is best-effort within ~48h of expiry, so if 3 days is a hard privacy boundary it needs explicit deletion instead.                                                                                                                                                                                                                                                             |
| D5  | Port named **`publish` / `OutboundMessage`** in a shared package                     | The seam already exists as `EventBus.putEvent` inside food-service, documented as "source-agnostic". It is renamed (the old name implies a bus that isn't there) and promoted so any producer can use it. Adapters: Dynamo, Console (dev), InMemory (tests). Producers also get IAM scoped to `PutItem` on one table ARN, so the boundary is enforced by permission as well as by code.                        |
| D6  | **AWS Textract** as the default OCR provider                                         | Reverted from Tesseract on measurement: two independent runs put Tesseract at 16.8s and 37s on dense pages against `NFR-001`'s 10s, it is single-threaded so no memory tier helps, ML Kit's handwriting API reads stylus strokes rather than photographs, Tesseract scores 30–55% on cursive, and `004/research/tech-stack.md:41` had already evaluated and rejected it. The saving was ~$1.50/month.          |
| D7  | Mobile does on-device OCR for **printed** text and submits raw text                  | 004 gains a first-class raw-text channel. The text is classified `imported_paid`, never `imported_physical`, so the premium gate keeps its enforcement point and `FR-025`'s no-caller-declared-provenance rule is not inverted.                                                                                                                                                                                |
| D8  | **Per-domain async processors**, converging only at recipe creation                  | The post-extraction path is not identical across channels — OCR needs per-token confidence with geometry, a correction state, and different quota accounting. One shared processor would have grown flags. They share a **contract** in a shared package, not a base class or a runtime.                                                                                                                       |
| D9  | Nutrition is a **live reference**, with a carve-out                                  | 006's spec independently reached the same conclusion. Carve-out: 009's recorded historical outcomes (`nutrition_compliance.actual_*` **and** `planned_*`) must pin with `computed_at`, since "actual" means historical fidelity.                                                                                                                                                                               |
| D10 | **Drop `lead_calories_per_serving`**                                                 | Three reviews converged. Today cards read a frozen column while detail computes live, so the database holds two answers and `nutrition.ts:66-69`'s "can never disagree" is false. Dropping it is not an N+1 — two batched `ANY($1)` scans on existing indexes.                                                                                                                                                 |
| D11 | E2E = mocked Playwright for the UI state matrix + **local full stack** for the spine | No dependency on a per-PR deploy.                                                                                                                                                                                                                                                                                                                                                                              |
| D12 | Services run **1 task**, not 2                                                       | Two-task defaults are an HA posture against zero production traffic. Cost is not a constraint on this topology: ~$99/mo actual today, and the $360/mo figure that drove earlier alarm assumed a posture that isn't run.                                                                                                                                                                                        |

## Scope boundaries

**In scope — implementation:** features 001, 002, 003; all verified findings; the message substrate and
its port; food placeholder creation and status progression; standards conformance and its enforcement.

**In scope — specification only:** features 004 through 014, including 004's recipe placeholders and
raw-text channel, and 011's reaper and timestamp-selection rule.

**Explicitly out:**

- The import UI — 004's worktree is 16 commits ahead with the import spine, file channel and typed
  client already built; the missing piece is UI, and it lands there after rebase.
- 011's image branch and correction UI.
- Feature 014 beyond the substrate.
- Splitting god files — the check is added and violations enumerated; the splits are a separate task.

## Success criteria

- **SC1** A recipe is created, its ingredients resolve, a food placeholder is created, its status
  advances to resolved, and nutrition appears — provable end to end on the local full stack.
- **SC2** A producer publishes without knowing the store; swapping the adapter requires no producer
  change; an in-memory adapter serves the tests.
- **SC3** All messages for a group are retrievable in one query, in order.
- **SC4** Account erasure verifiably removes the user's data from every service that holds it.
- **SC5** Every alarm has a subscriber and a dimension set that can produce a datapoint.
- **SC6** `npm run lint` reports zero filename and god-file violations.
- **SC7** No spec declares a cross-database foreign key or a duplicate ALB priority.

## Dependencies and assumptions

- **A1** Producers authenticate to DynamoDB by IAM. Verified: no VPC or database access needed.
- **A2** The recipe→food HTTP call from a background processor still has **no service credential**. The
  proposed unblock is a second audience on the existing EdDSA erasure token, whose public key food
  already holds. This blocks the placeholder half, not the substrate.
- **A3** `CREATE INDEX CONCURRENTLY` **cannot run** — both migration runners wrap each file in a
  transaction. Any index work must account for this.
- **A4** Mobile on-device OCR is a build-posture change: it forces an EAS dev-client and retires Expo Go.

## Outstanding questions

- **Q1** Feature 006's extraction into its own service has been refuted twice — first as circular
  reasoning, then because C-006-001's "three destructive sweepers" premise is empirically false (all
  three are per-row or hand-enumerated). Revert to ADR-0017 as written, or extract on new grounds?
- **Q2** The dual-write window: a producer dying between its state change and `PutItem` leaves no
  message. Accept it, order writes so the benign failure wins, or add a reconciliation sweep?
- **Q3** "Live reference" has two readings — one additive and reversible, one destructive and
  irreversible that changes meaning at deploy before any DDL. Which is meant?
- **Q4** Handwriting on Android: ML Kit cannot read handwriting from photographs. Does the mobile path
  fall back to Textract for handwriting, or is handwriting web-only until 011?
- **Q5** Is the 3-day expiry a hard boundary (needs explicit deletion) or a target (TTL is fine)?
