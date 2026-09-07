# Review Log: Notification Service

> Feature: `014-notification-service` | Status: **DRAFT — M8 Planning Artifacts Regenerated**
> Started: 2026-05-12
> Last Updated: 2026-08-10

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

- `plan.md` — architecture choice (hybrid queue + realtime + replay), the **two-adapter producer ingress**
  and its trust boundary (FR-024 – FR-033, propagated 2026-08-10), trigger inventory, channel scope,
  preferences strategy, dependency/rollout model.
- `tasks.md` — dependency-ordered atomic task graph with explicit test and governance closure tasks,
  T-001 – T-048.
- `review.md` — this milestone/governance tracking log.

`verify-report.md` and execution evidence are still pending and are tracked in `tasks.md` (Phase 7).

**Amendment of 2026-08-10.** The owner added ten functional requirements and four success criteria: dual
ingress over one core (FR-024), envelopes-never-domain-events (FR-025), a normative minimum envelope
(FR-026), the event path's two-control trust boundary (FR-027), event-path dead-lettering (FR-028),
cross-path ordering on producer-assigned `occurredAt` (FR-029), idempotency-key derivation from durable
state (FR-030), publisher-owned correlation (FR-031), the concrete Ed25519 producer-auth mechanism (FR-032),
and per-producer declared quotas (FR-033). Tasks T-034 – T-048 carry the work. The amendment closes Q-004
and raises Q-006's urgency; it does not change the milestone or the delivery scope of any user story.

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

| Rule                                                                                                | Planning status   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GR-002 API URL Prefix Standard](../governance-rules.md#gr-002-api-url-prefix-standard)             | Planned compliant | `plan.md` and `tasks.md` constrain routes to `/api/v1/notifications/*`. **Noted 2026-08-10:** the EventBridge ingress (FR-024) exposes no URL, so GR-002 does not reach it; its equivalent constraint is the reserved `detailType` plus the `source` allowlist (FR-025, FR-027).                                                                                                                               |
| [GR-007 Shared Type Library Ownership](../governance-rules.md#gr-007-shared-type-library-ownership) | Planned compliant | **Corrected 2026-08-05.** 014 introduces no duplicate of any `@kitchensink/recipe-core` entity; notification envelopes are a new bounded namespace in `@kitchensink/notification-types` (T-002), which satisfies NFR-008's `@kitchensink/{group}-{name}` convention. The group model is added to the identity service rather than duplicated in 014 (Q-002), which is the substantive GR-007 conformance here. |
| [GR-011 Notification System Ownership](../governance-rules.md#gr-011-notification-system-ownership) | Planned compliant | 014 designated as owner interface; producer-integration tasks enumerated.                                                                                                                                                                                                                                                                                                                                      |
| [GR-008 Node.js Runtime Version](../governance-rules.md#gr-008-nodejs-runtime-version)              | Planned compliant | Node 24.x included as setup constraint/tasks.                                                                                                                                                                                                                                                                                                                                                                  |
| [GR-009 Package Naming Convention](../governance-rules.md#gr-009-package-naming-convention)         | Planned compliant | Naming checks included in setup/governance tasks.                                                                                                                                                                                                                                                                                                                                                              |

No production compliance claim is made until implementation + verification evidence is attached.

---

## Cross-Feature Trigger Ownership Review (`001`–`013`)

Cross-feature inventory is captured in `plan.md` and converted into coordination tasks in `tasks.md` —
T-017, T-018, T-021, T-022 and T-042 – T-046. **The ids previously cited here, `T042`–`T051`, do not exist
in `tasks.md` and never did** (corrected 2026-08-10).

### Confirmed / firm triggers

- **003**: `food.resolution.completed` — the keyword named by 003's own decision register. The names
  previously recorded here, `food.backfill.completed` and `food.fetch.failed`, exist in no artifact of 003:
  its **domain events** are `FoodFetchCompleted` and `FetchFailed`, which are not notification keywords.
  Published by the recipe service (T-044), not the food service, because `FetchQueueDao.resolve` deletes
  `fetch_requesters` in the transaction that completes the food.

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
5. ~~**Producer authentication mechanism (product-spec Q-004)**~~ **CLOSED 2026-08-10 (owner
   amendment).** FR-032 names the platform **Ed25519 service-principal token**, verified
   **networklessly** against a public key — the scheme already deployed as
   `FOOD_SERVICE_PRINCIPAL_JWT_KEY` and implemented in `packages/shared/recipe-core`. The
   2026-08-05 claim that the repo had no service-to-service pattern to copy was **wrong**;
   it surveyed the identity service only. T-039 replaces T-003's placeholder auth.
   The event path is a separate answer: it has no credential, so its trust boundary is the
   bus resource policy **plus** `source` allowlisting (FR-027, T-035).
6. **Are global broadcasts retained for offline catch-up (product-spec Q-009)?**
   `spec.md` says live-only; `user-journey.md` Journey C says retrievable later. The
   story map now follows `spec.md`; Journey C needs correcting once confirmed.
7. **Does `recipient.kind = "global"` need a capability check beyond publish auth
   (product-spec Q-006)?** Opened long ago; **now load-bearing.** A global envelope can
   arrive over the event path, which has no credential, so any such check must live in the
   shared ingress core (FR-024) rather than the HTTP adapter — otherwise the event path
   bypasses it, which is the defect FR-024 declares. Owner decision needed before T-035.
8. **Is `occurredAt` trustworthy enough to be the cross-path ordering key (FR-029)?**
   It is producer-assigned, and producers do not share a clock. Skew between two publishers
   addressing one recipient is HAZ-037's mechanism. T-038 must either establish a bound or
   narrow FR-008 explicitly.
9. **Which names the producer on the event path — the envelope's `producer` field (FR-026)
   or the validated event `source` (FR-027)?** `spec.md` requires both and says which is
   authoritative for neither. The V-Model chain resolves it the only safe way — the registry
   `producer` mapped from the allowlisted `source` is the identity; the envelope field is
   persisted for the record and never trusted — because trusting the field would let an
   allowlisted principal attribute a publish to another producer and inherit its quota.
   **FR-026 should be amended to say the field is record-only.** Blocks T-034/T-035.
10. **Should FR-001's inline envelope shape be rewritten to point at FR-026?** FR-001
    still lists `{ recipient, messageType, payload, occurredAt, idempotencyKey? }` with no
    `schemaVersion` and no `producer`, and REQ-001 and SYS-001 mirror it faithfully, so the
    SYS-001 system test still advertises a contract FR-026 superseded. The descriptive
    _Key Entities_ entry was corrected in place on 2026-08-10; FR-001 is normative and was
    not touched. Same shape as the FR-002/FR-032 overlap.
11. **What unit is a per-producer quota expressed in?** FR-019 and FR-033 state none.
    US-011's acceptance scenario says `K/sec`, and the V-Model chain uses
    `publishQuotaPerSecond` throughout on that basis. The unit belongs in FR-019, not only
    in a user story and a module design.
12. **Is SC-011's "delivered exactly once" the promise intended?** `plan.md` records that SQS
    delivery is at-least-once and `spec.md` US-010 says consumers MUST treat handlers as
    idempotent, so exactly-once _delivery_ is not on offer. SC-011 is satisfiable as written
    only if it means the **publish-side collapse** — one replayed event with an unchanged
    `idempotencyKey` produces one notification row and one delivery attempt per client. Read
    literally it promises more than the transport gives. Wording ruling owed before T-041.

---

## Outstanding — reconciliation debt (opened 2026-08-05, updated 2026-08-10)

The 2026-08-05 sync-verify run resolved 13 drift findings across the planning
artifacts. These consequences are **not** yet discharged:

1. **The `v-model/` chain still owes regeneration, and it now carries a hand extension.**
   Its original 31 `REQ-NNN` rows mapped 1:1 to `spec.md`'s 23 FR + 8 NFR as they stood on
   2026-05-13. They did not cover the identity group model (Q-002), the ordering/sequence
   authority, or the client bell surface, and they still do not.

    On **2026-08-10 the chain was extended by hand** to REQ-032 – REQ-041 (dual ingress,
    `spec.md` FR-024 – FR-033), with SYS-032 – SYS-041, ARCH-063 – ARCH-082,
    MOD-063 – MOD-082 and HAZ-032 – HAZ-041. That was the lesser of two evils: leaving the
    amendment invisible would have meant an implementer reading `v-model/` and building a
    single-door service with the wrong envelope, and FR-027 — the event path's only trust
    boundary — appearing in no hazard analysis at all. **It is not a substitute for
    regeneration.** The 2026-08-05 gap is untouched, and the extension inherits whatever the
    generator would have done differently.

    Two defects found in the existing chain during that extension are recorded rather than
    silently fixed, because both are renumbering work:
    - Matrix C and Matrix D in `traceability-matrix.md` carry a **one-technique ID stagger**
      against `integration-test.md` and `unit-test.md` (row `ARCH-002` opens with
      `ITP-001-D`). Each id exists in the test document, but under a different module than the
      matrix row claims, so the two disagree about which module a case verifies. New
      rows follow the test documents.
    - Matrix H declared **four column names against twelve-cell rows**, so it was not a
      markdown table and rendered as raw text. The header has been repaired; no row data
      changed.

2. **`verify-report.md` is superseded, not repaired.** It measured a task graph that
   never existed. It is regenerated by Phase 7 after implementation.

3. **`sync-report.md` and `sync-report.json` are generated and stale (2026-08-10).** They
   describe the 23-FR / 33-task version and were not regenerated with the amendment, because
   hand-editing generated output is what produced the 2026-08-07 divergence. Do not read a
   clean 23-requirement sync report as current. `v-model/release-audit-report.md` is in the
   same position and now carries a scope banner saying so.

4. **The V-Model peer reviews are scope-incomplete (2026-08-10).** All nine were performed
   on 2026-05-10 against the 31-requirement chain and reported zero findings. Each now
   carries a dated supplementary section stating what the amendment means for that artifact
   and that the new material was **not** examined by the original review. A re-run of the
   peer-review lint over current scope is owed.

---

## Cross-Artifact Links

- Feature spec: [`spec.md`](./spec.md)
- Product spec: [`product-spec/product-spec.md`](./product-spec/product-spec.md)
- Research: [`research/README.md`](./research/README.md), [`research/codebase-analysis.md`](./research/codebase-analysis.md)
- Plan: [`plan.md`](./plan.md)
- Tasks: [`tasks.md`](./tasks.md)
- Governance authority: [`../governance-rules.md`](../governance-rules.md)
- Milestone authority: [`../v1-launch-plan.md`](../v1-launch-plan.md)
