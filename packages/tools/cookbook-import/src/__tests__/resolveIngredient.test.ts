/**
 * Unit tests for the ingredient-resolution SEQUENCE.
 *
 * ## What this module is, and what it must never become
 *
 * The exercise this tool exists for is measuring **the system's** ability to match real recipe language
 * against the food catalog. So the sequence below must be indistinguishable from a cook using the
 * ingredient entry: type a name, look at what the list offers, take it — or fall back. After plan 002 S5 the
 * list is food's two split searches, offered by `@kitchensink/recipe-core/resolution/food-search-groups`, and a
 * pick binds through recipe's `by-food` or `by-food-variant` door.
 *
 * The tests are therefore written to FAIL if this module ever starts choosing:
 *
 *  - it must take the FIRST food the list offers, never a "better" one further down;
 *  - it must send the parsed name UNCHANGED, never a catalog-friendlier rewrite;
 *  - it must search only what the list searches — the port cannot express live search or the legacy search.
 *
 * A mutant that scored results, or that retried with a simplified name, would inflate the resolution rate
 * while measuring nothing, and that is the one failure this whole exercise cannot tolerate.
 */
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import {
    FetchUnavailableError,
    SearchRateLimitedError,
    SourceBusyError,
    UnauthorizedError,
    type AuthoredFoodSearchResultView,
    type CatalogSearchResultView,
} from '@kitchensink/food-service-client';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Ingredient } from '../RecipeApiClient.js';
import {
    resolveIngredientLikeAUser,
    type FoodSearchPort,
    type IngredientResolutionPorts,
} from '../resolveIngredient.js';

/** One call a port received. */
interface Call {
    readonly method: string;
    readonly argument: string;
}

/**
 * What the fake services answer. Each entry supplies a RESULT, never a method, so recording can never be
 * bypassed: an earlier fake let a test replace a whole method, and its call log silently went empty.
 */
interface Answers {
    readonly authored: () => Promise<readonly AuthoredFoodSearchResultView[]>;
    readonly catalog: () => Promise<readonly CatalogSearchResultView[]>;
    readonly byName: (name: string) => Promise<Ingredient>;
}

const noFoods = async (): Promise<readonly never[]> => [];

/** A food-backed binding, as `by-food` and `by-food-variant` answer. */
const boundTo = (foodId: string): Ingredient =>
    makeIngredient({ id: `00000000-0000-4000-8000-${foodId.padStart(12, '0').slice(-12)}`, name: foodId, foodId });

/** A recording fake of both ports. */
function fakePorts(over: Partial<Answers> = {}): { readonly ports: IngredientResolutionPorts; readonly calls: Call[] } {
    const calls: Call[] = [];
    const answers: Answers = {
        authored: noFoods,
        catalog: noFoods,
        byName: async (name) => makeIngredient({ name, foodId: undefined, foodResolutionStatus: 'PENDING' }),
        ...over,
    };

    const ports: IngredientResolutionPorts = {
        food: {
            searchAuthored: async (query) => {
                calls.push({ method: 'searchAuthored', argument: query });

                return { results: [...(await answers.authored())] };
            },
            searchCatalog: async (query) => {
                calls.push({ method: 'searchCatalog', argument: query });

                return { results: [...(await answers.catalog())] };
            },
        },
        recipe: {
            addIngredientByFood: async (foodId) => {
                calls.push({ method: 'addIngredientByFood', argument: foodId });

                return boundTo(foodId);
            },
            addIngredientByFoodVariant: async (foodVariantId) => {
                calls.push({ method: 'addIngredientByFoodVariant', argument: foodVariantId });

                return boundTo(foodVariantId);
            },
            addIngredientByName: async (name) => {
                calls.push({ method: 'addIngredientByName', argument: name });

                return answers.byName(name);
            },
            createFreeformIngredient: async (name) => {
                calls.push({ method: 'createFreeformIngredient', argument: name });

                return makeIngredient({
                    name,
                    foodId: undefined,
                    foodResolutionStatus: undefined,
                    isUserEntered: true,
                });
            },
        },
    };

    return { ports, calls };
}

const authoredHit = (id: string, name: string | null): AuthoredFoodSearchResultView => ({ id, name, score: 0.5 });
const catalogHit = (id: string, name: string | null, score = 0.5): CatalogSearchResultView => ({ id, name, score });

/** The methods called, in order, leaving out the two searches every lookup makes. */
const bindingCalls = (calls: readonly Call[]): string[] =>
    calls.filter((call) => !call.method.startsWith('search')).map((call) => `${call.method}(${call.argument})`);

describe('resolveIngredientLikeAUser — it takes the system’s answer, it does not compute one', () => {
    it('binds the cook’s OWN food first, ahead of the catalog, as the list shows them', async () => {
        const { ports, calls } = fakePorts({
            authored: async () => [authoredHit('food_mine', 'my butter')],
            catalog: async () => [catalogHit('food_catalog', 'butter')],
        });

        const outcome = await resolveIngredientLikeAUser(ports, 'butter');

        expect(outcome.kind).toBe('authored_suggestion');
        expect(bindingCalls(calls)).toEqual(['addIngredientByFood(food_mine)']);
    });

    it('binds the FIRST catalog food, even when a later one scores higher', async () => {
        // The order is FOOD's. Reordering here would replace the thing being measured with this file's opinion.
        const { ports, calls } = fakePorts({
            catalog: async () => [
                catalogHit('food_first', 'Butter, salted', 0.5),
                catalogHit('food_better', 'Butter', 0.9),
            ],
        });

        const outcome = await resolveIngredientLikeAUser(ports, 'butter');

        expect(outcome.kind).toBe('catalog_suggestion');
        expect(bindingCalls(calls)).toEqual(['addIngredientByFood(food_first)']);
    });

    it('skips a result with no name, as the list does (S5 list contract L4.3)', async () => {
        const { ports, calls } = fakePorts({
            authored: async () => [authoredHit('food_nameless', null)],
            catalog: async () => [catalogHit('food_blank', '  '), catalogHit('food_named', 'butter')],
        });

        const outcome = await resolveIngredientLikeAUser(ports, 'butter');

        expect(outcome.kind).toBe('catalog_suggestion');
        expect(bindingCalls(calls)).toEqual(['addIngredientByFood(food_named)']);
    });

    it('binds the VARIANT a catalog result names, through by-food-variant and not its root', async () => {
        const { ports, calls } = fakePorts({
            catalog: async () => [
                {
                    ...catalogHit('food_brisket', 'beef brisket'),
                    variant: { id: 'variant_flat', parts: [{ attribute: 'cut', text: 'flat' }] },
                },
            ],
        });

        const outcome = await resolveIngredientLikeAUser(ports, 'brisket flat');

        expect(outcome.kind).toBe('catalog_suggestion');
        expect(bindingCalls(calls)).toEqual(['addIngredientByFoodVariant(variant_flat)']);
    });

    it('searches both groups, every time, with the name as the prose gave it', async () => {
        const { ports, calls } = fakePorts();

        await resolveIngredientLikeAUser(ports, 'Sifted Flour');

        expect(
            calls.filter((call) => call.method.startsWith('search')).map((call) => [call.method, call.argument]),
        ).toEqual(
            expect.arrayContaining([
                ['searchAuthored', 'Sifted Flour'],
                ['searchCatalog', 'Sifted Flour'],
            ]),
        );
    });

    it('sends the parsed name UNCHANGED at every step that takes a name', async () => {
        // ⛔ The anti-cheat assertion. Rewriting "sifted flour" to "flour" to find a match would raise the
        // resolution rate while destroying the measurement — the number would describe this file's
        // vocabulary, not the product's.
        const { ports, calls } = fakePorts({
            byName: async () => {
                throw new Error('400 UNKNOWN_INGREDIENT');
            },
        });

        await resolveIngredientLikeAUser(ports, 'Sifted Flour');

        expect(calls.map((call) => call.argument)).toEqual(Array(calls.length).fill('Sifted Flour'));
        expect(calls).toHaveLength(4);
    });

    it('searches only what the list searches — the food port cannot express live search or the legacy search', () => {
        expectTypeOf<keyof FoodSearchPort>().toEqualTypeOf<'searchAuthored' | 'searchCatalog'>();
    });
});

describe('the fallback ladder — a line is never lost', () => {
    it('adds by name when the list offers NOTHING — the app’s own “Not listed?” action', async () => {
        const { ports, calls } = fakePorts();

        const outcome = await resolveIngredientLikeAUser(ports, 'sour grass');

        expect(outcome.kind).toBe('added_by_name');
        expect(bindingCalls(calls)).toEqual(['addIngredientByName(sour grass)']);
    });

    it('falls back to FREEFORM when add-by-name is refused', async () => {
        const { ports, calls } = fakePorts({
            byName: async () => {
                throw new Error('400 UNKNOWN_INGREDIENT');
            },
        });

        const outcome = await resolveIngredientLikeAUser(ports, 'a piece the size of an egg');

        expect(outcome.kind).toBe('freeform');
        expect(outcome.fallbackReason).toBe('400 UNKNOWN_INGREDIENT');
        expect(bindingCalls(calls)).toEqual([
            'addIngredientByName(a piece the size of an egg)',
            'createFreeformIngredient(a piece the size of an egg)',
        ]);
    });
});

/**
 * Each search fails on its own (S5 list contract L3), and a failed search is a DIFFERENT fact from a search that
 * found nothing: a rate measured while the catalog was down describes the outage, not the catalog's coverage.
 */
describe('a failed search is reported apart from a genuine miss', () => {
    it.each([
        ['nothing answered in time', new FetchUnavailableError()],
        ['food answered busy', new SourceBusyError(5)],
        ['the per-minute search limit', new SearchRateLimitedError(30)],
        // L3: `401 IDENTITY_SYNC_PENDING` on the authored half counts as failed, not as "no foods".
        ['a refused token', new UnauthorizedError()],
    ])(
        'reports the catalog unavailable when its search fails with %s, and still offers the cook’s foods',
        async (_case, failure) => {
            const { ports, calls } = fakePorts({
                authored: async () => [authoredHit('food_mine', 'my butter')],
                catalog: async () => {
                    throw failure;
                },
            });

            const outcome = await resolveIngredientLikeAUser(ports, 'butter');

            expect(outcome).toMatchObject({
                kind: 'authored_suggestion',
                catalogAvailability: 'unavailable',
                authoredAvailability: 'ok',
            });
            expect(bindingCalls(calls)).toEqual(['addIngredientByFood(food_mine)']);
        },
    );

    it.each([
        ['nothing answered in time', new FetchUnavailableError()],
        ['a refused token', new UnauthorizedError()],
    ])(
        'reports the cook’s foods unavailable when their search fails with %s, and still offers the catalog',
        async (_case, failure) => {
            const { ports } = fakePorts({
                authored: async () => {
                    throw failure;
                },
                catalog: async () => [catalogHit('food_catalog', 'butter')],
            });

            const outcome = await resolveIngredientLikeAUser(ports, 'butter');

            expect(outcome).toMatchObject({
                kind: 'catalog_suggestion',
                catalogAvailability: 'ok',
                authoredAvailability: 'unavailable',
            });
        },
    );

    it('adds by name when BOTH searches failed, and says both were unavailable', async () => {
        const { ports, calls } = fakePorts({
            authored: async () => {
                throw new FetchUnavailableError();
            },
            catalog: async () => {
                throw new SourceBusyError();
            },
        });

        const outcome = await resolveIngredientLikeAUser(ports, 'butter');

        expect(outcome).toMatchObject({
            kind: 'added_by_name',
            catalogAvailability: 'unavailable',
            authoredAvailability: 'unavailable',
        });
        expect(bindingCalls(calls)).toEqual(['addIngredientByName(butter)']);
    });

    it('reports a search that found nothing as available — a miss is not an outage', async () => {
        const { ports } = fakePorts();

        const outcome = await resolveIngredientLikeAUser(ports, 'butter');

        expect(outcome).toMatchObject({ catalogAvailability: 'ok', authoredAvailability: 'ok' });
    });

    it('rethrows a failure that is not food-service’s, rather than reporting a defect as an outage', async () => {
        const defect = new TypeError('cannot read properties of undefined');
        const { ports } = fakePorts({
            catalog: async () => {
                throw defect;
            },
        });

        await expect(resolveIngredientLikeAUser(ports, 'butter')).rejects.toBe(defect);
    });
});

/**
 * Ranking-quality observation (owner ruling 2026-08-31, U15 report "Owner rulings" §2): the report records what
 * LED the list and whether that leader's only claim was a shared non-head token — the first-mover capture shape
 * U15 measured (`salt` led by "Lentils, …, without salt"). After S5 the group that can capture is the cook's own
 * foods, which lead whenever they match (S5 list contract L1, "What groups cost"). Observation only: the pick
 * still goes to the first food, or the measurement stops describing the product.
 */
describe('the lead observation — ranking quality, recorded but never acted on', () => {
    it('flags a WEAK token-only lead from the cook’s own foods', async () => {
        const { ports } = fakePorts({
            authored: async () => [authoredHit('food_lentils', 'Lentils, mature seeds, cooked, boiled, without salt')],
        });

        const outcome = await resolveIngredientLikeAUser(ports, 'salt');

        expect(outcome.kind).toBe('authored_suggestion');
        expect(outcome.lead).toEqual({ group: 'authored', weakTokenLead: true });
    });

    it('does NOT flag an own-food lead whose head the query names', async () => {
        const { ports } = fakePorts({ authored: async () => [authoredHit('food_onion', 'Onions, raw')] });

        const outcome = await resolveIngredientLikeAUser(ports, 'onion');

        expect(outcome.lead).toEqual({ group: 'authored', weakTokenLead: false });
    });

    it('records a catalog lead as catalog, never weak', async () => {
        const { ports } = fakePorts({ catalog: async () => [catalogHit('food_lentils', 'Lentils, without salt')] });

        const outcome = await resolveIngredientLikeAUser(ports, 'salt');

        expect(outcome.lead).toEqual({ group: 'catalog', weakTokenLead: false });
    });

    it('records NO lead for add-by-name and freeform — nothing led an empty list', async () => {
        const { ports } = fakePorts();

        const outcome = await resolveIngredientLikeAUser(ports, 'sour grass');

        expect(outcome.lead).toBeUndefined();
    });
});
