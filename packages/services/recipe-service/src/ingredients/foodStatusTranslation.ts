/**
 * THE ANTI-CORRUPTION LAYER over food-service's status envelope: everything recipe-service takes from a
 * `StatusResult`, in one place, as pure total functions.
 *
 * DESIGN PATTERN: **Anti-Corruption Layer** (Evans). Food publishes its own lifecycle vocabulary and its own
 * golden record; this service persists neither verbatim. Exactly two facts cross — the status this ingredient
 * should record, and the display name its shared catalog row should now carry — and both crossings need
 * judgement. Keeping them together, rather than as two lone functions inside a 500-line service class, is what
 * makes "what do we accept from food, and on what terms?" a question with ONE place to read the answer.
 *
 * Both functions are pure and total, so both are provable by table test rather than by booting anything.
 * Neither knows the DAL, Nest, or HTTP.
 */
import type { CatalogFoodResolutionStatus } from '@kitchensink/recipe-core';
import type { FoodStatus, StatusResult } from '@kitchensink/food-service-client';

import { canonicalIngredientName, type CanonicalIngredientName } from './domain/ingredientName.js';

/**
 * Translate food's lifecycle status into recipe's persisted resolution status. Pure and total.
 *
 * ⛔ **This was a CAST, and the cast shipped a production `500`.** It read
 * `return status as FoodResolutionStatus`, above a comment asserting the two unions "are the SAME
 * UPPER_SNAKE union by design (they mirror each other)". True when written; falsified by plan U9, which
 * added `AWAITING_RETRY` to FOOD's enum and left recipe's five-value CHECK constraint
 * (`0001_initial.sql`) untouched. Because a cast asks the compiler to stop checking, `tsc` stayed silent
 * and the failure surfaced only as a check-constraint violation on write, for any ingredient whose food
 * was mid-retry.
 *
 * The `switch` is the point: it is exhaustive over food's union, so the next status food adds is a
 * COMPILE error here rather than a runtime one in production. Do not replace it with a cast, a lookup
 * with a default, or a `Record` that TypeScript cannot prove total.
 *
 * ⚠️ `AWAITING_RETRY` maps to `PENDING`, deliberately. Recipe's union is a UX vocabulary — "not ready
 * yet, will transition" versus "terminal, offer the freeform fallback" — and a scheduled retry is the
 * former: food's own transition table makes `AWAITING_RETRY` a legal prior for `RESOLVED`, and it becomes
 * `FAILED` only once the retry budget is exhausted, which recipe then sees as the terminal state it
 * already handles. Reporting failure here would strand the ingredient in the picker's terminal branch
 * while food was still working on it.
 *
 * ⛔ The return type is the CATALOG subset, not the six-member `FoodResolutionStatus`. Food-service cannot
 * publish `NEEDS_REVIEW` — that value is OUR OWN per-recipe-line verification verdict (plan U14), and
 * migration 0023 forbids it on this shared catalog row. Narrowing here is what stops it being returnable
 * from a translation of somebody else's lifecycle.
 *
 * @param status - The status food published.
 * @returns The status recipe persists and renders.
 */
export function toResolutionStatus(status: FoodStatus): CatalogFoodResolutionStatus {
    switch (status) {
        case 'PENDING':
        case 'UNRESOLVED':
        case 'RESOLVED':
        case 'NOT_FOUND':
        case 'FAILED':
            return status;
        case 'AWAITING_RETRY':
            return 'PENDING';
    }
}

/**
 * Decide whether a food-status result licenses RENAMING the shared catalog row, and to what. Pure and total.
 *
 * ⛔ **The write path is what polluted the catalog, and this is the guard on it** (plan U3). `ingredients` is
 * ownerless and shared: from the picker `addByName` receives a search term ("butter"), but from the cookbook
 * importer it receives a fragment of recipe prose ("1 cup of sifted pastry flour, well packed"), and that
 * string became the permanent label every other user searched — the same defect `addByFoodId`'s own docstring
 * forbids ("accepting a caller-supplied name would let any authenticated client attach an arbitrary label to
 * a real food"). The repair is to adopt food-service's canonical name at the moment the food RESOLVES, which
 * is the first moment such a name exists.
 *
 * ⚠️ A `RESOLVED` status may still carry NO usable name, in three distinct ways the wire contract permits —
 * `statusResponseSchema.food` is optional, `foodResponseSchema.name` is `z.string().nullable()`, and a
 * present name may canonicalize to nothing. Since `ingredients.name` is `NOT NULL` and the caller's text is
 * the only other label the row has, every one of those returns `undefined`: record the status, keep the name.
 * Testing `status === 'RESOLVED'` alone, without those three checks, writes `null`/`''` into that column.
 *
 * ⚠️ The name is re-parsed here even though food-service canonicalizes its own. The two are separate deploys
 * and the canonical form is idempotent, so this costs nothing and closes the case where the value we receive
 * did not come through food's boundary in the form we assume — which is what an anti-corruption layer is for.
 *
 * @param status - The status result food published for this ingredient's food.
 * @returns The canonical name to adopt, or `undefined` to leave the existing name untouched.
 */
export function canonicalNameFrom(status: StatusResult): CanonicalIngredientName | undefined {
    if (status.status !== 'RESOLVED' || status.food === undefined || status.food.name === null) {
        return undefined;
    }

    return canonicalIngredientName(status.food.name);
}
