/**
 * @module @commise/features-recipes/collections — the collection sheet's display caps
 * (`docs/architecture/uiOverhaulBlueprint.md` A12; `docs/design/uiOverhaul/buildSpec.md` §5.1).
 *
 * The wire allows a name of 120 and a description of 1000 (`@kitchensink/schema-recipe`); the sheet caps them at 80 and
 * 280 so a name stays readable on a card. The governing rule is `form/limits.ts`'s: the form may be stricter than the
 * server, NEVER looser — asserted against the schema package's bounds in `__tests__/limits.test.ts`.
 *
 * Pure.
 */

/** The longest name the sheet accepts. */
export const COLLECTION_NAME_MAX_LENGTH = 80;

/** The longest description the sheet accepts. */
export const COLLECTION_DESCRIPTION_MAX_LENGTH = 280;

/** The name length from which the sheet shows its "34/80" counter. */
export const COLLECTION_NAME_COUNTER_FROM = 60;

/**
 * Whether the sheet shows the name's counter.
 *
 * @param name - The name as typed.
 * @returns `true` from {@link COLLECTION_NAME_COUNTER_FROM} characters.
 */
export function showsNameCounter(name: string): boolean {
    return name.length >= COLLECTION_NAME_COUNTER_FROM;
}
