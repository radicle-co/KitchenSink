/**
 * Component tests for IngredientPicker (T067 web ingredient typeahead). Covers every state the picker
 * renders: idle (no query → no results region), searching (loading), populated results → select resolves a
 * line, empty results, search error, freeform create → resolves a line, the terminal NOT_FOUND status
 * (surfaced + freeform fallback offered, per FR-007), the addByName async-resolution entry point (R5), and
 * the full UNRESOLVED disambiguation matrix. Queries use role/label/text only.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the picker through the REAL `useIngredientResolver`
 * (`@commise/features-recipes/hooks`), the real query/mutation hooks it composes, and a real,
 * network-guarded `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with
 * type-checked `vi.spyOn(client, '<method>')`. `useIngredientResolver` mounts all five hooks unconditionally
 * (gated only by TanStack's own `enabled`), so the full idle → searching → results / terminal →
 * disambiguating → resolving matrix drives cleanly through a live `QueryClient` with `findBy*`/`waitFor` —
 * no forced hook-state shortcuts were needed here. Since REQ-057 (CP-9), the search itself is debounced
 * ~300ms behind the trimmed query and gated on a 2-character trigger — every test below types a query long
 * enough that Playwright/RTL's default `findBy*` timeout comfortably covers the debounce window; the
 * dedicated `IngredientPicker — REQ-057 typeahead trigger/debounce/ranking` block below uses fake timers to
 * pin the debounce/threshold/ranking behavior precisely.
 */
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type {
    IngredientCatalogAvailability,
    IngredientSuggestion,
    IngredientSuggestions,
    RecipeServiceClient,
} from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '@commise/features-recipes/hooks';
import { renderWithRecipeClient, ringContrast, utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

/** Wrap the caller's own catalog rows as `local` blended suggestions (search Stage 2). */
function own(ingredients: readonly Ingredient[]): IngredientSuggestion[] {
    return ingredients.map((ingredient) => ({ provenance: 'local', ingredient }));
}

/** A food-catalog (not-yet-admitted) blended suggestion. */
function fromCatalog(foodId: string, name: string, score = 0.9): IngredientSuggestion {
    return { provenance: 'catalog', foodId, name, score };
}

/** The `GET /api/v1/ingredients/suggest` envelope the picker consumes. */
function blended(
    suggestions: readonly IngredientSuggestion[],
    catalogAvailability: IngredientCatalogAvailability = 'ok',
): IngredientSuggestions {
    return { suggestions, catalogAvailability };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('IngredientPicker', () => {
    it('shows no results region until the search box has a query', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    // C5: wireframe recipe-edit.md:56 shows a "[USDA database]" badge next to the ingredient search box.
    it('renders a "USDA database" badge next to the search box', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        expect(screen.getByText('USDA database')).toBeInTheDocument();
    });

    it('renders a loading indicator while the search is in flight', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        expect(await screen.findByRole('status', { name: 'Searching ingredients' })).toBeInTheDocument();
    });

    it('selects a catalog match, resolving the line to its ingredientId + name', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended(
                own([
                    makeIngredient({
                        id: 'ing_9',
                        name: 'Olive oil',
                        foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                    }),
                ]),
            ),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');
        await user.click(await screen.findByRole('button', { name: 'Olive oil' }));

        expect(onSelect).toHaveBeenCalledWith({
            ingredientId: 'ing_9',
            name: 'Olive oil',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.RESOLVED,
        });
    });

    it('shows an empty state and a freeform option when nothing matches', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');

        expect(await screen.findByText('No matching ingredients found.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
    });

    it('surfaces a search error', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockRejectedValue(new Error('network down'));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'oli');

        expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t search ingredients.');
    });

    it('creates a freeform ingredient and resolves the line to the new id + status', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const created = makeIngredient({
            id: 'ing_new',
            name: 'Heirloom tomato',
            isUserEntered: true,
            foodResolutionStatus: FoodResolutionStatus.PENDING,
        });
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));
        vi.spyOn(client, 'createIngredient').mockResolvedValue(created);

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Heirloom tomato');
        await user.click(await screen.findByRole('button', { name: 'Add “Heirloom tomato” as a custom ingredient' }));

        expect(onSelect).toHaveBeenCalledWith({
            ingredientId: 'ing_new',
            name: 'Heirloom tomato',
            quantity: 1,
            resolutionStatus: FoodResolutionStatus.PENDING,
        });
    });

    it('surfaces a terminal NOT_FOUND match and still offers the freeform fallback (FR-007)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended(
                own([
                    makeIngredient({
                        id: 'ing_x',
                        name: 'Mystery spice',
                        foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
                    }),
                ]),
            ),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'mystery');

        expect(await screen.findByText('No match found')).toBeInTheDocument();
        expect(screen.getByRole('note')).toHaveTextContent(/custom ingredient or remove it/i);
        expect(screen.getByRole('button', { name: 'Add “mystery” as a custom ingredient' })).toBeInTheDocument();
    });

    describe('addByName — the async-resolution entry point (R5)', () => {
        it('offers "Find nutrition for …" (addByName) as the PRIMARY action for a typed name', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');

            // Both the primary (find nutrition) and the fallback (custom ingredient) are available.
            expect(await screen.findByRole('button', { name: 'Find nutrition for “zzz”' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
        });

        it('addByName adds a PENDING line the container will poll — via addByName, NOT createFreeform', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));
            const addByNameSpy = vi.spyOn(client, 'addIngredientByName').mockResolvedValue(
                makeIngredient({
                    id: 'ing_food',
                    name: 'Quinoa',
                    foodResolutionStatus: FoodResolutionStatus.PENDING,
                }),
            );
            const createSpy = vi.spyOn(client, 'createIngredient');

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Quinoa');
            await user.click(await screen.findByRole('button', { name: 'Find nutrition for “Quinoa”' }));

            // The line is added PENDING (the container polls it to RESOLVED).
            await vi.waitFor(() =>
                expect(onSelect).toHaveBeenCalledWith({
                    ingredientId: 'ing_food',
                    name: 'Quinoa',
                    quantity: 1,
                    resolutionStatus: FoodResolutionStatus.PENDING,
                }),
            );
            // Mutation guard: the primary add path MUST call addByName (the food-resolving route) with the
            // typed name — a regression that routed it to createFreeform (the plain freeform create) fails
            // BOTH lines.
            expect(addByNameSpy).toHaveBeenCalledWith('Quinoa');
            expect(createSpy).not.toHaveBeenCalled();
        });

        it('addByName that comes back UNRESOLVED opens disambiguation instead of adding a line', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));
            vi.spyOn(client, 'addIngredientByName').mockResolvedValue(
                makeIngredient({ id: 'ing_u', name: 'Pepper', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED }),
            );
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([
                { candidateId: 'cand-a', source: 'usda', externalKey: 'k1', name: 'Black pepper', summary: null },
            ]);

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'Pepper');
            await user.click(await screen.findByRole('button', { name: 'Find nutrition for “Pepper”' }));

            // No line yet — the UNRESOLVED add routes into disambiguation (keyed on the new food-backed id).
            expect(await screen.findByRole('group', { name: 'Which “Pepper” did you mean?' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Black pepper/ })).toBeInTheDocument();
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('surfaces an addByName failure and keeps the freeform fallback available', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));
            vi.spyOn(client, 'addIngredientByName').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'zzz');
            await user.click(await screen.findByRole('button', { name: 'Find nutrition for “zzz”' }));

            expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t add that ingredient/i);
            expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
        });
    });

    describe('UNRESOLVED disambiguation (R5)', () => {
        const CANDIDATE = {
            candidateId: 'cand-a',
            source: 'usda',
            externalKey: 'k1',
            name: 'Quinoa, cooked',
            summary: 'Boiled',
        };

        /** Stubs the client's search to return a single UNRESOLVED match named "Quinoa". */
        function searchWithUnresolved(client: RecipeServiceClient): void {
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
                blended(
                    own([
                        makeIngredient({
                            id: 'ing_u',
                            name: 'Quinoa',
                            foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                        }),
                    ]),
                ),
            );
        }

        it('opens the disambiguation panel (candidates), and does NOT resolve the line yet', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([CANDIDATE]);

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

            // The line is NOT added on the UNRESOLVED click — disambiguation is required first.
            expect(screen.getByRole('group', { name: 'Which “Quinoa” did you mean?' })).toBeInTheDocument();
            expect(await screen.findByRole('button', { name: /Quinoa, cooked/ })).toBeInTheDocument();
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('resolves the line from the picked candidate — sending the RIGHT candidate id', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([
                CANDIDATE,
                { ...CANDIDATE, candidateId: 'cand-b', name: 'Quinoa, raw' },
            ]);
            const resolved = makeIngredient({
                id: 'ing_u',
                name: 'Quinoa',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            const resolveSpy = vi.spyOn(client, 'resolveIngredient').mockResolvedValue(resolved);

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));
            await user.click(await screen.findByRole('button', { name: /Quinoa, cooked/ }));

            await vi.waitFor(() =>
                expect(onSelect).toHaveBeenCalledWith({
                    ingredientId: 'ing_u',
                    name: 'Quinoa',
                    quantity: 1,
                    resolutionStatus: FoodResolutionStatus.RESOLVED,
                }),
            );
            // Mutation guard: the picked candidate's id must be the one sent — picking "cooked" (cand-a),
            // not "raw" (cand-b). A wrong/swapped id fails here.
            expect(resolveSpy).toHaveBeenCalledWith('ing_u', ['cand-a']);
        });

        it('shows a loading indicator while candidates load', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockReturnValue(new Promise(() => {}));

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

            expect(await screen.findByRole('status', { name: 'Loading options' })).toBeInTheDocument();
        });

        it('surfaces a candidates-load error', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

            expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load options for that ingredient.');
        });

        it('offers the freeform fallback when there are no candidates to choose from', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([]);

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

            expect(await screen.findByText(/No options to choose from/)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Add “Quinoa” as a custom ingredient' })).toBeInTheDocument();
        });

        it('surfaces a resolve failure without adding a line', async () => {
            const user = userEvent.setup();
            const onSelect = vi.fn();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([CANDIDATE]);
            vi.spyOn(client, 'resolveIngredient').mockRejectedValue(new Error('network down'));

            renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));
            await user.click(await screen.findByRole('button', { name: /Quinoa, cooked/ }));

            expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t resolve that ingredient.');
            expect(onSelect).not.toHaveBeenCalled();
        });

        it('returns to search from the disambiguation panel', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            searchWithUnresolved(client);
            vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([CANDIDATE]);

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'quin');
            await user.click(await screen.findByRole('button', { name: 'Quinoa' }));
            expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

            await user.click(await screen.findByRole('button', { name: 'Back to search' }));
            expect(screen.getByRole('searchbox', { name: 'Search ingredients' })).toBeInTheDocument();
        });
    });
});

describe('IngredientPicker — REQ-057 typeahead trigger, debounce, and ranking', () => {
    // Fake timers scoped to this block only (real timers elsewhere so `userEvent`'s own async plumbing
    // stays untouched) — asserts directly on the CLIENT boundary (`client.searchIngredients`), the actual
    // network call the debounce/threshold gate is protecting.
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('never calls the search endpoint below the FR-010a minimum', async () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search ingredients' }), {
            target: { value: 's' },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });

        expect(searchSpy).not.toHaveBeenCalled();
    });

    // Cross-platform parity guard for the native leaf's REQ-057 fix. Web has always been correct here (the
    // action row renders only inside the non-idle view-state kinds), but the mobile leaf gated the same row
    // on `trimmed.length > 0` and so offered both affordances at ONE character. Pinning the affordance-level
    // contract — not just the absent network call — keeps the two leaves from drifting on it again.
    //
    // ⚠️ plan U37 makes this case load-bearing a SECOND time: `tooShort` is a new non-idle view-state kind,
    // so a leaf that gates its action row on `kind !== 'idle'` would start offering "Find nutrition for “s”"
    // at one character again — the exact regression this case was written for, re-opened by the fix for a
    // different requirement.
    it('offers neither query-keyed affordance below the FR-010a minimum', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search ingredients' }), {
            target: { value: 's' },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });

        expect(screen.queryByRole('button', { name: 'Find nutrition for “s”' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create “s”' })).toBeNull();
    });

    // Regression (final-review Finding 1): the debounce split the live gating query from the query that
    // enables the search fetch. The instant the input crosses the 2-char threshold, the debounced value
    // hasn't caught up, so the search is still `enabled: false` — that window must render the "Searching
    // ingredients" status, never the "no matching ingredients" / create-freeform affordance (which would
    // invite a premature freeform-add click before the real search has even fired).
    it('shows the searching status — not the empty/create-freeform flash — the instant the query crosses the threshold, before the debounce settles', async () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        // ⚠️ The needle moved from 'zz' to 'zzz' with plan U37: at two characters the query is now below
        // the FR-010a minimum and can never reach `searching`, so the old needle asserted a spinner for a
        // search that no longer fires. The debounce-flash invariant is unchanged.
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search ingredients' }), { target: { value: 'zzz' } });
        // Flush React's state update WITHOUT advancing the debounce timer.
        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByRole('status', { name: 'Searching ingredients' })).toBeInTheDocument();
        expect(screen.queryByText('No matching ingredients found.')).not.toBeInTheDocument();
        expect(searchSpy).not.toHaveBeenCalled();

        // Once the debounce settles with a genuinely empty result, the real empty state DOES show — the
        // fix must not mask that, only the transient pending-debounce window above.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });
        // The debounce timer firing only starts the fetch; let its resolved promise's microtasks (the
        // mocked client call + TanStack's own success-handling) flush through before the render settles.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(screen.getByText('No matching ingredients found.')).toBeInTheDocument();
    });

    /**
     * The FR-010a empty state, on WEB (003-FR-010a, plan U37).
     *
     * ⛔ Asserted as visible TEXT, not as "no results region". Before this unit a one- or two-character
     * query rendered nothing at all and the picker looked broken; the requirement is that the cook is TOLD
     * why and invited to keep going, so a test that only checks for absence would pass on the behaviour it
     * exists to reject.
     */
    it('explains the three-character minimum instead of rendering nothing', async () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search ingredients' }), { target: { value: 'eg' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });

        expect(
            screen.getByText('Keep typing — 3 characters or more. Anything shorter matches half the pantry.'),
        ).toBeInTheDocument();
        // ⛔ NOT the no-matches copy: that asserts the catalog was searched and came back empty, which is
        // precisely what did not happen.
        expect(screen.queryByText('No matching ingredients found.')).not.toBeInTheDocument();
        expect(searchSpy).not.toHaveBeenCalled();
    });

    it('says nothing at all while the search box is untouched', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });

        expect(screen.queryByText(/characters or more/)).not.toBeInTheDocument();
    });

    it('searches `egg` — the three-character foods are not casualties of the minimum', async () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search ingredients' }), { target: { value: 'egg' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(searchSpy).toHaveBeenCalledWith('egg', undefined);
        expect(screen.queryByText(/characters or more/)).not.toBeInTheDocument();
    });

    it('debounces rapid keystrokes into exactly ONE search call, on the settled (final) query', async () => {
        const client = createFakeRecipeServiceClient();
        const searchSpy = vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));
        const input = () => screen.getByRole('searchbox', { name: 'Search ingredients' });

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        // Fast typing: each keystroke arrives well inside the 300ms debounce window, so only the LAST one
        // should ever reach the client.
        for (const value of ['s', 'sp', 'spi', 'spin']) {
            fireEvent.change(input(), { target: { value } });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(100);
            });
        }

        expect(searchSpy).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });

        expect(searchSpy).toHaveBeenCalledTimes(1);
        expect(searchSpy).toHaveBeenCalledWith('spin', undefined);
    });

    // Real timers (no `vi.useFakeTimers()`) for this one — it asserts the RENDERED order, not the debounce
    // timing itself (already pinned above), and mixing fake timers with TanStack Query's own internal
    // (micro)task scheduling for a full fetch→render round trip is exactly the kind of brittle interaction
    // the rest of this file avoids by using real timers + `findBy*`.
    //
    // ⚠️ REWRITTEN for plan U5 — the SAME case, asserting the opposite. It used to assert the picker
    // re-ranked the server's page `prefix > substring > fuzzy`. That client-side mechanism is retired (owner
    // ruling 2026-08-20: the server determines order, on best-quality match), so this asserts the property
    // that replaced it — the picker is a faithful renderer of the server's order. Where the retired coverage
    // went is recorded in `@commise/features-recipes`'s
    // `src/hooks/__tests__/ingredientResolver.model.test.ts`; the ordering itself is now proven against a
    // real database by each service's ranking integration suite.
    it("renders the server's order UNMODIFIED — the picker no longer re-ranks (U5)", async () => {
        vi.useRealTimers(); // override this block's fake timers — see comment above
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        // Deliberately the exact order the retired client sort would have INVERTED: the fuzzy match first
        // and the prefix match third. If any re-ranking creeps back in, this fails.
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended(
                own([
                    makeIngredient({ id: 'ing_fuzzy', name: 'Aplpe' }),
                    makeIngredient({ id: 'ing_sub_z', name: 'Zucchini apple' }),
                    makeIngredient({ id: 'ing_pre', name: 'Apple pie spice' }),
                    makeIngredient({ id: 'ing_sub_b', name: 'Banana apple' }),
                ]),
            ),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), 'apple');

        const list = await screen.findByRole('list');
        await vi.waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4));
        // ⚠️ THE FIRST button of each row, not every button in the list. Since U14 a food-backed row also
        // carries a correction control ("Always use this for …"), so a flat `getAllByRole('button')` returns
        // two per row. Narrowing to the row's PICK button keeps this assertion about what it has always been
        // about — the RANKING ORDER — rather than about how many controls a row happens to have.
        const names = within(list)
            .getAllByRole('listitem')
            .map((row) => within(row).getAllByRole('button')[0]?.textContent);

        expect(names).toEqual(['Aplpe', 'Zucchini apple', 'Apple pie spice', 'Banana apple']);
    });
});

/**
 * Search Stage 2 — the BLENDED, sectioned typeahead. Covers every state the two-section list adds: both
 * sections populated, catalog-only, local-only, the degraded-catalog notice (F2), the catalog pick's admit
 * round-trip (F1's client half), and its pending/error branches.
 */
describe('IngredientPicker — search Stage 2 (blended food-catalog suggestions)', () => {
    /** Type a query and wait for the blended list to settle. */
    async function search(user: ReturnType<typeof userEvent.setup>, query = 'chick'): Promise<void> {
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), query);
    }

    it('renders the caller’s own ingredients and the food catalog as TWO labeled sections', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([
                ...own([makeIngredient({ id: 'ing_1', name: 'My chicken' })]),
                fromCatalog('01J0FOOD', 'Chicken breast, raw'),
            ]),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await search(user);

        const ownSection = await screen.findByRole('region', { name: 'Your ingredients' });
        const catalogSection = await screen.findByRole('region', { name: 'Food catalog' });
        expect(within(ownSection).getByRole('button', { name: 'My chicken' })).toBeInTheDocument();
        expect(within(catalogSection).getByRole('button', { name: 'Chicken breast, raw' })).toBeInTheDocument();
        // Provenance is legible, not implied: the catalog row is badged.
        expect(within(catalogSection).getByText('USDA')).toBeInTheDocument();
    });

    it('renders the local section FIRST in the DOM, never interleaved with the catalog section', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([
                ...own([makeIngredient({ id: 'ing_1', name: 'Zzz mine' })]),
                // Alphabetically and by score this catalog hit would sort first under any global ordering.
                fromCatalog('01J0FOOD', 'Aaa catalog', 0.99),
            ]),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await search(user);

        const ownSection = await screen.findByRole('region', { name: 'Your ingredients' });
        const catalogSection = await screen.findByRole('region', { name: 'Food catalog' });
        expect(ownSection.compareDocumentPosition(catalogSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders ONLY the catalog section when the caller has no matching ingredients of their own', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([fromCatalog('01J0FOOD', 'Chicken breast, raw')]),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await search(user);

        expect(await screen.findByRole('region', { name: 'Food catalog' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Your ingredients' })).not.toBeInTheDocument();
        // A lone catalog hit is NOT a dead end — no terminal notice must appear for a golden record.
        expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });

    it('renders ONLY the local section when the food catalog returns nothing', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended(own([makeIngredient({ id: 'ing_1', name: 'My chicken' })])),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await search(user);

        expect(await screen.findByRole('region', { name: 'Your ingredients' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Food catalog' })).not.toBeInTheDocument();
    });

    it('picking a catalog row ADMITS it by food id and resolves the line from the admitted row', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([fromCatalog('01J0FOOD', 'Chicken breast, raw')]),
        );
        const admit = vi.spyOn(client, 'addIngredientByFood').mockResolvedValue(
            makeIngredient({
                id: 'ing_admitted',
                name: 'Chicken breast, raw',
                foodId: '01J0FOOD',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                caloriesPer100g: 165,
            }),
        );
        const addByName = vi.spyOn(client, 'addIngredientByName');

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
        await search(user);
        await user.click(await screen.findByRole('button', { name: 'Chicken breast, raw' }));

        // The opaque food id is what the admit is keyed on…
        await vi.waitFor(() => expect(admit).toHaveBeenCalledWith('01J0FOOD'));
        // …and the line carries the ADMITTED row's ingredient id + its backfilled nutrition (F1), not a
        // fabricated id derived from the suggestion.
        await vi.waitFor(() =>
            expect(onSelect).toHaveBeenCalledWith(
                expect.objectContaining({ ingredientId: 'ing_admitted', caloriesPer100g: 165 }),
            ),
        );
        // Mutation guard: the pick must NOT fall back to the by-name async fan-out.
        expect(addByName).not.toHaveBeenCalled();
    });

    it('shows a busy indicator and disables the catalog row while the admit is in flight', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([fromCatalog('01J0FOOD', 'Chicken breast, raw')]),
        );
        vi.spyOn(client, 'addIngredientByFood').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await search(user);
        await user.click(await screen.findByRole('button', { name: 'Chicken breast, raw' }));

        expect(await screen.findByRole('status', { name: 'Adding from the food catalog' })).toBeInTheDocument();
        await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Chicken breast, raw' })).toBeDisabled());
    });

    it('surfaces a failed admit as an error and keeps the freeform fallback reachable (FR-007)', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([fromCatalog('01J0FOOD', 'Chicken breast, raw')]),
        );
        vi.spyOn(client, 'addIngredientByFood').mockRejectedValue(new Error('food gone'));
        vi.spyOn(client, 'createIngredient').mockResolvedValue(
            makeIngredient({ id: 'ing_free', name: 'chick', isUserEntered: true }),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
        await search(user);
        await user.click(await screen.findByRole('button', { name: 'Chicken breast, raw' }));

        expect(
            await screen.findByText('We couldn’t add that food. Try again, or add it as a custom ingredient.'),
        ).toBeInTheDocument();
        expect(onSelect).not.toHaveBeenCalled();

        // The dead-end escape is still there.
        await user.click(screen.getByRole('button', { name: 'Add “chick” as a custom ingredient' }));
        await vi.waitFor(() =>
            expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing_free' })),
        );
    });

    it('picking a LOCAL row resolves immediately, with no admit round-trip', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([
                ...own([
                    makeIngredient({
                        id: 'ing_1',
                        name: 'My chicken',
                        foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                    }),
                ]),
                fromCatalog('01J0FOOD', 'Chicken breast, raw'),
            ]),
        );
        const admit = vi.spyOn(client, 'addIngredientByFood');

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
        await search(user);
        await user.click(await screen.findByRole('button', { name: 'My chicken' }));

        await vi.waitFor(() =>
            expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ ingredientId: 'ing_1' })),
        );
        expect(admit).not.toHaveBeenCalled();
    });

    describe('F2 — a degraded food catalog never blocks the local section', () => {
        it('renders the local results plus a non-blocking notice when the catalog is unavailable', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
                blended(own([makeIngredient({ id: 'ing_1', name: 'My chicken' })]), 'unavailable'),
            );

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await search(user);

            expect(await screen.findByRole('button', { name: 'My chicken' })).toBeInTheDocument();
            const notice = await screen.findByText(
                'Showing your ingredients only — the food catalog is unavailable right now.',
            );
            expect(notice).toBeInTheDocument();
            // A `status`, NOT an `alert`: from the user's side nothing failed and the list is fully usable.
            expect(notice).toHaveAttribute('role', 'status');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('does NOT show the notice when the catalog answered normally', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
                blended(own([makeIngredient({ id: 'ing_1', name: 'My chicken' })])),
            );

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await search(user);

            await screen.findByRole('button', { name: 'My chicken' });
            expect(
                screen.queryByText('Showing your ingredients only — the food catalog is unavailable right now.'),
            ).not.toBeInTheDocument();
        });

        it('does NOT show the notice when the blend was deliberately DISABLED (not an incident)', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
                blended(own([makeIngredient({ id: 'ing_1', name: 'My chicken' })]), 'disabled'),
            );

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await search(user);

            await screen.findByRole('button', { name: 'My chicken' });
            expect(
                screen.queryByText('Showing your ingredients only — the food catalog is unavailable right now.'),
            ).not.toBeInTheDocument();
        });

        it('shows the empty state (not the notice alone) when the catalog degrades AND there are no local hits', async () => {
            const user = userEvent.setup();
            const client = createFakeRecipeServiceClient();
            vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([], 'unavailable'));

            renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
            await search(user, 'zzz');

            expect(await screen.findByText('No matching ingredients found.')).toBeInTheDocument();
            expect(
                screen.getByText('Showing your ingredients only — the food catalog is unavailable right now.'),
            ).toBeInTheDocument();
            // And the two escapes are still offered.
            expect(screen.getByRole('button', { name: 'Find nutrition for “zzz”' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Add “zzz” as a custom ingredient' })).toBeInTheDocument();
        });
    });
});

/**
 * EVERY progress affordance this picker renders is a live region, and a live region that renders an EMPTY node
 * is doubly broken: it is a zero-height element (invisible to a sighted viewer, and Playwright resolves it as
 * `hidden`) AND it is silent — `aria-live` announces content CHANGES, so a region with no content has nothing
 * to announce. The fix (already made once in `RecipePhotoManager`, and the doctrine the mobile `LoadingState`
 * established) is that the contextual, localized label doubles as the region's VISIBLE caption.
 *
 * These tests assert BOTH halves per region: it has the accessible name, AND its text content is non-empty and
 * equal to that name. An `aria-label`-only region passes the first and fails the second.
 */
describe('IngredientPicker — every live region carries its label as VISIBLE content', () => {
    /** The trimmed query every test below types — long enough to cross the REQ-057 2-character trigger. */
    const QUERY = 'chick';

    /** Type the query and hand back the search box for further interaction. */
    async function typeQuery(user: ReturnType<typeof userEvent.setup>): Promise<void> {
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), QUERY);
    }

    /** Assert the named live region exists AND renders that name as text. */
    function expectSpokenStatus(status: HTMLElement, name: string): void {
        expect(status).toBeInTheDocument();
        expect(status.textContent).toBe(name);
    }

    it('the SEARCHING region announces and shows "Searching ingredients"', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user);

        expectSpokenStatus(
            await screen.findByRole('status', { name: 'Searching ingredients' }),
            'Searching ingredients',
        );
    });

    it('the FIND-NUTRITION (addByName) region announces and shows "Finding nutrition"', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));
        vi.spyOn(client, 'addIngredientByName').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user);
        await user.click(await screen.findByRole('button', { name: `Find nutrition for “${QUERY}”` }));

        expectSpokenStatus(await screen.findByRole('status', { name: 'Finding nutrition' }), 'Finding nutrition');
    });

    it('the FREEFORM-CREATE region announces and shows "Adding ingredient"', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));
        vi.spyOn(client, 'createIngredient').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user);
        await user.click(await screen.findByRole('button', { name: `Add “${QUERY}” as a custom ingredient` }));

        expectSpokenStatus(await screen.findByRole('status', { name: 'Adding ingredient' }), 'Adding ingredient');
    });

    it('the CATALOG-ADMIT region announces and shows "Adding from the food catalog"', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([fromCatalog('01J0FOOD', 'Chicken breast, raw')]),
        );
        vi.spyOn(client, 'addIngredientByFood').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user);
        await user.click(await screen.findByRole('button', { name: 'Chicken breast, raw' }));

        expectSpokenStatus(
            await screen.findByRole('status', { name: 'Adding from the food catalog' }),
            'Adding from the food catalog',
        );
    });

    it('the DISAMBIGUATION-LOADING region announces and shows "Loading options"', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended(
                own([
                    makeIngredient({
                        id: 'ing_u',
                        name: 'Chicken thigh',
                        foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                    }),
                ]),
            ),
        );
        vi.spyOn(client, 'getIngredientCandidates').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user);
        await user.click(await screen.findByRole('button', { name: 'Chicken thigh' }));

        expectSpokenStatus(await screen.findByRole('status', { name: 'Loading options' }), 'Loading options');
    });

    it('the RESOLVING region announces and shows "Resolving ingredient"', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended(
                own([
                    makeIngredient({
                        id: 'ing_u',
                        name: 'Chicken thigh',
                        foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                    }),
                ]),
            ),
        );
        vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([
            {
                candidateId: 'cand-a',
                source: 'usda',
                externalKey: 'k1',
                name: 'Chicken thigh, cooked',
                summary: 'Roasted',
            },
        ]);
        vi.spyOn(client, 'resolveIngredient').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user);
        await user.click(await screen.findByRole('button', { name: 'Chicken thigh' }));
        await user.click(await screen.findByRole('button', { name: /Chicken thigh, cooked/ }));

        expectSpokenStatus(await screen.findByRole('status', { name: 'Resolving ingredient' }), 'Resolving ingredient');
    });
});

/**
 * WCAG 2.1 AA text contrast (SC 1.4.3) for the picker's seafoam-tinted controls. Four separate class strings
 * in this component paint text on a seafoam tint, and each is asserted on its own so a fix that reaches one
 * literal and misses another still fails. Hover is measured wherever the control deepens its tint: a chip that
 * clears the floor at rest and drops under it on hover is still inaccessible (seafoam over `/10` is 3.57:1 and
 * over `/20` is 3.18:1). The badges' pills, tints and the focus ring stay seafoam — non-text accents clear the
 * 3:1 SC 1.4.11 floor. See the palette JSDoc in `@commise/ui` for the one authoritative statement of the rule.
 */
describe('IngredientPicker — seafoam-tinted controls stay WCAG-AA legible', () => {
    /** Type a query long enough to clear the REQ-057 trigger and settle the debounced search. */
    async function search(user: ReturnType<typeof userEvent.setup>, query = 'chick'): Promise<void> {
        await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), query);
    }

    it('keeps the "USDA database" badge beside the search box legible over its own tint', () => {
        const client = createFakeRecipeServiceClient();

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        expect(
            utilityContrast(screen.getByText('USDA database').className),
            'USDA-database badge beside the search box',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the food-catalog provenance badge on a catalog row legible over its own tint', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended([fromCatalog('01J0FOOD', 'Chicken breast, raw')]),
        );

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await search(user);

        const catalogSection = await screen.findByRole('region', { name: 'Food catalog' });

        expect(
            utilityContrast(within(catalogSection).getByText('USDA').className),
            'catalog-provenance badge',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the freeform fallback action legible AT REST AND ON HOVER (results branch)', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await search(user, 'zzz');

        const freeform = await screen.findByRole('button', { name: 'Add “zzz” as a custom ingredient' });

        expect(utilityContrast(freeform.className), 'freeform fallback at rest').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(freeform.className, { variant: 'hover' }),
            'freeform fallback on hover (the tint deepens to /20)',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the DISAMBIGUATION panel’s freeform fallback legible AT REST AND ON HOVER', async () => {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(
            blended(
                own([
                    makeIngredient({
                        id: 'ing_u',
                        name: 'Quinoa',
                        foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
                    }),
                ]),
            ),
        );
        vi.spyOn(client, 'getIngredientCandidates').mockResolvedValue([]);

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await search(user, 'quin');
        await user.click(await screen.findByRole('button', { name: 'Quinoa' }));

        // A SECOND literal class string, in the disambiguation panel — measured separately from the results
        // branch's copy above, so fixing only one of them cannot pass.
        const freeform = await screen.findByRole('button', { name: 'Add “Quinoa” as a custom ingredient' });

        expect(utilityContrast(freeform.className), 'disambiguation freeform at rest').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(freeform.className, { variant: 'hover' }),
            'disambiguation freeform on hover (the tint deepens to /20)',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the search field’s PLACEHOLDER legible', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([]));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);

        // Placeholder text is text: it is the only thing telling a reader what the field wants before they
        // type. `mist` scored 1.90:1 here — below even the 3:1 floor a meaningful GRAPHIC owes. Measured
        // through the `placeholder:` variant so the assertion reads the utility the browser actually applies
        // to the placeholder, not the input's own `text-charcoal`.
        const search = await screen.findByRole('searchbox', { name: 'Search ingredients' });

        expect(
            utilityContrast(search.className, { variant: 'placeholder' }),
            'ingredient search placeholder',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * The search field's FOCUS RING is the whole of its keyboard affordance — the field carries `outline-none`, so
 * the browser's own indicator is suppressed — and it shipped as `ring-seafoam-light`, which measures 2.58:1 on
 * the page the wizard step sits on: under the 3:1 SC 1.4.11 floor a non-text UI component boundary owes (#114).
 *
 * It is measured against the SURFACE the ring is drawn on, never the field's own `bg-white`: a Tailwind `ring-*`
 * is a spread box-shadow OUTSIDE the border box, so the fill is not what a reader sees the ring against. That
 * distinction is what `ringContrast` exists to encode (`utilityContrast(..., { foreground: 'border' })` would
 * score the ring against the fill and pass a ring nobody can see).
 */
describe('IngredientPicker — the search field’s focus ring clears the 3:1 SC 1.4.11 floor', () => {
    /** WCAG 2.1 AA, SC 1.4.11 — a focus indicator is a non-text UI component boundary, not text. */
    const AA_UI_COMPONENT = 3;

    /** The wizard step the picker mounts in paints no surface of its own, so it sits on the app background. */
    const PAGE = semantic.background;

    function renderPicker(): void {
        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, createFakeRecipeServiceClient());
    }

    it('rings the search box legibly against the page it sits on', () => {
        renderPicker();

        const search = screen.getByRole('searchbox', { name: 'Search ingredients' });

        expect(search.className, 'the browser outline is suppressed, so the ring is the whole indicator') //
            .toContain('outline-none');
        expect(ringContrast(search.className, { surface: PAGE }), 'ingredient search focus ring') //
            .toBeGreaterThanOrEqual(AA_UI_COMPONENT);
    });

    it('also clears the floor on a white card, for a caller that nests the picker in one', () => {
        renderPicker();

        expect(
            ringContrast(screen.getByRole('searchbox', { name: 'Search ingredients' }).className, {
                surface: semantic.card,
            }),
            'ingredient search focus ring on a card',
        ).toBeGreaterThanOrEqual(AA_UI_COMPONENT);
    });

    it('out-measures the `seafoam-light` it replaced, so a re-theme cannot quietly restore the defect', () => {
        renderPicker();

        expect(
            ringContrast(screen.getByRole('searchbox', { name: 'Search ingredients' }).className, { surface: PAGE }),
        ).toBeGreaterThan(ringContrast('ring-2 ring-seafoam-light', { surface: PAGE }));
    });
});
