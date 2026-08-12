# Sync-Verify Report: 010-subscriptions

**Run Date**: 2026-06-02 (Pre-Implementation)
**Feature Path**: `specs/010-subscriptions/`
**Layers Scanned**: L1, L2, L3, L4, L7 | L5 Skipped | L6 INFO

## Executive Summary

| Layer                     | Status   | Severity | Notes                                                                  |
| ------------------------- | -------- | -------- | ---------------------------------------------------------------------- |
| L1: spec ↔ product-spec   | **PASS** | —        | All FRs/NFRs/Decisions mirrored                                        |
| L2: spec ↔ plan Must-Have | **PASS** | —        | FR-040..043 fully addressed by plan architecture                       |
| L3: plan ↔ tasks          | **PASS** | —        | 28 tasks cover all plan sections; minor label drift                    |
| L4: spec ↔ V-Model        | **PASS** | —        | REQ-001..031 ↔ FR-040..043 fully mapped                                |
| L5: code ↔ tasks          | **SKIP** | —        | Per instruction                                                        |
| L6: missing impl          | **INFO** | —        | 0/28 tasks complete; expected pre-impl gap                             |
| L7: cross-feature deps    | **PASS** | —        | 002, 001, 004, 005, 006, 007, 009 refs valid; no broken `apps/X` links |

**Overall Verdict**: **PASS** — All required layers are synchronized and ready for implementation. No `CRITICAL` findings found.

---

## L1: spec.md ↔ product-spec Consistency

### Scope

Check that every requirement, decision, and success criterion in `spec.md` has a corresponding elaboration in `product-spec/`.

### Evidence

- **FR-040** (free tier) → `product-spec.md` Core principle #1, `user-journey.md` Journey A baseline usage, `wireframes/` free-tier UX.
- **FR-041** (premium tier) → `product-spec.md` Core principle #2, pricing table ($6.99/mo, $59.99/yr), `user-journey.md` Journey B upgrade flow, `metrics.md` MET-010-004..MET-010-006.
- **FR-042** (upgrade prompts) → `product-spec.md` Core principle #3, `user-journey.md` Journey A paywall modal, `wireframes/paywall-modal.md`, `wireframes/pricing-page.md`.
- **FR-043** (data retention on lapse) → `product-spec.md` Core principle #4, `user-journey.md` Journey C downgrade/reactivation, D-3 7-day grace.
- **NFR-001..NFR-004** → Referenced implicitly in `codebase-analysis.md`, `wireframes/` a11y notes, and peer-review artifacts.
- **D-1..D-8** → Closed Decisions table in `product-spec.md`; full rationale in `review.md` Revision 1.
- **SC-005, SC-006** → Present in `spec.md` and decomposed in `product-spec/metrics.md` (MET-010-001..MET-010-003, conversion funnel).

### Result

**PASS** — No missing mappings.

---

## L2: spec.md Must-Have ↔ plan.md Coverage

### Scope

Verify that all `MUST` / P0 / P1 requirements in `spec.md` are addressed by `plan.md` architecture.

### Evidence

| Requirement              | Plan Section                                                                                                                        | Decision Trace                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| FR-040 (free tier)       | plan.md §2 Account Entity Additions (default `plan='free'`), §4 Feature Gating Map (no gating on free endpoints)                    | OQ-1: unlimited public recipes                |
| FR-041 (premium tier)    | plan.md §3 API Contracts (checkout/portal), §4 Feature Gating Map (gated endpoints), §5 Stripe Billing Stack, trial_period_days: 14 | OQ-3: monthly + annual pricing                |
| FR-042 (upgrade prompts) | plan.md §8 Upgrade Prompts (three-tier hierarchy), TASK-022 web, TASK-024 mobile                                                    | D-5: three-tier hierarchy confirmed           |
| FR-043 (retention/lapse) | plan.md §2 Data Model (retain on lapse), §7 Subscription States, TASK-026 data retention, TASK-027 read-only                        | D-3: 7-day grace, D-4: retain private recipes |

### Result

**PASS** — All Must-Have FRs are mapped to plan architecture.

---

## L3: plan.md ↔ tasks.md Consistency

### Scope

Verify that every plan section has one or more tasks implementing it, and task dependency order is coherent.

### Evidence

| Plan Section                                    | Task IDs           | Coverage                                                                                     |
| ----------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| §2 Data Model (Account + stripe_webhook_events) | TASK-002, TASK-003 | Drizzle migrations for columns and idempotency table (⚠️ table renamed 2026-08-12, ADR-0018) |
| §3 API Contracts (Billing endpoints)            | TASK-009..TASK-013 | BillingService + BillingController + unit tests                                              |
| §3 API Contracts (Webhook endpoint)             | TASK-014..TASK-020 | WebhookController, WebhookService, handlers, integration tests                               |
| §4 Feature Gating Map                           | TASK-004..TASK-007 | Decorator, guard, endpoint application, unit tests                                           |
| §5 Stripe Billing Stack                         | TASK-001, TASK-008 | StripeModule config, BillingModule scaffold                                                  |
| §7 Subscription States                          | TASK-016..TASK-019 | checkout, invoice, subscription, trial-ending handlers                                       |
| §8 Upgrade Prompts                              | TASK-021..TASK-024 | HTTP interceptor, web + mobile UI components                                                 |
| §9 Testing                                      | TASK-025           | E2E upgrade flow (Playwright)                                                                |
| FR-043 Retention                                | TASK-026, TASK-027 | Cancellation data retention + read-only guards                                               |
| Mobile parity                                   | TASK-028           | Subscription status display + portal deep-link                                               |

### Findings

- **W-001** (`WARNING`): TASK-020 is labeled "Integration tests for webhook handlers" but `plan.md` does not explicitly map a dedicated integration-test module for webhooks; the closest plan reference is §9 "E2E upgrade flow". Recommend reconciling during implementation whether TASK-020 executes as integration tests or E2E tests.

### Result

**PASS** — With 1 minor naming drift (WARNING only).

---

## L4: spec.md ↔ V-Model Consistency

### Scope

Verify that V-Model requirements and traceability matrices cover all FRs/NFRs from `spec.md`.

### Evidence

- **FR-040** ↔ `requirements.md` REQ-001..REQ-007 (free-tier entitlements and default assignment)
- **FR-041** ↔ `requirements.md` REQ-008..REQ-018 (premium features), REQ-026 (pricing), REQ-027 (14-day trial)
- **FR-042** ↔ `requirements.md` REQ-029 (three-tier prompt hierarchy), REQ-030 (clear CTA), REQ-031 (respectful non-intrusive)
- **FR-043** ↔ `requirements.md` REQ-019..REQ-025 (data retention, lapse behavior), REQ-028 (7-day grace period)
- `traceability-matrix.md` maps REQ-001..REQ-031 to AC-001..AC-027.
- `system-design.md` decomposes into SYS-001..SYS-013; `architecture-design.md` decomposes into ARCH-001..ARCH-018.

### Result

**PASS** — Bidirectional coverage complete.

---

## L5: code ↔ tasks

**Skipped** per instruction.

---

## L6: Missing Implementation

### Scope

Surface any already-implemented tasks or missing-impl code patterns.

### Evidence

- `.forge-status.yml` line 71: `implement: not-started`
- `tasks.md` defines 28 tasks; none have checked execution markers.
- No source files for `src/billing/`, `PlanGuard`, `BillingService`, `WebhookService`, or Stripe-related modules exist under `packages/apps/commise/`.
- No Drizzle migrations for subscription columns or the `stripe_webhook_events` table exist. (⚠️ Named `webhook_events` when this report was written; renamed 2026-08-12 per ADR-0018 — a table of that name already ships for Clerk/svix dedup.)

### Result

**INFO** — Expected pre-implementation gap.

---

## L7: Cross-Feature & Cross-Reference Sanity

### Scope

Ensure all referenced features and paths exist; flag any `apps/X` broken references.

### Evidence

- `spec.md` Dependencies table references 002-user-auth (required), 001-commise-recipe-app, 004-recipe-importing, 005-ai-integration, 006-meal-planning, 007-grocery-lists, 009-nutrition-planning — all present in sibling `specs/` directories.
- `research/codebase-analysis.md` references `packages/apps/commise/web` and `packages/apps/commise/mobile` as valid monorepo workspace paths.
- No stray `apps/X` path references found in artifact body text.

### Result

**PASS** — No dangling references.

---

## Findings Summary

| ID    | Severity | Layer | Description                               | Resolution                      |
| ----- | -------- | ----- | ----------------------------------------- | ------------------------------- |
| W-001 | WARNING  | L3    | TASK-020 label drift (integration vs E2E) | Reconcile during implementation |

---

**END OF REPORT**
