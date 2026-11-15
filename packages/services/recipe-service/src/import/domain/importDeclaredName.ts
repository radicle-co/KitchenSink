/**
 * The ids a bulk import declares a line's name under (ADR-0072 §3; review item 4 on #220).
 *
 * DESIGN PATTERN: **Deterministic identifier** (idempotency key), the sibling of `importJobIdOf`. The save declares a name
 * for every line it keeps as written BEFORE the create runs, because the create's planner reads the line's binding outside
 * the recipe's transaction. A declaration is a new record each time, so a create that then failed (food down in the
 * planner, a lost claim, no private slot) left a fresh set of records behind on every retry. Deriving the record's ids from
 * the name's place in the import turns the retry into a lookup of the records the first try wrote.
 *
 * The place is (import, ordinal, parse generation, line, food). A new generation is a new parse of new text, so it declares
 * new records; a line kept whole (it parsed to no food) is `whole` in the food position.
 */
import { uuidV8Of } from '../../common/derivedUuid.js';

/** Where a declared name sits in an import. */
export interface DeclaredNameSlot {
    readonly importId: string;
    readonly ordinal: number;
    /** The item's `parse_generation`. */
    readonly generation: number;
    readonly lineIndex: number;
    /** The food of the line, or `whole` for a line kept whole as written. */
    readonly foodIndex: number | 'whole';
}

/** The ids a declaration writes: its failure record and its binding. */
export interface DeclaredNameIds {
    readonly failureId: string;
    readonly lookupId: string;
}

/**
 * The ids of the name declared at `slot`.
 *
 * @param slot - Where the name sits.
 * @param sha256Hex - The hash, injected so the domain imports no crypto.
 * @returns Two UUIDs, one per record. Pure.
 */
export function importDeclaredNameIdsOf(slot: DeclaredNameSlot, sha256Hex: (text: string) => string): DeclaredNameIds {
    // `:` cannot appear in a UUID, a number or `whole`, so the parts cannot be re-cut into another slot.
    const place = [slot.importId, slot.ordinal, slot.generation, slot.lineIndex, slot.foodIndex].map(String).join(':');

    return {
        failureId: uuidV8Of(`recipe-import-declared-failure:${place}`, sha256Hex),
        lookupId: uuidV8Of(`recipe-import-declared-lookup:${place}`, sha256Hex),
    };
}
