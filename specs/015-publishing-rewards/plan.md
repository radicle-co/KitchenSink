# Technical Plan: 015 Publishing Rewards

**Created**: 2026-08-22
**Spec**: [`spec.md`](./spec.md) (47 FRs, 15 SCs, 6 user stories — authoritative, NOT regenerated)
**Evidence**: [`research/reward-psychology.md`](./research/reward-psychology.md)
**Status**: Plan only. ⛔ **Implementation is BLOCKED** — see §9.

---

## 1. The one-sentence architecture

Publishing rewards is a **pure-policy + append-only-ledger** feature bolted onto the existing
`recipe-service`: four new pure evaluators join `evaluateVisibility`/`evaluateProvenance` in
`recipes/domain/`, a new `rewards/` module owns a monotonic grant ledger, and **exactly one existing line of
business logic changes** — the C-004 rule that today makes free-tier privacy impossible.

## 2. The change that matters most

`packages/services/recipe-service/src/recipes/domain/visibilityPolicy.ts` currently encodes:

```
requested `private` + `user_created` → ALLOW iff isPremium
```

That single branch **is** `001-FR-003`, the free-tier privacy prohibition. 015 replaces it:

```
requested `private` + `user_created` → ALLOW iff (isPremium OR the account holds an unconsumed earned slot)
```

Three consequences that shape the whole plan:

1. **`evaluateVisibility` must stay pure.** It takes `isPremium: boolean` today and does no I/O. Slots are
   DB state that changes on every publication, so the balance MUST be resolved by the **caller** and passed
   in — never fetched inside the policy. The input type gains a field; the function stays a pure fold over
   its arguments.
2. **`isPremium` comes from the Clerk token** (`principal.permissions.includes(PREMIUM_PERMISSION)`,
   `recipes.service.ts:687,1032`) — it is _not_ DB-derived. Slot balance is the opposite: DB-derived and
   read-at-decision-time. The two entitlement sources must not be conflated behind one boolean.
3. **This is D4a.** If the un-gating does not land, 015 inverts from a fix to an aggravation (spec
   Assumptions). The plan therefore sequences the policy amendment **first**, behind a flag, so it is
   independently shippable and independently revertible.

## 3. Pattern register

| Pattern                                  | Where                                                                                                    | Why                                                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Policy / Specification module** (pure) | `recipes/domain/publicationEligibility.ts`, `rewardSchedule.ts`, `earnRateLimit.ts`, `standingLadder.ts` | Siblings of the shipped `evaluateVisibility`/`evaluateProvenance`. Pure `input → decision`, no I/O, exhaustively testable. Matches the codebase's existing and correct shape. |
| **Append-only ledger**                   | `reward_grants` table                                                                                    | `FR-009` requires an inspectable append-only record; `FR-007i`'s ratchet requires no destructive update. Reversal (`FR-016`) is a **new row**, never a delete.                |
| **Table-driven strategy**                | `rewardSchedule.ts` bands                                                                                | `FR-007a`'s schedule is _data_ (3 bands), not branching logic. Changing the schedule must never mean editing control flow.                                                    |
| **Read-model projection**                | `recipe_impact_signals`                                                                                  | Aggregate-only by `012-FR-024`. Cook/save counts are projected, never joined to viewer identity.                                                                              |
| **Adapter (outbound)**                   | `rewards/standing.port.ts`                                                                               | `FR-032`: 015 emits standing facts; `012` renders them. One-way, so 012 can ship later without changing 015.                                                                  |
| **Guard clause / invariant test**        | `__tests__/ratchet.test.ts`                                                                              | `FR-007i` is a cross-cutting invariant. Asserted once, over every reward surface, like `natEgressConsumers.test.ts` does for NAT.                                             |

## 4. Data model

Four new tables. Migration **`0026_publishing_rewards.sql`**.

> ⚠️ **Corrected 2026-08-22.** An earlier draft of this plan said `0024`, and said the latest shipped was
> `0023`. Both were wrong: **`0024` is already taken twice** — `0024_ingredient_rank_terms.sql` (`9545447c`)
> and `0024_ingredient_source_line.sql` (`6a3bf118`), both committed. That duplication is _tolerated by
> design_ and is not a live bug: `src/lambdas/migrate/handler.ts` discovers `*.sql`, sorts by **filename**,
> and journals applied migrations into `schema_migrations` keyed on the **full filename**
> (`name TEXT PRIMARY KEY`) — so the numeric prefix is a sort key, not an identity, and both files apply in a
> stable lexicographic order. 015 takes `0025` for legibility, not correctness.

| Table                    | Purpose                                       | Key columns                                                                                                                  | Notes                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recipe_public_listings` | `FR-002`, Key Entity _Publication_            | `id`, `recipe_id`, `owner_id`, `listed_at`, `attestation_accepted_at`, `eligibility_decision`, `eligibility_reason`, `state` | **Renamed** from `recipe_publications`: `recipes.status='published'` already means "not a draft" and is a security boundary. See [`migrations/migration-plan.md`](./migrations/migration-plan.md) §2.3. |
| `reward_grants`          | `FR-007a`/`FR-009`, Key Entity _Reward Grant_ | `id`, `publication_id`, `user_id`, `kind` (`slot`\|`milestone`), `amount`, `granted_at`, `reversed_at`, `reversal_reason`    | **Append-only.** Reversal sets `reversed_at` on the original row — the only permitted mutation, and the only one `FR-007i` allows.                                                                      |
| `recipe_impact_signals`  | `FR-007f`/`FR-007g`                           | `recipe_id`, `cook_count`, `save_count`, `updated_at`                                                                        | **No rating columns** — `recipes.average_rating`/`rating_count` already exist and are trigger-maintained (§2.2). Aggregate-only; no viewer column may ever exist (`012-FR-024`).                        |
| `contributor_standing`   | `FR-007h`                                     | `owner_id`, `tier`, `updated_at`                                                                                             | Ratchet enforced by a **BEFORE UPDATE trigger**, not a CHECK — the CHECK was tested against a live DB and defeated (§2.4).                                                                              |

**Slot balance is derived, never stored as a mutable counter**: `SUM(amount) FILTER (kind='slot' AND reversed_at IS NULL)`. A stored counter can drift; a
derived sum cannot, and it makes `FR-007b`'s permanence structural rather than disciplined.

**Migration is EXPAND-ONLY** (ADR-0022 precondition) — four `CREATE TABLE`s, one nullable column on
`recipes`. No contraction ships in this release.

## 5. Pure domain modules

All in `packages/services/recipe-service/src/recipes/domain/`, all `input → decision`, no I/O:

| Module                      | Signature                                                                                                             | Implements                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `publicationEligibility.ts` | `evaluateEligibility({sourceType, completeness, isNearDuplicate, hasPriorGrant, openTakedown}) → EligibilityDecision` | `FR-001`, `FR-003`–`FR-006`, `FR-011`, `FR-017` — the **single authoritative rule** `FR-003` demands                             |
| `rewardSchedule.ts`         | `slotsForPublication(ordinal: number) → number` + `cumulativeSlots(ordinal)`                                          | `FR-007a` banded table; terminates at 50                                                                                         |
| `earnRateLimit.ts`          | `evaluateEarnRate({grantsLast24h, grantsLast7d}) → RateDecision`                                                      | `FR-010` (3/day, 10/week)                                                                                                        |
| `nearDuplicate.ts`          | `isNearDuplicate({titleA,titleB,ingredientsA,ingredientsB}) → boolean`                                                | `FR-006` — normalized-title equality OR identical resolved-ingredient set. **Deterministic only**; fuzzy similarity is forbidden |
| `standingLadder.ts`         | `deriveStanding({cookCount, ratingCount, ratingAvg}) → Tier`                                                          | `FR-007g`, `FR-007h` — impact-keyed, coarse, monotonic                                                                           |

> **`FR-007c` gates the TRANSITION, not the holding** (`C-015-022`). A lapsed premium account may
> legitimately hold more than 50 private recipes; it keeps every one and simply cannot make new ones private.
> The ceiling is therefore an input to the _transition_ decision and MUST NOT drive any sweep, migration or
> backfill over existing rows.

`visibilityPolicy.ts` is **amended, not replaced**: `VisibilityPolicyInput` gains
`hasAvailablePrivateSlot: boolean`, and the `user_created` + `private` branch becomes
`isPremium || hasAvailablePrivateSlot`. Every existing test in
`recipes/domain/__tests__/` must be re-run; the C-004 matrix docstring must be updated in the same commit or
it becomes a lie.

## 6. Service, API, and frontend

**Backend** (`recipe-service`):

- New `rewards/` module (controller, service, dal, schema) mirroring the existing `ratings/` module layout.
- `POST /api/v1/recipes/:id/publish` — attestation + eligibility re-evaluation at confirm (`FR-004`) + grant.
- `DELETE /api/v1/recipes/:id/publish` — unpublish, **no grant reversal** (`FR-012`).
- `GET /api/v1/rewards/me` — balance, schedule position, grant ledger (`FR-009`, `FR-007a-i`).
- Wire contract authored in-service as zod, copied to `packages/schemas/recipe` per ADR-0014.

**Frontend** (web + mobile, same release per `FR-023`):

- Publish sheet: states what will be earned, what publishing means, attestation checkbox (`FR-008`, `FR-028`).
- Unpublish: **step-count parity with publish** (`FR-029`) — asserted by test, not by review.
- Slot meter showing position + next grant (`FR-007a-i`, `SC-009`).
- Cook signal on the author's own recipe, **hidden at zero** (`FR-007f`, `C-015-019`).
- All strings localized (`FR-024`).

## 6a. Grant issuance: atomicity and durability _(added 2026-08-22 from clarify)_

Two requirements added after this plan was first written change the service boundary materially.

**`FR-010a` — the decision and the record are one act.** The rate-limit and ceiling checks MUST be evaluated
atomically with recording the grant; the bound must hold under arbitrary concurrency, independent of worker
count. Read-then-write is forbidden: two simultaneous publications observe the same pre-write count, both
pass, both grant — and `FR-007b` makes the over-grant permanent and uncorrectable. The shape that satisfies
this is the ADR-0024 reserve pattern: one conditional write whose **zero-rows result IS the denial**.

**`FR-010b` — the obligation is durable, the act is not.** Publication MUST commit regardless of whether the
grant write succeeds, and the obligation — carrying the eligibility decision **frozen at confirmation** — is
recorded durably and retried idempotently until it lands.

⚠️ **These two pull in opposite directions, and the resolution is not obvious.** `FR-010a` wants the grant
decided in one atomic write; `FR-010b` wants publication to commit even when that write cannot happen. They
reconcile by separating the **obligation** from the **grant**: publication and obligation commit together, and
the grant is the later conditional write where `FR-010a`'s condition is evaluated. So the retry is not "retry
the decision" — it is "retry the conditional write" — and a denial (rate limit reached, ceiling reached) is a
**terminal** outcome that resolves the obligation _without_ granting, not a failure to be retried forever.
Getting this wrong in either direction produces a lost grant or a permanent over-grant.

**`FR-010c`** — a failed _read_ of reward state renders _unavailable_, never `0`. A zero is a false denial of
an already-earned benefit.

**Erasure interaction**: erasure MUST cancel any outstanding obligation, or a retry landing afterwards
recreates records for an erased user and breaches `FR-021`.

## 7. Test strategy (per CLAUDE.md §7.1 — every tier, written first)

| Tier                                    | Covers                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                    | All four pure policies, exhaustively over the C-004 × slot matrix. Mutation lens: schedule band boundaries (10/11, 30/31, 70) must fail if off-by-one.           |
| Integration (real DB)                   | Migration applied; ratchet CHECK constraint actually rejects a tier decrease; grant reversal leaves unrelated grants untouched; slot sum excludes reversed rows. |
| Component (RTL)                         | Every publish-sheet state: eligible, ineligible-with-reason, at-ceiling, rate-limited, attestation-declined.                                                     |
| E2E Playwright (web) + Maestro (mobile) | US1 publish-and-earn; US2 unpublish-without-loss.                                                                                                                |
| **Invariant guard**                     | `ratchet.test.ts` — asserts no reward surface renders an expiring/at-risk/decaying/ranked state (`SC-008`), by set equality over reward view models.             |
| k6                                      | `GET /rewards/me` under load — it renders on every recipe view.                                                                                                  |

## 8. Constitution check — re-evaluated post-design (2026-08-22)

| #    | Principle                       | Verdict | Evidence / residual                                                                                                                                                               |
| ---- | ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | Correctness & type safety       | ✅      | `NFR-001` strict, zero `any`. The `hasAvailablePrivateSlot` field is **required**, so the compiler audits all four `evaluateVisibility` call sites                                |
| II   | Readability & JSDoc             | ✅      | `NFR-002`. Pure policies carry the pattern name; `visibilityPolicy.ts`'s C-004 docstring MUST be updated in the same commit as the branch change                                  |
| III  | Organization & imports          | ✅      | New `rewards/` module mirrors the shipped `ratings/` layout; no `helpers/`; domain policies sit beside their existing siblings                                                    |
| IV   | Testing discipline (pyramid)    | ✅      | §7 specifies every tier; 23 of 52 tasks are `Test-first: true`. Two cases cannot be met by a sequential test — `TC042a` needs genuine parallelism, `TC042b` needs fault injection |
| V    | Monorepo & workspace governance | ✅      | ADR-0014 honoured: zod authored in-service, copied to `packages/schemas/recipe`; `openapi.yaml` is derived output, never a codegen input                                          |
| VI   | Formatting & tooling            | ✅      | Prettier via lint-staged on every commit                                                                                                                                          |
| VII  | Accessibility & UX consistency  | ✅      | `NFR-003` accessible names; `NFR-004` no colour-only state (milestones carry text labels); `NFR-005` attestation legible to assistive tech and not dismissible unread             |
| VIII | Cross-platform parity           | ✅      | `FR-023`; task groups F (web) and G (mobile) ship in the same release, with Playwright **and** Maestro coverage                                                                   |

**Gate: PASS — no unjustified violations.**

Two residuals, both recorded rather than waived:

- **Erasure must extend the existing recipe-service path**, not add a second one (`E047`). A parallel erasure
  path is how a table gets missed.
- **Cook/save events are deferred to 008.** No EDA surface ships in this release, so Principle IV's integration
  expectations for events do not yet apply — and cannot, since the producer does not exist.

## 9. ⛔ Blocking dependencies — what must be implemented first

Verified against the codebase, not assumed:

| #   | Blocker                                                                                 | Status in code                                                         | Blocks                                                                                                                                       | Severity                               |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| B1  | **016 Legal Compliance Framework** — ToS content licence + portfolio-wide DMCA/takedown | Spec drafted 2026-08-22, **no code**                                   | `FR-015`–`FR-019` (US4) and the _entire_ right to display/clone a user's recipe                                                              | 🔴 **Hard — nothing ships without it** |
| B2  | **001-FR-003 amendment (D4a)** — un-gate free-tier privacy in `visibilityPolicy.ts`     | Code exists, gate is `isPremium`                                       | Everything. The reward is meaningless while privacy is also paywalled                                                                        | 🔴 **Hard**                            |
| B3  | **008 Cooking Mode** — the producer of cook events                                      | **Not implemented** (only a mockup e2e reference)                      | `FR-007f` cook signal, `FR-007g` milestones, `FR-007h` standing → all of **US5**                                                             | 🟠 **Hard for US5, not for US1–3**     |
| B4  | **012 Creator Profiles** — the public surface for standing                              | **Not implemented** (no code)                                          | `FR-007h` public visibility (`C-015-018`), `FR-032`                                                                                          | 🟠 **Hard for public standing**        |
| B5  | **010 Subscriptions (D5)** — re-pricing after the privacy lever is removed              | Entitlement _read_ path exists (`PREMIUM_PERMISSION`); billing partial | Not technically blocking, but removing the free tier's only paywall lever without re-pricing is a business decision that must precede launch | 🟡 **Business gate**                   |

**What this means for sequencing.** US1–US3 (publish, unpublish, ineligible-cannot-earn) are buildable
today against B2 alone. **US5 is not buildable at all** — its data source does not exist. And `FR-007j`'s
handoff makes that structural, not cosmetic: slots are a finite bootstrap that must hand off to recognition
before the ceiling, and recognition cannot exist until B3 and B4 land. **Shipping US1–US3 without a dated
plan for B3/B4 builds the cliff recorded in the spec's overjustification risk.**

## 10. Risks

1. **The cliff (highest severity).** Per §9, slots without recognition is exactly the failure the spec
   records. Mitigation: do not ship the slot economy to a broad cohort until B3/B4 have dates.
2. **`evaluateVisibility` is load-bearing and widely called** — create, update, clone-default, and
   set-visibility all route through it. A wrong amendment silently changes clone and import behaviour.
   Mitigation: amend the input type (compile error at every call site) rather than defaulting the new field.
3. **Slot balance read on a hot path.** `/rewards/me` renders on recipe views; a `SUM` over the ledger per
   request will not hold. Mitigation: materialized balance with the ledger as the source of truth, refreshed
   on grant — and reconciliation asserted in the integration tier.
4. **Two concurrent sessions are editing this repo** (016 specs, PG18 upgrade). Any implementation must
5. **The `FR-010a`/`FR-010b` reconciliation is the subtlest thing in this plan.** An implementer who reads
   only one of them builds either a lost-grant path or an over-grant path. §6a exists to stop that, and
   `TC042a`/`TC042b` assert both directions.
   re-check `visibilityPolicy.ts` against `main` before starting.
