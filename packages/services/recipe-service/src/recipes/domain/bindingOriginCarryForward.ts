/**
 * THE BINDING-ORIGIN CARRY-FORWARD RULE — who bound an ingredient line (`bound_by`) and which imported line it came
 * from (`import_line_id`), and when a save keeps those facts.
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total, shaped like `transcriptionCarryForward.ts` and
 * deliberately SEPARATE from it. The two rules answer different questions with different identities:
 *
 *  - the transcription rule carries what the SOURCE said, so it is keyed on the whole judgement (food, quantity,
 *    unit): an edited amount makes the source line stale;
 *  - this rule carries who chose the FOOD, so the identity is the food alone: editing `2 cups` to `3 cups` leaves the
 *    binding exactly as it was, and merging the two would drop `bound_by` on every amount edit.
 *
 * ## Rules
 *  - Same food as an unclaimed stored line: carry `bound_by` and `import_line_id`.
 *  - A food the stored lines do not hold: the cook chose it, so `cook`. The import link is cleared unless the
 *    caller passes it (a rebind command carries the stored link on purpose).
 *  - A line kept as written has no food, so `bound_by` is NULL.
 *
 * ⛔ A MULTISET consumed in stored order, as in the precedent: two lines of one recipe may share a food, and a map
 * would give BOTH the same origin.
 *
 * ⚠️ Consequence worth knowing: a stored as-written line has no identity to match on, so a save that sends it back
 * carries nothing for it. Its `import_line_id` survives only when the caller passes it. Matching by position would
 * hide that and is refused for the reason the precedent records (silent corruption on insert or reorder).
 *
 * ⚠️ `BOUND_BY_VALUES` is the one home of the vocabulary. The SQL CHECK in the migration that adds the column must be
 * parity-tested against it.
 */

/** Who bound a line to its food. */
export const BOUND_BY_VALUES = ['exact', 'curated', 'review', 'default', 'autoBest', 'cook'] as const;

/** One origin. */
export type BoundBy = (typeof BOUND_BY_VALUES)[number];

/** One persisted line, reduced to what this rule reads. */
export interface StoredBinding {
    /** The food binding, or `undefined` for a line kept as written. */
    readonly foodLookupId: string | undefined;
    /** Who bound it; `null` for a line kept as written (the column's NULL). */
    readonly boundBy: BoundBy | null;
    /** The imported line it came from, or `null`. */
    readonly importLineId: string | null;
}

/** One incoming line. */
export interface IncomingBinding {
    /** The food the line will point at, or `undefined` when it is kept as written. */
    readonly foodLookupId: string | undefined;
    /** The import link the caller passes on purpose, or `null`. */
    readonly importLineId: string | null;
}

/** What one incoming line stores. */
export interface CarriedBinding {
    readonly boundBy: BoundBy | null;
    readonly importLineId: string | null;
}

/**
 * Decide what each incoming line stores for `bound_by` and `import_line_id`.
 *
 * TOTAL: exactly one entry per incoming line, in the caller's order.
 *
 * @param stored - The recipe's persisted lines, in any order.
 * @param incoming - The lines the save will persist, in their final order.
 * @returns The origin and link each line stores. Pure; neither argument is mutated.
 */
export function carryForwardBinding(
    stored: readonly StoredBinding[],
    incoming: readonly IncomingBinding[],
): readonly CarriedBinding[] {
    const claimed = new Array<boolean>(stored.length).fill(false);

    return incoming.map((line) => {
        if (line.foodLookupId === undefined) {
            return { boundBy: null, importLineId: line.importLineId };
        }

        const match = stored.findIndex(
            (candidate, index) =>
                !claimed[index] && candidate.boundBy !== null && candidate.foodLookupId === line.foodLookupId,
        );
        const found = match === -1 ? undefined : stored[match];

        if (found?.boundBy == null) {
            return { boundBy: 'cook', importLineId: line.importLineId };
        }

        claimed[match] = true;

        return { boundBy: found.boundBy, importLineId: found.importLineId };
    });
}
