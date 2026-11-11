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
 * ## A line kept as written has an identity of its own: its binding
 *
 * A line kept as written has no FOOD to carry by, but it does have a binding: a declared freeform name that never
 * converges with another's (`createFreeform`), so no two lines share one. That binding (`keptLookupId`) is its identity,
 * and a save that sends the line back carries its `import_line_id` by it. Without this, a title-only edit would drop
 * the link of every such line (both shipped editors send every ingredient on every save) and silently count the line
 * as accepted, emptying the "to check" list the cook has not looked at (ADR-0072 §10). `bound_by` stays NULL.
 * Matching by POSITION is still refused, for the reason the precedent records (silent corruption on insert or reorder).
 * A caller that cannot name the binding (`keptLookupId` absent) gets the old answer: the link survives only if passed.
 *
 * ⚠️ `BOUND_BY_VALUES` is the one TypeScript home of the vocabulary. It is DECLARED in `@kitchensink/recipe-core`, because
 * the wire schema for a recipe line's `boundBy` is built from it there, and re-exported here so the rule reads it from the
 * domain. The SQL CHECK in migration 0060 is parity-tested against it (`importSchemaParity.test.ts`).
 */
import { BOUND_BY_VALUES, type BoundBy } from '@kitchensink/recipe-core';

export { BOUND_BY_VALUES, type BoundBy };

/** One persisted line, reduced to what this rule reads. */
export interface StoredBinding {
    /** The food binding, or `undefined` for a line kept as written. */
    readonly foodLookupId: string | undefined;
    /** For a line kept as written: its own declared binding, which is its identity. Absent for a line bound to a food. */
    readonly keptLookupId?: string;
    /** Who bound it; `null` for a line kept as written (the column's NULL). */
    readonly boundBy: BoundBy | null;
    /** The imported line it came from, or `null`. */
    readonly importLineId: string | null;
}

/** One incoming line. */
export interface IncomingBinding {
    /** The food the line will point at, or `undefined` when it is kept as written. */
    readonly foodLookupId: string | undefined;
    /** For a line kept as written: its own declared binding, which is its identity. Absent for a line bound to a food. */
    readonly keptLookupId?: string;
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
            const keptMatch =
                line.keptLookupId === undefined
                    ? -1
                    : stored.findIndex(
                          (candidate, index) =>
                              !claimed[index] &&
                              candidate.foodLookupId === undefined &&
                              candidate.keptLookupId === line.keptLookupId,
                      );

            if (keptMatch === -1) {
                return { boundBy: null, importLineId: line.importLineId };
            }

            claimed[keptMatch] = true;

            return { boundBy: null, importLineId: stored[keptMatch]?.importLineId ?? line.importLineId };
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

/**
 * What the SAVING PATH (never a client) decides for one line's origin, on top of the carry-forward rule.
 *
 *  - `set` — the bulk import's own save states the origin exactly (`exact`, `autoBest`, `NULL` for a line kept as written)
 *    and the snapshot line it came from. It consumes nothing from the stored lines.
 *  - `cook` — the cook confirmed this line (a rebind, even to the SAME food, where the carry rule alone would re-carry the
 *    stored origin). `importLineId`, when given, is the link the rebind passes on purpose for a changed food.
 *
 * ⛔ This type is internal to the service. It is never part of a request body: a client never sends `boundBy` (ADR-0072 §5),
 * and the strict request schemas make a key of that name a `400`.
 */
export type LineOriginDirective =
    | { readonly kind: 'set'; readonly boundBy: BoundBy | null; readonly importLineId: string | null }
    | { readonly kind: 'cook'; readonly importLineId?: string };

/** One incoming line with the save path's directive, when it has one. */
export type DirectedBinding = IncomingBinding & { readonly directive?: LineOriginDirective };

/**
 * Decide what each incoming line stores, applying the save path's directives over {@link carryForwardBinding}.
 *
 * Lines with no directive are exactly the carry-forward rule's. A `set` line is stored as stated and is invisible to the
 * rule (it claims no stored line, so it cannot steal the origin of an untouched line with the same food). A `cook` line goes
 * through the rule, so it consumes the stored line it matches, and then becomes the cook's if it has a food.
 *
 * TOTAL: one entry per incoming line, in order.
 *
 * @param stored - The recipe's persisted lines.
 * @param incoming - The lines the save will persist, in their final order, with their directives.
 * @returns The origin and link each line stores. Pure; neither argument is mutated.
 */
export function resolveLineBindings(
    stored: readonly StoredBinding[],
    incoming: readonly DirectedBinding[],
): readonly CarriedBinding[] {
    const ruled = incoming.flatMap((line) => {
        if (line.directive?.kind === 'set') {
            return [];
        }

        const passed = line.directive?.kind === 'cook' ? (line.directive.importLineId ?? null) : line.importLineId;

        return [{ ...stripDirective(line), importLineId: passed }];
    });
    const carried = carryForwardBinding(stored, ruled);
    let next = 0;

    return incoming.map((line) => {
        const { directive } = line;

        if (directive?.kind === 'set') {
            return { boundBy: directive.boundBy, importLineId: directive.importLineId };
        }

        const result = carried[next];

        next += 1;

        if (result === undefined) {
            throw new Error('unreachable: the carry-forward rule is total, one entry per ruled line');
        }

        return directive?.kind === 'cook' && line.foodLookupId !== undefined ? { ...result, boundBy: 'cook' } : result;
    });
}

/** The incoming line without its directive. Pure. */
function stripDirective(line: DirectedBinding): IncomingBinding {
    return {
        foodLookupId: line.foodLookupId,
        ...(line.keptLookupId === undefined ? {} : { keptLookupId: line.keptLookupId }),
        importLineId: line.importLineId,
    };
}
