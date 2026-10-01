/**
 * @module @commise/features-recipes/form — the editor's own DISPLAY CAPS for the title and description.
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
 * Maximum title length (w3/e6) — enforced client-side via `maxLength` and surfaced by a live "N/64" counter.
 *
 * ⚠️ This is the EDITOR's display cap and it is deliberately TIGHTER than the wire's
 * `MAX_RECIPE_TITLE_LENGTH` (200, from `@kitchensink/recipe-core`): a title has to fit a recipe card. The
 * relationship is the invariant —
 * the editor may be stricter than the server, NEVER looser, or the user types something the API then rejects on
 * submit. `__tests__/model.test.ts` asserts it, so raising this above the wire cap fails the build rather than
 * shipping a form that can compose an invalid body. Which of the two numbers is RIGHT for the product is an
 * open question (they were set independently and differ 3×); the invariant holds either way.
 */
export const TITLE_MAX_LENGTH = 64;

/**
 * Maximum description length (w3/e6) — enforced client-side via `maxLength` and surfaced by a live "N/256"
 * counter. Tighter than the wire's `MAX_RECIPE_DESCRIPTION_LENGTH` (5000) for the same reason, and under the
 * same asserted invariant, as {@link TITLE_MAX_LENGTH}.
 */
export const DESCRIPTION_MAX_LENGTH = 256;
