/**
 * Which food ids an answer discloses to its caller (ADR-0040, food half): the ids a real cook can come to bind a recipe
 * line to, and so the roots a test purge must not delete.
 *
 * @pattern Specification — pure readers over the published response shapes; no I/O, one place that names the fields
 *   an answer can carry a root in, so a route cannot forget its forward target or a variant's root.
 * @module
 */
import type { AddResponse, BatchResponse, FoodRefEntry, FoodResponse, StatusResponse } from '../foods.schema.js';

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

/**
 * The ids a by-id read names: the requested id and, for a retired root, the live root or variant whose data it carries.
 *
 * @param response - The food body.
 * @returns The id the caller asked for, then the forward target when there is one. Pure.
 */
export function idsOfFood(response: Pick<FoodResponse, 'id' | 'forwardedTo'>): string[] {
    return response.forwardedTo === undefined ? [response.id] : [response.id, response.forwardedTo.id];
}

/**
 * The ids a status poll names: its own id and, once `RESOLVED`, the ids of the record it carries.
 *
 * @param response - The status body.
 * @returns The polled id, then the record's forward target when there is one. Pure.
 */
export function idsOfStatus(response: Pick<StatusResponse, 'id' | 'food'>): string[] {
    return response.food === undefined ? [response.id] : [...new Set([response.id, ...idsOfFood(response.food)])];
}
