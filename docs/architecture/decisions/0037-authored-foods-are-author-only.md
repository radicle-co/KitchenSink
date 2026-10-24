# 0037 — Authored foods are author-only, and promotion is removed

- **Status:** Accepted
- **Date:** 2026-09-08
- **Supersedes:** [ADR-0029](0029-authored-foods-substances-only.md) clause 5 — "Promotion: corroboration
  TRIGGERS, a human PUBLISHES". That mechanism is removed rather than suspended; the rest of ADR-0029 stands.
- **Owner rulings:** _"for now only users who create the food item can use it and find it; we will provide
  them a way to request that their food gets published globally later, or lift the restriction wholesale
  later when we can sort other concerns about custom foods out"_, and on the promotion machinery, _"remove
  it"_ (both 2026-09-07).
- **Relates to:** [ADR-0020](0020-cloudfront-edge-and-internal-alb-hostnames.md) — the edge-cached batch's population
  narrows to catalog rows alone; [ADR-0038](0038-authored-food-withdrawal.md) — the unconditional voluntary
  delete this makes safe.

## Context

ADR-0029 clause 4 made an authored food private BY DEFAULT and clause 5 gave it a way out: cross-author
corroboration minted a moderation-queue row, an operator holding `food:admin` published it, and the food
became world-readable. The design was careful — corroboration was the trigger and a human was the publisher,
so two throwaway accounts could mint a queue entry and nothing more.

What it did not have was a settled answer to the questions promotion raises once a food really is public:
whose macros a stranger's recipe now depends on, what an author's later edit does to every recipe that
adopted their food (ADR-0029 clause 7 names this residual and defers it), and what recourse a cook has when
the answer changes underneath them. The owner's ruling names that gap directly — the restriction lifts
"when we can sort other concerns about custom foods out".

Meanwhile promotion was the ONLY way a food could be referenced by someone other than its author, and that
single fact was load-bearing for every hard question in the neighbouring work: whether a delete may be
refused, whether one user's action can degrade a stranger's recipe, and whether a global ingredient mapping
can point at a row most readers cannot see.

## Decision

**An authored food is visible to, and usable by, its author alone.** The promotion machinery is deleted:
the candidacy policy, its repository, the moderation service, the operator CLI, the three admin routes and
their id guard, the published `promotions.schema` wire contract, and the two promotion error codes. The
`'promotion'` correction surfacing goes with the CLI that was its only producer.

Both privacy predicates narrow to the same shape — catalog rows plus the caller's own authored rows, and
nothing else. Search (`foodSearch.dao.ts`) and the edge-cached nutrition batch (`food.dao.ts`) both drop
their `OR visibility = 'promoted'` arm, which also returns ADR-0020's shared cache to a population that is
caller-invariant by construction rather than by argument. On the wire, `visibility` narrows from a two-value
enum to `z.literal('private')`: an authored food has no second value a client could branch on.

**Two things are deliberately left standing so lifting the restriction needs no migration.** The `promoted`
VALUE remains admissible on the `visibility` column and its CHECK — PostgreSQL cannot remove an enum value,
and an unreachable-but-valid one costs nothing. The `food_promotions` table (migration 0015) survives with
no reader; dropping it is a contracting migration, and ADR-0035's expand-first rule ships those a release
after the code stops reading them.

**`mappingPromotionAudit.ts` is NOT part of this.** It audits CORROBORATION promotion of a phrase→food
MAPPING — two authors independently agreeing that a phrase means a food (ADR-0027) — which is a different
mechanism that these rulings do not touch. It was listed for deletion in the implementing plan and that was
wrong: removing it would have taken away a Sybil-detection alarm for a live feature.

## Consequences

**A food can only ever be referenced by its own author's recipes.** That collapses a class of problems
rather than solving them: one author's action cannot degrade a stranger's recipe, so a voluntary delete has
nobody to protect and need not be refused (ADR-0038). It also removes the writer that could bind a GLOBAL
ingredient mapping to an author-private food — promotion phase 2 — which is why that defect does not survive
into the withdrawal work.

**A wire narrowing, and therefore one-way.** Two error codes and a schema module leave the published
contract. A client built against the old contract still parses everything this service now emits; the
reverse is not true, which is the direction that matters and the direction that is safe.

**The operator surface is gone, and it was the only one.** ADR-0029 clause 5 shipped a CLI and explicitly
deferred a web admin page. Nothing is left unowned by this removal because nothing is left.

**A residual the removal narrows but does not close.** Corroboration promotion of a MAPPING can still bind a
phrase globally to a food most readers cannot see. It is pre-existing, and it is now much harder to reach —
a second author cannot discover another's food id through search — but it is not impossible, and it is not
addressed here.

**What is owed.** A feature spec for what replaces promotion, recorded in
`docs/plans/2026-09-08-001-feat-author-private-foods-and-withdrawal-plan.md`. The deleted design answered a
question the ruling does not ask: it was SYSTEM-DETECTED promotion, where the author was never consulted,
and the ruling describes an author REQUESTING publication. Those are different features with different
consent stories. Git history is the record of a shape that was set aside, not a head start.

## Alternatives considered

**Suspend rather than remove — leave the code behind a flag.** Rejected on the owner's explicit "remove it",
and on merit: a moderation queue nothing feeds and routes nobody may call is a surface that still has to be
read, tested, deployed and reasoned about at every future change, in exchange for a head start on a design
that has not been agreed. The two artifacts actually needed to lift the restriction cheaply — the enum value
and the table — are kept, and they are the two that cost nothing to keep.

**Drop the `promoted` value and the `food_promotions` table now.** Rejected in two different ways. The enum
value cannot be removed by PostgreSQL at all, so the choice is between valid-and-unreachable and rewriting
the column; unreachable is strictly cheaper. The table can be dropped, but that is a contracting migration
and ADR-0035 ships those a release later, so it is owed rather than refused.

## Guards

`packages/services/food-service/src/foods/__tests__/foods.service.test.ts` asserts that an authored row
belonging to somebody else publishes no visibility flag — verified red against the previous projection.
`tests/foodSearch.dao.integration.test.ts` and `tests/foodNutritionBatch.integration.test.ts` each seed a row
still carrying the `promoted` VALUE and assert it is invisible to a stranger and absent from the shared
batch: the value remaining admissible must not be enough to re-admit a row, which is what catches a partial
revert. `contractDriftGate` and `errorEnvelopeParity` hold the wire narrowing in lockstep with the client.
