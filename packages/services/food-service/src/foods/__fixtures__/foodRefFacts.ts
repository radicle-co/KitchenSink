/**
 * Fixture factories for the reference resolver (`make*` accepting `Partial<T>`, per CODING_STANDARDS).
 *
 * Used by the resolver's unit table, the service and controller unit tests, and the mocked integration tier,
 * so every tier builds a food row the same way.
 */
import type { FoodRefFacts } from '../dao/food.dao.js';

/** The author every private fixture belongs to. */
export const AUTHOR_ID = '01JAUTHORAAAAAAAAAAAAAAAAA';

/** A caller who authored nothing here. */
export const STRANGER_ID = '01JSTRANGERBBBBBBBBBBBBBBB';

/**
 * One food row's reader facts. Defaults to a RESOLVED CATALOG food (no author, public).
 *
 * @param overrides - The fields to change.
 * @returns The facts. Pure.
 */
export function makeFoodRefFacts(overrides: Partial<FoodRefFacts> = {}): FoodRefFacts {
    return {
        id: '01J9ZZZZZZZZZZZZZZZZZZZZZZ',
        name: 'Broccoli, raw',
        status: 'RESOLVED',
        userId: null,
        visibility: 'public',
        retired: false,
        ...overrides,
    };
}

/**
 * A food {@link AUTHOR_ID} authored and kept PRIVATE.
 *
 * @param overrides - The fields to change.
 * @returns The facts. Pure.
 */
export function makePrivateFoodRefFacts(overrides: Partial<FoodRefFacts> = {}): FoodRefFacts {
    return makeFoodRefFacts({ name: 'Grandma’s spice mix', userId: AUTHOR_ID, visibility: 'private', ...overrides });
}
