# Review Log: Notification Service

> Feature: `014-notification-service` | Status: **DRAFT — M8 Planning Artifacts Regenerated**
> Started: 2026-05-12
> Last Updated: 2026-05-12

**Mode**: Product Forge remediation (planning artifacts)
**Governance Rules**: [`governance-rules.md`](../governance-rules.md)

## Milestone Assignment

- **Milestone**: `M8` Mordor
- **Public launch**: Post-1.0 (in v1)
- **Source of truth**: ../v1-launch-plan.md
- **Last updated**: 2026-08-02

---

## Current Status

Feature 014 now has regenerated planning artifacts aligned to M8 bootstrap remediation requirements:

- `plan.md` — architecture choice (hybrid queue + realtime + replay), trigger inventory, channel scope, preferences strategy, dependency/rollout model.
- `tasks.md` — dependency-ordered atomic task graph with explicit test and governance closure tasks.
- `review.md` — this milestone/governance tracking log.

`verify-report.md` and execution evidence are still pending and are tracked in `tasks.md` (Phase 7).

---

## M8 Alignment Snapshot

Source: [`../v1-launch-plan.md`](../v1-launch-plan.md) (§3.9 `M8` Milestone Mordor).

### Entry

- [x] M7 dependency acknowledged as external gate.
- [x] Required planning artifacts (`plan.md`, `tasks.md`, `review.md`) exist.

### Artifact Remediation

- [x] Plan/task/review artifacts regenerated from existing 014 inputs.
- [ ] `verify-report.md` generated and burned to `0 CRITICAL, 0 WARNING`.
- [ ] V-model traceability gaps + untested execution gaps closed.
- [x] Notification ownership contract documented per GR-011 in planning artifacts.

### Exit (not yet complete)

- [ ] `verify-report.md` at `0 CRITICAL, 0 WARNING`.
- [ ] `v-model/release-audit-report.md` unblocked with ingested execution results.
- [ ] Integrated notification flows demonstrated across required producer surfaces.

---

## Governance Conformance (Planning Stage)

Source rules: [`../governance-rules.md`](../governance-rules.md).

| Rule                                                                                                | Planning status   | Evidence                                                                               |
| --------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| [GR-002 API URL Prefix Standard](../governance-rules.md#gr-002-api-url-prefix-standard)             | Planned compliant | `plan.md` and `tasks.md` constrain routes to `/api/v1/notifications/*`.                |
| [GR-007 Shared Type Library Ownership](../governance-rules.md#gr-007-shared-type-library-ownership) | Planned compliant | **Corrected 2026-08-05.** 014 introduces no duplicate of any `@kitchensink/recipe-core` entity; notification envelopes are a new bounded namespace in `@kitchensink/notification-types` (T-002), which satisfies NFR-008's `@kitchensink/{group}-{name}` convention. The group model is added to the identity service rather than duplicated in 014 (Q-002), which is the substantive GR-007 conformance here. |
| [GR-011 Notification System Ownership](../governance-rules.md#gr-011-notification-system-ownership) | Planned compliant | 014 designated as owner interface; producer-integration tasks enumerated.              |
| [GR-008 Node.js Runtime Version](../governance-rules.md#gr-008-nodejs-runtime-version)              | Planned compliant | Node 24.x included as setup constraint/tasks.                                          |
| [GR-009 Package Naming Convention](../governance-rules.md#gr-009-package-naming-convention)         | Planned compliant | Naming checks included in setup/governance tasks.                                      |

No production compliance claim is made until implementation + verification evidence is attached.

---

## Cross-Feature Trigger Ownership Review (`001`–`013`)

Cross-feature inventory is captured in `plan.md` and converted into coordination tasks (`T042`–`T051`) in `tasks.md`.

### Confirmed / firm triggers

- **003**: `food.backfill.completed`, `food.fetch.failed`.

### High-priority trigger contracts pending producer sign-off

- **005**: AI disclosure/compliance notification taxonomy.
- **008**: timer alert event taxonomy + latency SLO.
- **009**: compliance-gap/deficiency notification scope decision.
- **012**: moderation/action-result creator notifications.
- **013**: publish/enroll milestone notifications.

### Scope decision pending Director/owners

- Whether **006**, **007**, **010** are M8 hard exit blockers or acceptable as hook-ready integrations.

---

## Open Questions (Actionable)

1. ~~**Group membership source of truth** for `recipient.kind=group`.~~ **CLOSED
   2026-08-05 (owner):** the **identity service** owns groups and 014 builds them
   there — a `group` / `group_membership` model plus `/api/v1/groups/*` in
   `packages/services/identity`, deliberately **not** Clerk Organizations. See
   `plan.md` → _Group Model_, tasks T-023 – T-025.
2. **Transport detail finalization** inside hybrid architecture. **Partially closed
   2026-08-05:** ordering is decided (SQS FIFO, `MessageGroupId = recipient.id`, with
   the routing consumer as the sole per-recipient sequence authority — `plan.md` →
   _Ordering & Partitioning_). **Still open:** the realtime subscribe protocol itself
   (SSE vs WebSocket), pending the research follow-up on whether either client already
   holds a long-lived connection.
3. **M8 blocker list finalization** for `006`, `007`, `010` integration depth.
4. **Trigger ownership roster**: named owner + schema approver + oncall for each producer feature trigger.
5. **Producer authentication mechanism (product-spec Q-004)** — FR-002 requires
   service-to-service auth "aligned with 002", but no artifact decides the mechanism
   and the repo has no service-to-service pattern to copy (identity verifies Clerk
   *user* session tokens). Raised to actionable 2026-08-05: this blocks T-003.
6. **Are global broadcasts retained for offline catch-up (product-spec Q-009)?**
   `spec.md` says live-only; `user-journey.md` Journey C says retrievable later. The
   story map now follows `spec.md`; Journey C needs correcting once confirmed.

---

## Outstanding — reconciliation debt (opened 2026-08-05)

The 2026-08-05 sync-verify run resolved 13 drift findings across the planning
artifacts. Two consequences are **not** yet discharged:

1. **The `v-model/` chain predates the scope added on 2026-08-05.** Its 31 `REQ-NNN`
   rows map 1:1 to `spec.md`'s 23 FR + 8 NFR as they stood on 2026-05-13. They do not
   cover the identity group model (Q-002), the ordering/sequence authority, or the
   client bell surface. The chain must be **regenerated**, not hand-patched, before
   `T-020` can close the M8 exit gate — a traceability matrix that silently omits a
   third of the delivered scope is worse than no matrix. This is the prerequisite
   recorded on T-020.
2. **`verify-report.md` is superseded, not repaired.** It measured a task graph that
   never existed. It is regenerated by Phase 7 after implementation.

---

## Cross-Artifact Links

- Feature spec: [`spec.md`](./spec.md)
- Product spec: [`product-spec/product-spec.md`](./product-spec/product-spec.md)
- Research: [`research/README.md`](./research/README.md), [`research/codebase-analysis.md`](./research/codebase-analysis.md)
- Plan: [`plan.md`](./plan.md)
- Tasks: [`tasks.md`](./tasks.md)
- Governance authority: [`../governance-rules.md`](../governance-rules.md)
- Milestone authority: [`../v1-launch-plan.md`](../v1-launch-plan.md)
