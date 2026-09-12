# 0038 — An authored food is withdrawn, not deleted, and recipe reads that live

- **Status:** Accepted
- **Date:** 2026-09-08
- **Supersedes:** [ADR-0029](0029-authored-foods-substances-only.md) clause 9 — "Delete is tombstone-first
  (U18)". The reference check, its fail-closed posture and the physical delete are all removed; the rest of
  ADR-0029 stands, including clause 6's delete-or-orphan ERASURE arm, which this leaves untouched.
- **Owner rulings (2026-09-07):** _"the recipe service needs to handle when it detects that a food item has
  been deleted — the food service should not be updating recipes"_; users may delete their own food
  unconditionally; _"the recipe only finds out when the recipe is fetched"_; display a warning in the recipe
  that a food was deleted; _"we should soft delete for now so that we can provide information about what was
  deleted"_, with sweeping the database explicitly out of scope; and withdrawn foods return no macros.
- **Relates to:** [ADR-0037](0037-authored-foods-are-author-only.md) — author-only foods are what make the
  unconditional delete safe; [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md) §3 — absence is not
  dissent, the rule this applies one service over; [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md)
  — expand-first, applied here to a wire vocabulary rather than a column.

## Context

ADR-0029 clause 9 made the voluntary delete tombstone-first: flip the row to the internal `DELETING` status,
ask recipe-service whether any recipe referenced the food, refuse `409 FOOD_REFERENCED` if so, physically
delete if not, and fail CLOSED with a `503` when the check could not run. The reasoning was sound on its own
terms — deleting blind would strand another user's recipe lines.

Three things were wrong with it. It made a food-side write depend on another service being up. It inverted
the documented food↔recipe relationship, which is one-directional in the DATA and was made bidirectional in
the SERVICES. And it had a stuck state: a crash between the `DELETING` flip and the reference check left a
food permanently `DELETING` — un-addable, un-editable, with no repair path short of editing the database.

ADR-0037 then removed the premise the whole apparatus rested on. With authored foods author-only, the
stranger whose recipe the check was protecting does not exist.

## Decision

**The voluntary delete becomes a WITHDRAWAL.** `DELETE /api/v1/foods/{id}` authorizes through the unchanged
`evaluateAuthorship`, flips `RESOLVED → WITHDRAWN` under the existing guarded transition, stamps
`withdrawn_at`, and answers `204`. There is no reference check, no cross-service call, and no physical
delete. `@kitchensink/recipe-service-client` leaves food's dependency list, which is what makes the removed
edge provable rather than asserted.

**`WITHDRAWN` is a new lifecycle value, and deliberately not `DELETING`.** `DELETING` is store-internal —
`publishableStatusOf` throws on it — and a withdrawal must be READABLE, since telling a cook what was
removed is the entire point. `DELETING` is also IN-FLIGHT rather than terminal: it reverts to `RESOLVED`
when an erasure keeps a referenced food as an orphan, so a reader told "removed" during that window would be
asserting a terminal fact about a state about to un-happen. Being a new WIRE member, it also lands the
compile error exactly where it is wanted — recipe's exhaustive switch over food's union.

**The status partition gains a fourth arm.** `pendingFoodStatusSchema` (202), `RESOLVED` (200),
`terminalFoodStatusSchema` (404) and now `withdrawnFoodStatusSchema` — `GET /{id}/status` answers `200` with
`status: 'WITHDRAWN'` and no `food` body. Folding it into the terminal arm to make the partition test pass
would make the row unreadable and defeat the ruling.

**Macros are withheld.** A withdrawn food's nutrition entry is RETURNED, carrying its status, with no macros
and no portions. It is never omitted: omission would put the id in `unknownIds`, which already means both
"no such row" and "not yours", and that field is recipe's only channel for learning a food was withdrawn.
Portions go with the macros because a portion is a nutritional statement about the substance.

**Recipe derives the line's treatment at READ, and writes nothing.** `FoodNutritionEntry` carries food's
live status; `foodPresenceStatus` maps a live `WITHDRAWN` to the line-only `FOOD_REMOVED`; the recipe detail
shows a tile at the head of the Ingredients section naming the affected LINE. `toResolutionStatus` is
narrowed so recipe cannot record `WITHDRAWN` at all — its sibling `licensesStatusWrite` answers the prior
question of whether a status licenses a catalog write.

**The overlay order is part of the decision:** `resolveLineStatus → foodPresenceStatus → viewerLineStatus`.
Presence runs after resolution so it overrides the persisted mirror, and BEFORE the viewer overlay because
`RESOLVED_UNAVAILABLE` is a PRIVACY answer and must never be rewritten into a FACTUAL claim about a catalog
row the viewer is not entitled to.

## Consequences

**A recipe's nutrition total changes on the day a food is withdrawn** — the line stops counting and the
figure reports incomplete. Accepted, and it is exactly what the tile explains. The retained row buys the
FACT and the DATE, not the numbers.

**Storage grows without bound.** Nothing sweeps withdrawn rows, their macros, their portions or their
`food_versions` history. `withdrawn_at` exists so that sweep is implementable without guessing, but writing
it is explicitly out of scope.

**A PostgreSQL enum value that can never be removed.** The cost of the vocabulary, paid once.

**The dedup index becomes status-aware, closing a regression the soft delete creates.**
`food_normalized_name_per_author_unique` was status-blind, so a retained tombstone would make "delete it and
add it again" answer `409 DUPLICATE_AUTHORED_NAME` forever. Its predicate gains `AND status <> 'WITHDRAWN'`,
and the two duplicate-recovery reads and the edit UPDATE in `AuthoredFoodsDao` carry the same clause so they
cannot drift from it.

**The deploy hazard moved rather than disappearing.** The implementing plan expected a cross-database
ordering problem — widening recipe's `ingredients_food_resolution_status_check` ahead of food. That premise
is false: `FOOD_REMOVED` is a LINE value, derived at read, and never reaches that column, so recipe needs no
migration. The real hazard is one layer up: `FoodServiceClient.expect` is a hard `schema.parse`, and prod
deploys food before recipe, so a recipe build compiled against the old schema package throws on a
`200 { status: 'WITHDRAWN' }`. The work therefore ships in two releases — vocabulary with no emitter, then
behaviour — which is ADR-0035's expand-first rule applied to the artifact that actually carries the risk.

**Two live defects closed on the way.** `getAuthoredNutritionBatch` reached `publishableStatusOf`, which
throws on `DELETING`, and that path reads exactly the rows that get tombstoned — so an author holding a food
mid-erasure took down the whole batch for every other food in the request. And `refetch` enqueued BEFORE
validating, so an operator refetching a tombstoned food got a `500` plus a queued fetch for a food being
deleted.

**A stuck state removed.** One guarded transition has no window in which a crash can strand a food.

## Alternatives considered

**Hard delete, with recipe inferring absence from `unknownIds`.** Fully designed, and the shape someone will
re-propose because it needs no new status and no retained row. It fails twice. Absence conflates
_asked-and-disowned_ with _could-not-ask_: `unknownIds` already carries "no such row" and "not yours", and
an unreachable food service produces the same silence, so a transient outage would render as a permanent
claim that a cook's ingredient was deleted. A hard delete also destroys the food's row while the cook needs to
be told which line lost it — the ruling's stated purpose.

**Persist `WITHDRAWN` into recipe's `ingredients.food_resolution_status` and widen its CHECK.** The plan's
own proposal. Rejected because a withdrawal is presumptively restorable, so a persisted mirror goes stale in
the WORSE direction — showing "removed" on a food that came back, on a row shared by every recipe that binds
it — and because it would have introduced the cross-database deploy ordering the design otherwise avoids
entirely.

**Return `toResolutionStatus` as `… | undefined` to express "record nothing".** Rejected on a measured
property of this repo's `tsc`: it moves the missing-case error from TS2366, which is a property of the TYPE,
to TS7030, which is a property of the `noImplicitReturns` flag that no guard pins. That error is the
tripwire the `AWAITING_RETRY` production 500 exists to have caught, and it must not become a config setting.
The refusal lives in a narrowed PARAMETER instead.

**Keep the reference check but stop failing closed.** Rejected: it keeps the cross-service dependency, the
inverted relationship and the stuck state, while giving up the only property that made the check worth
having.

## Open items

**Edge-cache lag, unresolved.** Food's `/api/v1/foods/nutrition` is CloudFront-cached on URL alone
(ADR-0020), so a withdrawal would be invisible to cached responses until TTL. The path that carries a
withdrawn food is `/authored-nutrition`, which is per-caller and NOT edge-cached, so the lag may not apply at
all — but that has not been confirmed against the deployed distribution, and a stale `RESOLVED` served from
an edge is the lazy detection failing silently.

**`addByFoodId` short-circuits on a stale `RESOLVED` mirror** without asking food, so a withdrawn food can
still be bound to a new line until the mirror refreshes. Author-scoped under ADR-0037 and self-correcting on
the next refresh, so the reconciler this would need is deferred, not cancelled.

**The deleting author's confirm dialog** is where honest disclosure now belongs — the author is about to
change their own recipes' figures and nothing warns them. A separate spec, and arguably worth more than the
tile, because it lets the person causing the loss decide not to.

## Guards

`nutritionEntry.test.ts` pins the withholding rule and that `DELETING` is refused rather than mapped.
`authoredFoods.service.test.ts` proves the withdrawal, mutation-checked, and its fixture supplies NO
reference-check collaborator — the port no longer exists, so a reintroduced cross-service call cannot be
satisfied by a stub. `authoredFoodsApi.integration.test.ts` asserts `204` with `fetch` wrapped so any
outbound call to another origin fails the test, that the row and its versions survive, and that the author
can re-add the same name — the last of which only a real database can answer, since the uniqueness lives in
a partial index. `lineVerification.test.ts` pins the overlay order by composing the chain, and that an
absent live status changes nothing.
