/**
 * Which food ids an answer discloses to its caller (ADR-0040, food half): the ids a real cook can come to bind a recipe
 * line to, and so the roots a test purge must not delete.
 *
 * @pattern Specification — pure readers over the published response shapes; no I/O, one place that names the fields
 *   an answer can carry a root in, so a route cannot forget its forward target or a variant's root.
 * @module
 */
import type { AddResponse, BatchResponse, FoodRefEntry } from '../foods.schema.js';

/**
 * The ids an add-by-name answer names.
 *
 * @param response - The `202` body.
 * @returns The answered root and, when it forwards, the entry it forwards to. Pure.
 */
export function idsOfAdd(response: Pick<AddResponse, 'id' | 'forwardedTo'>): string[] {
    return response.forwardedTo === undefined ? [response.id] : [response.id, response.forwardedTo.id];
}

/**
 * The ids a batch add answer names.
 *
 * @param response - The batch body.
 * @returns Every item's id and forward target, in order. Pure.
 */
export function idsOfBatch(response: BatchResponse): string[] {
    return response.items.flatMap((item) => idsOfAdd(item));
}

/**
 * The ids a ref-resolve answer names, whether or not the caller may see the food: the caller sent the id and was
 * answered about it.
 *
 * @param entries - The answer's entries.
 * @returns Each entry's ref, a variant's root and the forward target. Pure.
 */
export function idsOfRefEntries(entries: readonly FoodRefEntry[]): string[] {
    return entries.flatMap((entry) => {
        if (entry.outcome === 'absent') {
            return [entry.ref.id];
        }

        return [
            entry.ref.id,
            ...(entry.variant === undefined ? [] : [entry.variant.rootId]),
            ...(entry.forwardedTo === undefined ? [] : [entry.forwardedTo.id]),
        ];
    });
}
