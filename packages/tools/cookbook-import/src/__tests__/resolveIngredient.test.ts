/**
 * Unit tests for the ingredient-resolution SEQUENCE.
 *
 * ## What this module is, and what it must never become
 *
 * The exercise this tool exists for is measuring **the system's** ability to match real recipe language
 * against the food catalog. So the sequence below must be indistinguishable from a person using the
 * ingredient picker: type a name, look at what the app offers, take it — or fall back. Every ranking
 * decision belongs to the service.
 *
 * The tests are therefore written to FAIL if this module ever starts choosing:
 *
 *  - it must take the FIRST suggestion the service returned, never a "better" one further down;
 *  - it must send the parsed name UNCHANGED, never a catalog-friendlier rewrite;
 *  - it must never call the food service, and it has no way to — the port has no such method.
 *
 * A mutant that scored suggestions, or that retried with a simplified name, would inflate the resolution
 * rate while measuring nothing, and that is the one failure this whole exercise cannot tolerate.
 */
import { describe, expect, it } from 'vitest';

import { resolveIngredientLikeAUser, type IngredientResolutionPort } from '../resolveIngredient.js';

/** A catalog row, shaped as the published `ingredientSchema` publishes it. */
function ingredient(over: Record<string, unknown> = {}) {
    return {
        id: '00000000-0000-4000-8000-00000000aaaa',
        name: 'Butter',
        isUserEntered: true,
        createdAt: '2026-08-19T00:00:00.000Z',
        ...over,
    } as never;
}

/**
 * A recording fake of the port.
 *
 * ⚠️ Overrides supply the RESULT, never the method, so recording can never be bypassed. An earlier version
 * let a test replace the whole method and the call log silently went empty — the assertions still "passed"
 * in the shapes that did not read the log, which is precisely the coverage theatre this file is about.
 */
function fakePort(over: Partial<Record<keyof IngredientResolutionPort, () => Promise<never>>> = {}) {
    const calls: { method: string; argument: string }[] = [];

    const record = <T>(method: string, argument: string, fallback: () => T): Promise<T> => {
        calls.push({ method, argument });
        const override = over[method as keyof IngredientResolutionPort];

        return override === undefined ? Promise.resolve(fallback()) : (override() as Promise<T>);
    };

    const port: IngredientResolutionPort = {
        suggestIngredients: (query) =>
            record('suggestIngredients', query, () => ({ suggestions: [], catalogAvailability: 'ok' }) as never),
        addIngredientByFood: (foodId) =>
            record('addIngredientByFood', foodId, () =>
                ingredient({ foodId, name: 'Butter, salted', isUserEntered: false }),
            ),
        addIngredientByName: (name) =>
            record('addIngredientByName', name, () =>
                ingredient({ name, foodId: 'food_new', foodResolutionStatus: 'PENDING', isUserEntered: false }),
            ),
        createFreeformIngredient: (name) => record('createFreeformIngredient', name, () => ingredient({ name })),
    };

    return { port, calls };
}

/** A `catalog`-provenance suggestion. */
function catalogHit(foodId: string, name: string, score: number) {
    return { provenance: 'catalog', foodId, name, score };
}

/** A `local`-provenance suggestion. */
function localHit(id: string, name: string) {
    return { provenance: 'local', ingredient: ingredient({ id, name }) };
}

describe('resolveIngredientLikeAUser — it takes the system’s answer, it does not compute one', () => {
    it('admits the FIRST catalog suggestion, even when a later one scores higher', async () => {
        // The ordering is the SERVICE's — blended, deduped and scored by it. Reordering here would replace
        // the thing being measured with this file's opinion of it.
        const { port, calls } = fakePort({
            suggestIngredients: async () =>
                ({
                    suggestions: [
                        catalogHit('food_first', 'Butter, salted', 0.5),
                        catalogHit('food_better', 'Butter', 0.9),
                    ],
                    catalogAvailability: 'ok',
                }) as never,
        });

        const outcome = await resolveIngredientLikeAUser(port, 'butter');

        expect(outcome.kind).toBe('catalog_suggestion');
        expect(calls.some((call) => call.method === 'addIngredientByFood' && call.argument === 'food_first')).toBe(
            true,
        );
        expect(calls.some((call) => call.argument === 'food_better')).toBe(false);
    });

    it('uses a LOCAL suggestion directly, without a second round trip', async () => {
        const { port, calls } = fakePort({
            suggestIngredients: async () =>
                ({ suggestions: [localHit('local-1', 'Butter')], catalogAvailability: 'ok' }) as never,
        });

        const outcome = await resolveIngredientLikeAUser(port, 'butter');

        expect(outcome.kind).toBe('local_suggestion');
        expect(calls.map((call) => call.method)).toEqual(['suggestIngredients']);
    });

    it('falls back to add-by-name when the service offered NOTHING — the app’s own primary action', async () => {
        const { port, calls } = fakePort();

        const outcome = await resolveIngredientLikeAUser(port, 'sour grass');

        expect(outcome.kind).toBe('added_by_name');
        expect(calls.map((call) => call.method)).toEqual(['suggestIngredients', 'addIngredientByName']);
    });

    it('falls back to FREEFORM when add-by-name is refused, so a line is never lost', async () => {
        const { port, calls } = fakePort({
            addIngredientByName: async () => {
                throw new Error('400 UNKNOWN_INGREDIENT');
            },
        });

        const outcome = await resolveIngredientLikeAUser(port, 'a piece the size of an egg');

        expect(outcome.kind).toBe('freeform');
        expect(calls.map((call) => call.method)).toEqual([
            'suggestIngredients',
            'addIngredientByName',
            'createFreeformIngredient',
        ]);
    });

    it('sends the parsed name UNCHANGED at every step', async () => {
        // ⛔ The anti-cheat assertion. Rewriting "sifted flour" to "flour" to find a match would raise the
        // resolution rate while destroying the measurement — the number would describe this file's
        // vocabulary, not the product's.
        const { port, calls } = fakePort();

        await resolveIngredientLikeAUser(port, 'Sifted Flour');

        for (const call of calls.filter((c) => c.method !== 'addIngredientByFood')) {
            expect(call.argument).toBe('Sifted Flour');
        }
    });

    it('reports a DEGRADED catalog distinctly from a genuine miss', async () => {
        // `catalogAvailability: 'unavailable'` means the food catalog contributed nothing because it was
        // unreachable — not because it holds no match. Counting that as "no match" would silently under-report
        // the system's ability during an outage, which is the opposite of an honest measurement.
        const { port } = fakePort({
            suggestIngredients: async () => ({ suggestions: [], catalogAvailability: 'unavailable' }) as never,
        });

        const outcome = await resolveIngredientLikeAUser(port, 'butter');

        expect(outcome.catalogAvailability).toBe('unavailable');
    });

    it('never reaches for a food-service call — the port cannot express one', () => {
        const { port } = fakePort();

        expect(Object.keys(port).some((method) => /food(Service|Search)|searchFoods/i.test(method))).toBe(false);
    });
});
