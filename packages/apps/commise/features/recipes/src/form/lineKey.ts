/**
 * @module @commise/features-recipes/form — an ingredient line's IDENTITY in the draft, and the map from that identity
 * to the position the server stores the line at.
 *
 * Two jobs, one module, because they answer one question ("which line is this?") for two readers:
 *
 * - **React.** A row is keyed by its line's key, never by its array index (ENGINEERING_EXCELLENCE, frontend §3). An
 *   index key hands one row's open panel, focus and in-flight state to the row below it when a line is removed.
 * - **The rebind command.** It addresses a stored line by POSITION (`ingredientRebind.service.ts`), and the server
 *   stores lines in submitted order with every no-food line dropped (`toCreateRecipeInput`, `./wire.ts`). So a draft
 *   index is the wrong answer as soon as the cook removes a line above, and {@link storedPositionOf} reads the
 *   persisted lines instead.
 *
 * ⚠️ A key never leaves memory: it is not on the wire and not in a version. That is what makes its spelling free.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Value Object — the branded {@link IngredientLineKey}
 * @pattern Identity Map — {@link storedPositionOf} maps a line's identity to its stored position
 */

declare const ingredientLineKeyBrand: unique symbol;

/** A draft ingredient line's identity. Branded, so an index or an id cannot be passed where a key is meant. */
export type IngredientLineKey = string & { readonly [ingredientLineKeyBrand]: true };

/** A seeded key: the version the line was read at, and its position in that read. */
const SEEDED = /^v(\d+)\.(\d+)$/;
/** A minted key: an id from a source that never repeats (`mintLineKey.ts`). */
const MINTED = /^n:[A-Za-z0-9_-]+$/;

/**
 * Whether a string is a key this module produced. The one place the brand is asserted. Pure.
 *
 * @param text - The candidate.
 * @returns `true` for a seeded or minted key.
 */
export const isIngredientLineKey = (text: string): text is IngredientLineKey => SEEDED.test(text) || MINTED.test(text);

/**
 * The key of the line read at `index` of recipe version `version`.
 *
 * Deterministic on purpose: seeding the same detail twice yields equal drafts, so the discard guard sees no change.
 * The version is in the key so that a merge of "mine" with "theirs" — two reads of different versions — cannot give
 * two lines one key. Pure.
 *
 * @param version - The recipe version the detail was read at.
 * @param index - The line's position in that read.
 * @returns The line's key.
 */
export const seedLineKey = (version: number, index: number): IngredientLineKey => {
    const key = `v${version}.${index}`;

    if (!isIngredientLineKey(key)) {
        throw new RangeError(`seedLineKey: version and index must be non-negative integers, got ${version}, ${index}`);
    }

    return key;
};

/**
 * The key of a line added in this session, from an id that never repeats. Pure: the impure half — minting the id — is
 * `mintLineKey` (`./mintLineKey.ts`), at the edge, so the append transition can take the key as a parameter.
 *
 * ⛔ NOT "one past the highest key in the draft". That reissues a key as soon as the line holding the highest one is
 * removed, and a reissued key inherits whatever was addressed by the old one: a commit still in flight for that line,
 * or (once saved) its stored position — which the rebind command would re-point and write a correction against.
 *
 * @param id - A never-repeating id (a UUID from the house seam).
 * @returns The line's key.
 * @throws RangeError when `id` is not a plain token.
 */
export const mintedLineKey = (id: string): IngredientLineKey => {
    const key = `n:${id}`;

    if (!isIngredientLineKey(key)) {
        throw new RangeError(`mintedLineKey: the id must be a plain token, got ${JSON.stringify(id)}`);
    }

    return key;
};

/** The two fields of a line the stored-position map reads. */
export interface KeyedLine {
    readonly key: IngredientLineKey;
    readonly ingredientId: string | null;
}

/**
 * Whether the server stores this draft line on save: it does exactly when the line has a binding.
 *
 * ⛔ The one statement of that rule. `toCreateRecipeInput` (`./wire.ts`), `draftToSnapshot` (`../versions/merge.ts`)
 * and {@link persistedLineKeysOf} all filter through it, so the stored-position map cannot disagree with what was
 * actually sent. Pure.
 *
 * ⚠️ UNRESOLVED, owed to the owner: `isResolvedIngredientId` (`./validate.ts`), which the row policy and
 * `validateRecipeForm` use, also treats an EMPTY-string id as no food, and this predicate does not. Autosave runs only
 * the floor validation, so a `''` line would be sent and counted here while its row says it will not be saved.
 * Which predicate wins is a product call (staff-architect REVIEW F5); whether `''` can reach the draft is unverified.
 *
 * @param line - A draft line.
 * @returns `true` when the line is sent, and so stored.
 */
export const isStoredLine = <T extends { readonly ingredientId: string | null }>(
    line: T,
): line is T & { readonly ingredientId: string } => line.ingredientId !== null;

/**
 * The keys of the persisted lines, in the order the server stores them. Pure.
 *
 * @param persisted - The draft as last saved (or as seeded).
 * @returns The stored lines' keys; the index of a key is its stored position.
 */
export const persistedLineKeysOf = (persisted: readonly KeyedLine[]): readonly IngredientLineKey[] =>
    persisted.filter(isStoredLine).map((line) => line.key);

/**
 * The position the server stores the line with this key at, or `undefined` when it stores no such line (added this
 * session, or never sent because it has no food). Pure.
 *
 * @param persistedKeys - From {@link persistedLineKeysOf}.
 * @param key - The line to locate.
 * @returns Its stored position, or `undefined`.
 */
export const storedPositionOf = (
    persistedKeys: readonly IngredientLineKey[],
    key: IngredientLineKey,
): number | undefined => {
    const position = persistedKeys.indexOf(key);

    return position === -1 ? undefined : position;
};
