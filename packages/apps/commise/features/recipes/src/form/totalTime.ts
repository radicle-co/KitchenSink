/**
 * @module @commise/features-recipes/form — the auto-computed TOTAL TIME rule (FR-001): total = prep + cook, shown read-only.
 *
 * ⚠️ One line, its own module, and that is deliberate. Four independent consumers across three folders read
 * it — both `RecipeBasicsFields` leaves to render the label, `props.ts` for the review rows, `wire.ts` for
 * the stored `totalTimeMinutes`, and `versions/merge.ts` when projecting a snapshot back to a detail. The
 * number the editor SHOWS and the number the wire STORES must be the same number, or a card shows a total
 * the stored recipe does not have. That is one piece of knowledge with four readers.
 *
 * It takes two numbers rather than a `RecipeFormValues` on purpose, so a display leaf need not know the
 * draft shape to render a total.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */

/**
 * Total time = prep + cook (FR-001 auto-computed; the editor shows it read-only). Pure.
 *
 * @param prepTimeMinutes - Prep minutes.
 * @param cookTimeMinutes - Cook minutes.
 * @returns The summed total minutes.
 */
export const computeTotalTime = (prepTimeMinutes: number, cookTimeMinutes: number): number =>
    prepTimeMinutes + cookTimeMinutes;
