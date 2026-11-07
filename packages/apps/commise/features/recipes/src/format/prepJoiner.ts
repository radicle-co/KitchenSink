/**
 * @module @commise/features-recipes/format — what joins a preparation to the name before it (`designAnswers.md`
 * 2026-11-06, fractions item 6: "unsalted butter · melted").
 *
 * A no-break space, a dot and an ordinary space: the no-break space keeps the dot on the name's line, so the
 * preparation never wraps onto a line of its own with nothing joining it. The dot is never spoken: the row's accessible
 * name carries a comma instead (web `PrepJoin`, native the row's `accessibilityLabel`).
 */
export const PREP_JOINER = ' · ';
