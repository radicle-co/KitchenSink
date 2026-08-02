# Review Log: Cooking School (Video Learning Platform)

> Feature: `013-cooking-school` | Status: **DRAFT — READY FOR M7 PLANNING REVIEW**
> Started: 2026-05-12
> Last Updated: 2026-05-12

**Mode**: Retroactive bootstrap
**Governance Rules**: [`governance-rules.md`](../governance-rules.md)

## Milestone Assignment

- **Milestone**: `M7` Minas Tirith
- **Public launch**: Post-1.0 (in v1)
- **Source of truth**: ../v1-launch-plan.md
- **Last updated**: 2026-08-02

---

## Current Status

This feature now has milestone-aware planning artifacts required for M7 execution:

- [`plan.md`](./plan.md)
- [`tasks.md`](./tasks.md)
- [`review.md`](./review.md)

The artifacts are grounded in:

- [`spec.md`](./spec.md)
- [`product-spec/product-spec.md`](./product-spec/product-spec.md)
- [`research.md`](./research.md)
- [`v-model/`](./v-model/)

---

## M7 Alignment Snapshot

Reference: [`v1-launch-plan.md` §3.8](../v1-launch-plan.md#38-m7--milestone-minas-tirith)

For 013, M7 requires:

1. Plan/tasks/review/verify artifact generation from existing feature corpus.
2. Burn-down to `0 CRITICAL, 0 WARNING` in `verify-report.md`.
3. Closure of untested and missing traceability mappings.
4. Demonstrable creator publish + learner enrollment flows with subscription-aware gating.

Current state:

- Item (1): **Completed** for planning layer (`plan.md`, `tasks.md`, `review.md`).
- Items (2)-(4): **Planned and decomposed** in `tasks.md`, pending implementation and evidence ingestion.

---

## Governance Compliance Planning Check

### GR-002 — API URL Prefix Standard

Rule: [GR-002](../governance-rules.md#gr-002-api-url-prefix-standard)

- Planned API families in 013 artifacts use `/api/v1/...`.
- Route-prefix guardrails are explicitly tasked.

**Status**: Planned compliant (implementation verification pending).

### GR-007 — Shared Type Library Ownership

Rule: [GR-007](../governance-rules.md#gr-007-shared-type-library-ownership)

- 013 tasks require consumption of canonical shared-domain entities.
- Local duplicate source-of-truth models are explicitly prohibited.

**Status**: Planned compliant (implementation verification pending).

### GR-012 — Subscription Gating Mechanism

Rule: [GR-012](../governance-rules.md#gr-012-subscription-gating-mechanism)

- Purchase-to-enrollment access enforcement is modeled server-side.
- Integration is tied to shared 010 gating primitives, not feature-local variants.

**Status**: Planned compliant (implementation verification pending).

### GR-014 — Audience and Sharing Model

Rule: [GR-014](../governance-rules.md#gr-014-audience-and-sharing-model)

- `published-lesson` is governed by GR-014; 013 owns the lesson/course access rules applied to that canonical scope.
- Preview/non-preview access behavior is explicitly separated in plan + tasks.

**Status**: Planned compliant (implementation verification pending).

---

## Cross-Feature Integration Readiness

| Feature                                                         | Integration Focus                        | Planning Status                 |
| --------------------------------------------------------------- | ---------------------------------------- | ------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)           | Auth/session/role checks                 | Covered in plan + tasks         |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | Recipe linkage in lessons/player drawer  | Covered in plan + tasks         |
| [005-ai-integration](../005-ai-integration/spec.md)             | AI script drafting endpoint integration  | Covered in plan + tasks         |
| [010-subscriptions](../010-subscriptions/spec.md)               | Purchase + entitlement + gating          | Covered in plan + tasks         |
| [012-creator-profiles](../012-creator-profiles/spec.md)         | `@handle` identity/discovery projection  | Covered in plan + tasks         |
| [014-notification-service](../014-notification-service/spec.md) | Event hooks for downstream notifications | Planned as integration boundary |

---

## Traceability and Test-Evidence Gap Status

Source: [`v-model/release-audit-report.md`](./v-model/release-audit-report.md), [`v-model/traceability-matrix.md`](./v-model/traceability-matrix.md)

Observed baseline at review time:

- `34` missing traceability mapping cells
- `204` mapped scenarios still `⬜ Untested`
- Release audit status: `❌ BLOCKED`

Planned closure path:

1. Execute implementation and test suites per `tasks.md`.
2. Replace placeholder/missing matrix links with concrete test-case mappings.
3. Ingest real pass/fail/waiver evidence.
4. Regenerate `release-audit-report.md` and produce `verify-report.md` with `0/0` findings.

---

## Decisions and Open Questions

### Confirmed Decisions

1. v1 scope remains async video courses only; live classes are Phase 2.
2. Completion threshold remains `>=80% watch_percent`.
3. M7 is the authoritative sequencing and launch context for 013.

### Open Questions (Director/Implementation Gate)

1. **Revenue split policy finalization**: exact tier percentages by creator plan and dispute-adjustment rules from 010.
2. **Preview policy strictness**: whether any course can expose more than one preview lesson under experimentation flags.
3. **Transcode SLA objective**: target p95 processing time for publish-ready lesson assets in M7.
4. **Compliance operations SLA**: takedown/dispute response-time target required for milestone signoff.
5. **012/013 launch coupling**: whether creator profile discoverability must be fully GA in 012 before any paid 013 course listing is enabled.

---

## Exit Evidence Checklist (M7)

- [ ] `verify-report.md` exists and reports `0 CRITICAL, 0 WARNING`.
- [ ] `v-model/release-audit-report.md` no longer blocked.
- [ ] End-to-end evidence: creator publish, learner purchase, enrollment, gated playback, progress persistence.
- [ ] Governance evidence links attached for GR-002/007/012/014.
- [ ] Cross-feature contract compatibility evidence attached for 002/005/010/012.

---

## Revision Log

### 2026-05-12 — Planning Artifact Generation

- Replaced draft planning artifacts with M7-aligned Speckit-style `plan.md`, `tasks.md`, and `review.md`.
- Added explicit launch-plan and governance cross-links.
- Added mandatory milestone line immediately after `**Mode**:` per request.
