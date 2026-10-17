/**
 * @module @commise/features-recipes/form — the editor's own limits for the title and description.
 *
 * ⚠️ Both are deliberately TIGHTER than the wire's own bounds, and the direction is the rule: the editor may
 * be stricter than the server, NEVER looser. `validateRecipeForm` does NOT read these — it composes the
 * wire's own schemas — so nothing but `__tests__/limits.test.ts` keeps the two in step. That suite is the
 * guard, not adjacency.
 *
 * ⚠️ They sit in their own module because a display cap is product policy with its own change cadence, and
 * `values.ts` — which every other module imports — is the wrong place to park something that churns.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */

/**
 * The title limit a recipe must meet to be PUBLISHED (owner, `docs/design/uiOverhaul/ownerDecisions.md`).
 *
 * ⛔ A SOFT limit: no `maxLength`, so nothing is ever cut silently. Past it the counter turns `danger` and Publish is
 * refused (`validateRecipeForm`'s `titleTooLong`). A draft past it still saves, up to the wire's
 * `MAX_RECIPE_TITLE_LENGTH` (200), which the draft floor enforces instead (`draftFloorErrors`).
 */
export const TITLE_MAX_LENGTH = 120;

/** The title length from which the "{n}/120" counter shows (build spec §7.4). */
export const TITLE_COUNTER_FROM = 100;

/**
 * Maximum description length (w3/e6), surfaced by a "N/256" counter. Tighter than the wire's
 * `MAX_RECIPE_DESCRIPTION_LENGTH` (5000) for the same reason, and under the same asserted invariant, as
 * {@link TITLE_MAX_LENGTH}.
 *
 * ⚠️ SOFT since the one-page editor: the design-system `TextArea` takes no `maxLength`, and nothing is cut silently, so
 * past it the counter turns `danger`. `validateRecipeForm` does NOT refuse it, so the field is not marked invalid.
 */
export const DESCRIPTION_MAX_LENGTH = 256;

/** The description length from which its counter shows: 80% of {@link DESCRIPTION_MAX_LENGTH} (build spec §7.4). */
export const DESCRIPTION_COUNTER_FROM = Math.ceil(DESCRIPTION_MAX_LENGTH * 0.8);
