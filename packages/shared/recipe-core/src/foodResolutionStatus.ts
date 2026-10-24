/**
 * The food-resolution status vocabulary: the statuses a catalog ingredient and a recipe line can report, and the
 * ones under which a line carries no name.
 *
 * A leaf module: `recipe.types.ts` builds the wire shapes on it, and `unresolvedFood.ts` states its failure
 * statuses as a subset of it, so neither imports the other.
 */
import { z } from 'zod';

/**
 * Async resolution state of an ingredient's backing food record in the
 * source-agnostic food service (003). Values mirror the shipped food client's
 * `FoodStatus` (`@kitchensink/food-service-client`), including the terminal
 * `NOT_FOUND` / `FAILED` states. A just-added food may report `PENDING` or
 * `UNRESOLVED` (nutrition not ready yet, or awaiting disambiguation) and
 * transition to `RESOLVED` later; consumers must tolerate partial nutrition in
 * the interim (FR-007). `NOT_FOUND` / `FAILED` are terminal — the picker UX
 * surfaces an error, offers a freeform fallback, and allows removal. Whether an
 * ingredient is freeform is a SEPARATE concern tracked by
 * `Ingredient.isUserEntered` (`./recipe.types.ts`), never a resolution-status value.
 *
 * ## ⛔ `NEEDS_REVIEW` IS OURS, AND IT IS PER RECIPE LINE — NEVER PER CATALOG ROW
 *
 * The sixth member is the first value food-service does not emit: it means the U11 verification gate read a
 * recipe line's raw source text against the food we resolved it to and CONTRADICTED the match (plan U14 /
 * R15). It is derived at read time from `recipe_ingredient_verifications` and it is never persisted.
 *
 * `0023_line_verifications.sql` forbids writing a gate verdict into `ingredients.food_resolution_status` for
 * three independent reasons — blast radius on a SHARED, ownerless catalog deduped one row per `food_id`;
 * that column being a MIRROR of a lifecycle food-service owns; and `UNRESOLVED` already meaning "several
 * candidates, ask the user to pick". So the two audiences get two schemas, and the split is STRUCTURAL:
 * {@link foodResolutionStatusSchema} (the catalog `Ingredient`, five values) cannot carry `NEEDS_REVIEW`,
 * and {@link lineResolutionStatusSchema} (one recipe line) can. A picker row therefore has no dead
 * branch, and no code path can widen one recipe's disagreement into every recipe that shares the food.
 */
export const FoodResolutionStatus = {
    PENDING: 'PENDING',
    UNRESOLVED: 'UNRESOLVED',
    RESOLVED: 'RESOLVED',
    NOT_FOUND: 'NOT_FOUND',
    FAILED: 'FAILED',
    /** ⛔ RECIPE-LINE ONLY — see this block's header. Never written to a catalog row. */
    NEEDS_REVIEW: 'NEEDS_REVIEW',
    /**
     * ⛔ RECIPE-LINE ONLY, and DERIVED at read (plan U4c, KTD-A): a zero-authority lexical bind whose
     * verification verdict has not landed yet. The line is bound and visible, its macros are withheld from
     * the recipe figure, and the verdict's arrival flips it with no write anywhere. ⛔ NOT `UNRESOLVED`,
     * which means "several candidates, pick one" and drives the disambiguation picker — a pending line has
     * exactly one proposed food and nothing for a picker to do.
     */
    PENDING_VERIFICATION: 'PENDING_VERIFICATION',
    /**
     * ⛔ RECIPE-LINE ONLY, and DERIVED at read (plan U13, D7/R9): the gate ABSTAINED (`inconclusive`) over
     * a shortlist whose candidates differ MATERIALLY on nutrition — the pick changes the figure, so the
     * AUTHOR is asked. Renders the pick affordance (re-derived shortlist; one pick binds every matching
     * sibling and writes ONE correction). ⛔ NOT `UNRESOLVED`: that drives the CANDIDATE picker over a
     * catalog row's own candidate set; this is the verification gate's abstention over a ranked shortlist.
     * Publish stays allowed with ambiguous lines (R23).
     */
    AMBIGUOUS: 'AMBIGUOUS',
    /**
     * ⛔ RECIPE-LINE ONLY, DERIVED at read, and VIEWER-DEPENDENT (plan U13, R20): the line IS bound, but
     * its food is a PRIVATE authored one whose author is not THIS viewer (a private food on a public
     * recipe — a clone, or a promoted-then-reverted edge). The viewer gets a "details unavailable"
     * treatment: no pick affordance, never an error, and the recipe total reports the line as unaccounted
     * for this viewer (the food service does not serve them the nutrition). ⛔ And NO NAME (plan 002 R9):
     * the recipe database stores no food names, and a food the viewer may not see has no name to show.
     */
    RESOLVED_UNAVAILABLE: 'RESOLVED_UNAVAILABLE',
    /**
     * ⛔ RECIPE-LINE ONLY, and DERIVED at read (owner rulings 3 + 4, 2026-09-07): the line's food was
     * WITHDRAWN by its author. The line keeps its own name, quantity and unit — those are the recipe's,
     * never the food's — and its macros stop counting toward the recipe figure, because a withdrawn food
     * publishes no macros.
     *
     * ⛔ Line-only for the OPPOSITE reason to its four siblings above. They are values recipe DERIVES from
     * its own evidence. This one reports a fact FOOD owns, read LIVE at the moment of the read and never
     * written down: a withdrawal is presumptively restorable, so a persisted mirror goes stale in the worse
     * direction — claiming "removed" about a food that came back.
     *
     * ⛔ NOT `NOT_FOUND`, which means "no wired source has it" — a food we never had. This is a food we DID
     * have and whose author took it away, and the retained row is what lets a cook be told which line it
     * was. Named against two near-misses: `FOOD_MISSING` reads as an inference from absence and understates
     * a retained tombstone; `FOOD_DELETED` overclaims, since the row is kept.
     */
    FOOD_REMOVED: 'FOOD_REMOVED',
    /**
     * ⛔ RECIPE-LINE ONLY, and DERIVED at read (plan 002 U7, R2/R36): the line IS bound, but food-service
     * could not be asked about its food on this read, so the line has no name and no numbers right now.
     *
     * ⛔ NOT `FOOD_REMOVED`. That is a fact food reported; this is the absence of any report. Collapsing the two
     * turns an outage into a permanent-looking fact about a cook's recipe (R2). It is transient: the next read
     * may resolve it.
     */
    FOOD_UNREACHABLE: 'FOOD_UNREACHABLE',
} as const;

/**
 * Resolution lifecycle status for an ingredient's `Ingredient.foodId` (`./recipe.types.ts`), INCLUDING the recipe-line-only
 * `NEEDS_REVIEW`. The two audiences narrow it through {@link foodResolutionStatusSchema} (catalog) and
 * {@link lineResolutionStatusSchema} (recipe line).
 */
export type FoodResolutionStatus = (typeof FoodResolutionStatus)[keyof typeof FoodResolutionStatus];

/**
 * Runtime validator for a CATALOG ingredient's food-resolution status — the five values that mirror
 * food-service's `FoodStatus`, and no more.
 *
 * ⛔ `NEEDS_REVIEW` IS DELIBERATELY ABSENT and adding it here is the change to refuse. This schema validates
 * `Ingredient.foodResolutionStatus`, which is one row of a shared, ownerless catalog; admitting a gate
 * verdict here is how ONE recipe line's disagreement would withdraw nutrition from every recipe referencing
 * that food. Asserted in both directions by `lineResolutionStatus.test.ts`.
 */
export const foodResolutionStatusSchema = z.enum([
    FoodResolutionStatus.PENDING,
    FoodResolutionStatus.UNRESOLVED,
    FoodResolutionStatus.RESOLVED,
    FoodResolutionStatus.NOT_FOUND,
    FoodResolutionStatus.FAILED,
]);

/**
 * A CATALOG ingredient's food-resolution status — the five mirror values, and never `NEEDS_REVIEW`.
 *
 * ⛔ Use this, not the six-member {@link FoodResolutionStatus}, wherever the value describes an `ingredients`
 * ROW. It is what makes 0023's blast-radius rule a compile error rather than a docstring: a gate verdict
 * assigned to a catalog row does not type-check.
 */
export type CatalogFoodResolutionStatus = z.infer<typeof foodResolutionStatusSchema>;

/**
 * Runtime validator for ONE RECIPE LINE's food-resolution status: every mirror value above, PLUS the
 * gate-derived {@link FoodResolutionStatus.NEEDS_REVIEW}.
 *
 * Spelled out member by member rather than spread from {@link foodResolutionStatusSchema}'s `options`: a
 * spread would make the two enums one declaration whose members are decided by whichever list happens to be
 * edited, and the whole point is that the catalog list is CLOSED against exactly one value.
 */
export const lineResolutionStatusSchema = z.enum([
    FoodResolutionStatus.PENDING,
    FoodResolutionStatus.UNRESOLVED,
    FoodResolutionStatus.RESOLVED,
    FoodResolutionStatus.NOT_FOUND,
    FoodResolutionStatus.FAILED,
    FoodResolutionStatus.NEEDS_REVIEW,
    FoodResolutionStatus.PENDING_VERIFICATION,
    FoodResolutionStatus.AMBIGUOUS,
    FoodResolutionStatus.RESOLVED_UNAVAILABLE,
    FoodResolutionStatus.FOOD_REMOVED,
    FoodResolutionStatus.FOOD_UNREACHABLE,
]);

/** One recipe line's food-resolution status — the catalog mirror widened by the gate's own verdict. */
export type LineResolutionStatus = z.infer<typeof lineResolutionStatusSchema>;

/**
 * The statuses under which a recipe line reaches the wire WITHOUT a name (plan 002 R9, R36).
 *
 * The recipe database stores no food names: a bound line's name comes from food-service at read time. So a
 * line has no name when the viewer may not see its food (`RESOLVED_UNAVAILABLE`), when food reports the food
 * gone (`FOOD_REMOVED`, for a food no longer readable) or when food could not be asked (`FOOD_UNREACHABLE`).
 * Every other line carries a name. The client renders a localised label by status for these three.
 */
export const NAMELESS_LINE_STATUSES = [
    FoodResolutionStatus.RESOLVED_UNAVAILABLE,
    FoodResolutionStatus.FOOD_REMOVED,
    FoodResolutionStatus.FOOD_UNREACHABLE,
] as const satisfies readonly LineResolutionStatus[];

/** A status under which a line carries no name. */
export type NamelessLineStatus = (typeof NAMELESS_LINE_STATUSES)[number];
