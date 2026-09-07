# Phase 0 Research: ReciMe Parity (017)

**Date**: 2026-08-22 · **Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)

Every claim here was checked against the code at `chore/code-quality-enforcement-phase-1-2`, not inherited
from the gap analysis. **Three of the gap analysis's claims did not survive that check**, and two of them
materially shrink this feature.

---

## R-01 — D20 "salt to taste is unrepresentable" is FALSE. It shipped.

**Finding**: `packages/shared/recipe-core/src/ingredientQuantity.ts` defines a discriminated union with an
explicit third member and a frozen singleton:

```ts
export type IngredientQuantity =
    | { readonly kind: 'exact'; readonly value: number }
    | { readonly kind: 'range'; readonly low: number; readonly high: number }
    | { readonly kind: 'absent' };

/** The one representation of "the source stated no amount" (R40, R41). */
export const ABSENT_QUANTITY: IngredientQuantity = Object.freeze({ kind: 'absent' });
```

It reaches every layer that exists today:

| Layer       | Evidence                                                                                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse       | `recipe-import-core/src/normalizeQuantity.ts` — "Pure and TOTAL: a line that opens with no quantity phrase comes back unchanged with a `null`"                                                                                                                              |
| Parse       | `recipe-import-core/src/ingredientLine.ts:233` — "a bound outside the column's window makes the WHOLE line unquantified rather than silently narrow[ing]"                                                                                                                   |
| Persistence | `recipe-service/src/recipes/dal/quantityColumns.ts`                                                                                                                                                                                                                         |
| Scaling     | `recipe-core/src/scaling.ts:242` — `if (quantity.kind === 'absent') return ABSENT_QUANTITY;`, with the reasoning written out: every alternative "fabricates one — `0`, `1`, or the ratio itself — turning 'the source stated no amount' into a claim the source never made" |
| UI form     | `features/recipes/src/form/model.ts`                                                                                                                                                                                                                                        |

**Decision**: **FR-010 is rewritten from "make it representable" to "do not break it."** The representation is
authoritative and already reasoned; the obligation on this feature is that the **new** surfaces — the video
waterfall (FR-002), unit conversion (FR-026), and export round-trip (FR-020) — preserve `absent` rather than
coercing it.

**Rationale**: D20 was written from `004-FR-020`'s spec text, which describes a parse contract, not from the
shipped domain model. Treating a solved problem as a blocker would have bought a redesign of the one thing in
this area that is already correct — and `scaling.ts`'s comment shows the failure mode was deliberately
considered and closed.

**Alternatives rejected**: Re-specifying a nullable quantity — would have collided with `ABSENT_QUANTITY` and
produced a second representation of one fact, violating DRY-on-knowledge.

---

## R-02 — D14 "export unspecified" is mostly FALSE. A contracted export ships.

**Finding**: `GET /api/v1/account/export` exists — `recipe-service/src/account/` with `account.schema.ts`
(authored zod), `export.service.ts`, `export.dal.ts`, `export.mappers.ts`, a dedicated `ExportRateLimit`, and
`__fixtures__`. It is documented as the GDPR Art. 15 / Art. 20 export of the caller's own recipe-domain data
and covers `RecipeExport`, `CollectionExport`, `CollectionMembershipExport`, `PhotoExport`, `RatingExport`,
`VersionExport`, `AuthorHandleExport`.

**Decision**: **FR-018 becomes "surface and reuse", not "build."** The remaining work is genuinely new and
much smaller:

1. **FR-019** — the human-readable document. Nothing exists.
2. **FR-020** — the round-trip. An exporter exists; **no importer of our own format does**, so nothing today
   proves the export is lossless.
3. **Product surfacing** — it is an account/GDPR endpoint, not a "take my library" affordance, and it is
   rate-limited as the tightest cap in the service.

**Rationale**: The strongest portability claim we can make is _round-trip proven_, not _export exists_. R-02
moves the cost from writing a serializer to writing the importer and the fidelity assertion — which is where
the actual user value and the actual risk are.

**Alternatives rejected**: A second, separate "library export" — would fork the export contract in two.

---

## R-03 — D7 "invert BYOK" has an existing client. The inversion is policy, not plumbing.

**Finding**: `packages/clients/bedrock` ships `BedrockConverseClient.ts`, `schemas.ts`, `errors.ts` and
response fixtures. `packages/services/recipe-workers/src/handlers/verifyLine.ts` is U11's LLM verification
gate, and ADR-0024's reserve-then-settle spend counter is already implemented against the recipe Postgres.

**Decision**: FR-037's inversion is a **specification and entitlement** change plus reuse of an existing
client and an existing spend ceiling — not a new integration. The genuinely new work is extending ADR-0024's
counter to a **second, much larger consumer** whose per-call cost is variable (frames, duration) rather than
the ~660-token line the ceiling was sized against.

**Rationale**: ADR-0024's own text sizes the ceiling around line verification. A vision waterfall is a
different cost shape, and §8 open decision 4 requires a cost model before tiers 3–4 commit. This is the single
largest unknown left in the feature and it is a _number_, not a design.

**Alternatives rejected**: A separate spend ceiling for import — reintroduces the multi-ceiling shape ADR-0024
explicitly closed ("There is ONE ceiling").

---

## R-04 — The five-tier waterfall is the only genuinely green-field subsystem

**Finding**: `packages/shared/recipe-import-core` contains ingredient-line parsing only — `ingredientLine`,
`normalizeQuantity`, `quantityWords`, `quantityPhrases`, `valueNormalizers`, `contentSanitizer`. There is **no
fetcher, no channel abstraction, no waterfall, no media handling** anywhere, and `recipe-service` has no
import module at all.

**Decision**: The waterfall is built as a new **Chain of Responsibility** over a shared `Capture` record, with
each tier a pure-boundary adapter, terminating in the existing `recipe-import-core` parse. Tier order,
short-circuit, per-field provenance and per-tier cost accounting live in one place so FR-002, FR-009 and
FR-039 are satisfied by construction rather than by convention.

**Rationale**: The tiers differ only in how they _obtain candidate text_; they agree on everything after. A
chain with a uniform result type makes adding tier 3/4 later (or disabling them on cost) a registration
change, which is what FR-039's failure-rate-proportional cost argument depends on.

**Alternatives rejected**: A switch over channel type in the service — puts five failure modes and five cost
profiles in one function and makes FR-002's ordering unauditable.

---

## R-05 — Reconciliation with 016's reproduction controls

**Finding**: `016-FR-027` prohibits **persisting** a third-party photograph to operator storage;
`016-FR-027c` prohibits **derived renditions of a referenced photograph** for display; `016-FR-027e` makes
referenced photographs unavailable offline and forbids caching them; `016-FR-028`/`029` classify channels and
require preferring user-supplied bytes.

**Decision**: Recorded in the spec — FR-011 (nothing persisted), FR-025 (placeholder offline), FR-015
(channel classification). Video import is accepted as permanently `operator-performed retrieval`.

**Open, non-blocking**: whether transient decode-for-extraction is a reproduction at all. Closer to
text-and-data-mining than to serving a thumbnail; the same DSM Art. 4 / machine-readable-reservation question
session `911043cd` raised against `004-FR-023`. **Must be answered before tiers 3–4 ship, not before build.**

---

## R-06 — GR-005 offline is a hard prerequisite this feature cannot satisfy alone

**Finding**: `docs/offline-strategy.md` does not exist. GR-005 AC-005-d requires it before any feature with
offline requirements enters implementation, and forbids implementers inventing an ad-hoc approach.

**Decision**: FR-025 and FR-033 (shared check-off) are **sequenced after** that document. FR-033 makes it
harder than when GR-005 was written: two members editing one list offline is a genuine convergence problem,
not a last-write-wins one.

**Alternatives rejected**: Writing an 017-local offline design — GR-005 forbids exactly that.

---

## R-07 — D18 household is the one-way door, and `006` actively contradicts it today

**Finding**: `006-FR-029` scopes every read and write to the authenticated owner; `006/spec.md:375` states
"there is no sharing model in this feature"; `006-FR-032`'s `Idempotency-Key` was designed for a single owner.
`010-FR-044` already publishes `subscriptionTier` into the Clerk session token as a signed claim.

**Decision**: Household is modelled **first**, before any other increment, and every account gets one
implicitly at signup so no "user without a household" branch ever exists. Seats read from the existing
`010-FR-044` token claim rather than a new lookup.

**Rationale**: CLAUDE.md's YAGNI carve-out is explicit that a cheap seam belongs where reversal is expensive —
a persisted ownership boundary across three features is the definition of that. Sequencing it first is
independent of US5 being lowest priority: **priority orders delivery, data-model risk orders design.**

**Alternatives rejected**: Nullable `household_id` with a solo fallback — creates two ownership paths and
guarantees the fallback branch rots.

---

## R-08 — `014` does not exist as code. FR-013a's notify has no transport.

**Finding**: there is **no notification service package** — `packages/services/` has no `notification*`, and no
`/api/v1/notifications/publish` handler exists anywhere. `014` is spec-only. Mobile has **no push wiring at
all** (no `expo-notifications`, no token registration). What does exist is `packages/shared/messaging` —
`publish.ts`, `OutboundMessage.ts`, and only `ConsolePublisher` / `InMemoryPublisher` implementations: a
publisher **seam** with no real transport behind it.

**Decision**: **FR-013a is satisfied in-app for Increment 1, and `014` is an enhancement — not a blocker.**
The capture publishes a completion event through `shared/messaging`'s existing publisher port; Increment 1
binds that port to an in-app surface (a recent-captures list with unread state). `014-FR-001` becomes a second
binding of the same port when it exists.

**Rationale**: the spec's own edge case already requires this — _"acceptance must never depend on a channel the
user can switch off."_ A user with notifications denied must still find the draft, so the in-app path is
**mandatory regardless of `014`**. Making push the primary would have built the optional half first and left
the required half undone. This also removes `014` from Increment 1's critical path, which matters because §7
sequences `014` last.

**Alternatives rejected**: blocking Increment 1 on `014` (builds the whole notification service to finish a
capture flow, and inverts the §7 order); building a minimal notifier inside `recipe-service` (a second
notification authority the portfolio would then have to reconcile with `014`).

---

## R-09 — Household role enforcement is a POLICY module, not a Guard. The pattern is established three times.

**Finding**: `recipe-service` already carries three pure policy modules in `*/domain/` — `visibilityPolicy.ts`,
`provenancePolicy.ts`, `mappingScopePolicy.ts` — each shaped `Input` interface → `Decision` interface → pure
`evaluate*(input): Decision`, each with its own unit suite. The Guards that exist (`serviceErasure.guard.ts`,
`erasureLock.guard.ts`, `userThrottler.guard.ts`) are genuinely **route-level** concerns.

**Decision**: Q2's owner-reserved actions (FR-030b) are enforced by a pure `householdPolicy.ts` in
`recipe-service/src/household/domain/`, following that shape exactly. ⛔ **Not** a `RolesGuard` +
`@RequireRole` decorator.

**Rationale**: this is precisely the distinction **ADR-0023** already ruled on. What is authorized here is not
_reaching an endpoint_ — every household member may call the plans and lists endpoints — but _performing a
specific action on a specific resource given the caller's role_. A route-level guard cannot express "member may
PATCH this plan but not DELETE it, unless completing it," and pushing it there is the exact mistake ADR-0023
records for the provenance grant. Three prior instances also clears CLAUDE.md's rule-of-three for extraction,
so this is following an established abstraction rather than inventing one.

**Alternatives rejected**: NestJS Guard + role decorator (wrong layer, per ADR-0023); inline role checks in
each service method (the rule then has four homes and drifts — the failure ADR-0023 and the ALB priority
allocator both document).

---

## R-10 — FR-030c is the seam that keeps FR-030b out of the shop

**Finding**: Q2 reserves _deleting shared content_ to owners. The end-of-shop action on a finished grocery
list is routine and belongs to whoever did the shopping — often the member, not the owner.

**Decision**: `householdPolicy` distinguishes three verbs on shared content — `mutate` (any active member),
`complete` (any active member), `delete` (owner only). "Complete/archive" is modelled as a **state transition**
on the list, not a deletion, so FR-030b's restriction never lands in the shopping path.

✅ **Confirmed by the owner 2026-08-22**, and broadened: the same three verbs apply to **meal plans and the
aisle taxonomy** as well as grocery lists, so `householdPolicy` stays one truth table with no per-resource
switch.

---

## R-12 — "The sole owner cannot leave" is unenforceable against erasure

**Finding**: `recipe-workers/src/handlers/accountErasureWorker.ts` implements GDPR right-to-erasure and states
its own design failure explicitly: _"the failure this worker is designed against is not a crash — it is a false
success,"_ with every ordering choice made so an interrupted attempt "leaves work still owed rather than work
falsely reported." Erasure is **scoped**, not a whole-owner wipe: truly-public recipes survive, pseudonymized.
It is also the only path permitted a hard `DELETE FROM recipes`; every other delete sets `deleted_at`.

**The hole**: the invariant "a household always has ≥1 active owner" can be enforced against a _voluntary_
leave with a `409`. It **cannot** be enforced against erasure — refusing would make a legal right conditional
on household state. Left unaddressed, erasing a sole owner leaves a household whose reserved actions nobody can
perform.

**Decision** (owner ruling 2026-08-22): ownership **auto-transfers to the longest-tenured active member**
(FR-032a), deterministic with ties broken by a stable secondary key, written **before** the departing
membership row is removed, and idempotent under redelivery (FR-032b) — the same ordering discipline the erasure
worker already applies. If the owner was the only member, the household goes with them.

**Also caught here**: `households.display_name` defaults to the creating user's handle (§1). Erasing that owner
would pseudonymize their recipes and then **leak the handle through the household name**. FR-032c requires it
be re-derived in the same erasure.

**Alternatives rejected**: dissolving the household (destroys content belonging to members who did nothing, and
contradicts FR-032); nomination-before-erasure (blocks a legal right on a user action that may never come).

---

## R-11 — Resume-from-tier fits the existing worker shape

**Finding**: `recipe-workers` already runs SQS-triggered handlers with DLQ semantics (`verifyLine.ts`,
`erasureSweeper.ts`, `accountErasureWorker.ts`), and ADR-0024's counter is already implemented against the
recipe Postgres with a deliberately **non-retried settle**.

**Decision**: `capture_tier_results` rows **are** the resume log (FR-011a) — the worker commits each tier
before starting the next and, on redelivery, resumes at the first tier with no row. Quota (`004-FR-022`) is
charged once per user intent at accept time, never per attempt (FR-011b).

**Rationale**: this makes SQS redelivery safe without making the waterfall idempotent-by-replay, which it
cannot be — replay would re-pay for billed tiers, and ADR-0024's own reasoning is that crashes correlate with
the runaway the ceiling exists to stop.

**Alternatives rejected**: a distributed lock (adds a failure domain to avoid a write); making settle
idempotent (ADR-0024 forbids it — a retried settle double-refunds and reintroduces the under-count).

---

## Unknowns remaining

| #   | Unknown                                                            | Blocks          | Resolution path                               |
| --- | ------------------------------------------------------------------ | --------------- | --------------------------------------------- |
| U-1 | Per-import inference cost for tiers 3–4 against ADR-0024's ceiling | Tiers 3–4 build | Cost model on a sampled corpus; §8 decision 4 |
| U-2 | Is transient frame decode a reproduction?                          | Tiers 3–4 ship  | Legal ruling in `016`                         |
| U-3 | Offline convergence rule for a shared list                         | FR-025, FR-033  | `docs/offline-strategy.md` (GR-005 AC-005-d)  |
| U-4 | Concurrent household edits vs `006-FR-032` idempotency             | FR-031          | `006` owns; surfaced by this feature          |

**None of U-1…U-4 blocks Increment 0 (household model) or Increment 1 (capture tiers 1–2 + 5).** U-5 was
resolved 2026-08-22 (R-10 confirmed, R-12 added), and R-08 removed the only new blocker the clarifications
introduced.

**Increment 0 now carries a hard integration point**: FR-032a…FR-032c land _inside_ the account-erasure path,
not beside it. That worker is the most correctness-sensitive code in the service, and its own doc comment is
the specification for how to add to it safely.
