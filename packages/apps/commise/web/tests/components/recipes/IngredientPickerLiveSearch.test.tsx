/**
 * Component tests for the ingredient picker's ON-DEMAND live source search (plan U29) — the "Search USDA
 * for '…'" affordance and every state of the panel it opens: gated, pressable, searching, results, empty,
 * busy, failed, and dismissed.
 *
 * ⛔ **The case this file exists for is the first one: typing must never cause a source call.** The upstream
 * source allows 1,000 requests/hour PER IP, shared by every cook, and 003's FR-019 reserves only the top 10%
 * for user-facing work — so at 50 concurrent cooks a per-settled-query autocomplete would want roughly three
 * times the entire key. The affordance has to read as a deliberate, occasional action, and "it does not fire
 * on a keystroke" is a claim until something types a full word and asserts the wire stayed quiet.
 *
 * ⛔ **The three settled failure-ish states must stay three.** "USDA has nothing for X" tells a cook to stop
 * looking; "rate-limited, try again" and "USDA didn't answer" tell them to try again. Rendering any pair
 * with one sentence puts them in a loop that cannot end — so each is asserted by its own copy, and the
 * empty case explicitly asserts the two failure sentences are ABSENT.
 *
 * Driven through the type-checked fake-client seam (`renderWithRecipeClient` + `createFakeRecipeServiceClient`
 * + `vi.spyOn`), so the REAL `useIngredientResolver`, the REAL `useOnDemandIngredientSearch` mutation and the
 * REAL client run; only the transport is stubbed. Queries use role/label/text only.
 *
 * @implements FR-010a
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { SourceBusyError, SourceUnavailableError } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

/** The affordance's accessible name for a given query. */
const actionName = (query: string): RegExp => new RegExp(`Search USDA for .${query}.`, 'u');

/** Mount the picker with a client whose local suggest always settles empty (so only the live path matters). */
function mountWithEmptyLocal(): {
    readonly client: ReturnType<typeof createFakeRecipeServiceClient>;
    readonly user: ReturnType<typeof userEvent.setup>;
} {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'suggestIngredients').mockResolvedValue({ suggestions: [], catalogAvailability: 'ok' });

    return { client, user: userEvent.setup() };
}

/** Type a query into the picker's search box. */
async function typeQuery(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
    await user.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), text);
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('IngredientPicker — the on-demand USDA search affordance (U29)', () => {
    it('NEVER searches the source while the cook types — the whole quota argument rests on this', async () => {
        const { client, user } = mountWithEmptyLocal();
        const searchLive = vi.spyOn(client, 'searchIngredientsLive').mockResolvedValue({ hits: [] });

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'chicken breast');

        // Wait for the LOCAL search to settle, so this is not merely "the debounce has not fired yet".
        expect(await screen.findByRole('button', { name: actionName('chicken breast') })).toBeInTheDocument();
        // ⛔ Fourteen keystrokes, a settled local search, and not one source call.
        expect(searchLive).not.toHaveBeenCalled();
    });

    it('offers the affordance once the query is typed, marked as the SLOW path', async () => {
        const { client, user } = mountWithEmptyLocal();

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');

        const action = await screen.findByRole('button', { name: actionName('broccoli') });
        expect(action).toBeEnabled();
        // The warning is load-bearing: everything else here settles in under a second and this takes several.
        expect(screen.getByText('Slow')).toBeInTheDocument();
    });

    it('does NOT offer the affordance below the search minimum (003-FR-010a)', async () => {
        const { client, user } = mountWithEmptyLocal();

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'br');

        // Two characters cannot discriminate, and this path spends a shared external quota — so the control
        // is not merely disabled, it is not offered at all, exactly like the other query-keyed actions.
        expect(screen.queryByRole('button', { name: /Search USDA for/u })).not.toBeInTheDocument();
    });

    it('searches only when the affordance is pressed, and with the typed query', async () => {
        const { client, user } = mountWithEmptyLocal();
        const searchLive = vi.spyOn(client, 'searchIngredientsLive').mockResolvedValue({ hits: [] });

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));

        await waitFor(() => {
            expect(searchLive).toHaveBeenCalledExactlyOnceWith('broccoli');
        });
    });

    it('shows a multi-second loading state while the source is being searched', async () => {
        const { client, user } = mountWithEmptyLocal();
        vi.spyOn(client, 'searchIngredientsLive').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));

        // A live region, because a wait this long with no announcement is a screen-reader dead end — and it
        // says outright that seconds are expected, so the wait reads as the cook's choice, not a hang.
        expect(await screen.findByRole('status', { name: 'Searching the USDA database…' })).toBeInTheDocument();
        expect(screen.getByText('This can take a few seconds.')).toBeInTheDocument();
    });

    it('disables the affordance while a search is running, so one press cannot spend the lane twice', async () => {
        const { client, user } = mountWithEmptyLocal();
        const searchLive = vi.spyOn(client, 'searchIngredientsLive').mockReturnValue(new Promise(() => {}));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        const action = await screen.findByRole('button', { name: actionName('broccoli') });
        await user.click(action);

        await waitFor(() => {
            expect(action).toBeDisabled();
        });
        await user.click(action);
        expect(searchLive).toHaveBeenCalledTimes(1);
    });

    it('renders the source hits in their own labelled section', async () => {
        const { client, user } = mountWithEmptyLocal();
        vi.spyOn(client, 'searchIngredientsLive').mockResolvedValue({
            hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }, { name: 'Broccoli rabe' }],
        });

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));

        const section = await screen.findByRole('region', { name: 'USDA search results' });
        expect(await screen.findByRole('button', { name: 'Broccoli, raw' })).toBeInTheDocument();
        expect(section).toBeInTheDocument();
    });

    it('picks a hit we already hold, resolving the line without a second source call', async () => {
        const onSelect = vi.fn();
        const { client, user } = mountWithEmptyLocal();
        vi.spyOn(client, 'searchIngredientsLive').mockResolvedValue({
            hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }],
        });
        const byFood = vi
            .spyOn(client, 'addIngredientByFood')
            .mockResolvedValue(
                makeIngredient({
                    id: 'ing_1',
                    name: 'Broccoli, raw',
                    foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                }),
            );
        const byName = vi.spyOn(client, 'addIngredientByName');

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));
        await user.click(await screen.findByRole('button', { name: 'Broccoli, raw' }));

        await waitFor(() => {
            expect(onSelect).toHaveBeenCalledTimes(1);
        });
        expect(byFood).toHaveBeenCalledWith('food_1');
        // ⛔ Not by-name: re-admitting a food the crosswalk just identified would re-enter the source fan-out.
        expect(byName).not.toHaveBeenCalled();
    });

    it('picks an unknown hit through the by-name path, which is the slower one it needs', async () => {
        const onSelect = vi.fn();
        const { client, user } = mountWithEmptyLocal();
        vi.spyOn(client, 'searchIngredientsLive').mockResolvedValue({ hits: [{ name: 'Broccoli rabe' }] });
        const byName = vi
            .spyOn(client, 'addIngredientByName')
            .mockResolvedValue(
                makeIngredient({
                    id: 'ing_2',
                    name: 'Broccoli rabe',
                    foodResolutionStatus: FoodResolutionStatus.PENDING,
                }),
            );

        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));
        await user.click(await screen.findByRole('button', { name: 'Broccoli rabe' }));

        await waitFor(() => {
            expect(byName).toHaveBeenCalledWith('Broccoli rabe');
        });
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('says the source has NOTHING — distinct from either failure — when it answers empty', async () => {
        const { client, user } = mountWithEmptyLocal();
        vi.spyOn(client, 'searchIngredientsLive').mockResolvedValue({ hits: [] });

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'zzzzz');
        await user.click(await screen.findByRole('button', { name: actionName('zzzzz') }));

        expect(await screen.findByText(/USDA has nothing for/u)).toBeInTheDocument();
        // ⛔ The distinction this whole surface turns on: a cook here should STOP looking, so neither
        // "try again" sentence may appear, and no retry control is offered.
        expect(screen.queryByText(/didn’t answer/u)).not.toBeInTheDocument();
        expect(screen.queryByText(/rate-limited/u)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('says the source is RATE-LIMITED, and offers a retry, when the budget refused', async () => {
        const { client, user } = mountWithEmptyLocal();
        vi.spyOn(client, 'searchIngredientsLive').mockRejectedValue(new SourceBusyError(60));

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/rate-limited/u);
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('says the source DIDN’T ANSWER — a different sentence from rate-limited — when it is down', async () => {
        const { client, user } = mountWithEmptyLocal();
        vi.spyOn(client, 'searchIngredientsLive').mockRejectedValue(new SourceUnavailableError());

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));

        const alert = await screen.findByRole('alert');
        // ⛔ A cook must be able to tell "our limit, come back shortly" from "their service is down".
        expect(alert).toHaveTextContent(/didn’t answer/u);
        expect(alert).not.toHaveTextContent(/rate-limited/u);
    });

    it('retries on demand after a failure, issuing a second search', async () => {
        const { client, user } = mountWithEmptyLocal();
        const searchLive = vi
            .spyOn(client, 'searchIngredientsLive')
            .mockRejectedValueOnce(new SourceUnavailableError())
            .mockResolvedValueOnce({ hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }] });

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));
        await user.click(await screen.findByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('button', { name: 'Broccoli, raw' })).toBeInTheDocument();
        expect(searchLive).toHaveBeenCalledTimes(2);
    });

    it('closes the panel on dismiss, without searching again', async () => {
        const { client, user } = mountWithEmptyLocal();
        const searchLive = vi
            .spyOn(client, 'searchIngredientsLive')
            .mockResolvedValue({ hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }] });

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));
        await user.click(await screen.findByRole('button', { name: 'Close USDA results' }));

        await waitFor(() => {
            expect(screen.queryByRole('region', { name: 'USDA search results' })).not.toBeInTheDocument();
        });
        expect(searchLive).toHaveBeenCalledTimes(1);
    });

    it('drops the panel when the cook types on, so hits never sit under a different query', async () => {
        const { client, user } = mountWithEmptyLocal();
        vi.spyOn(client, 'searchIngredientsLive').mockResolvedValue({
            hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }],
        });

        renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
        await typeQuery(user, 'broccoli');
        await user.click(await screen.findByRole('button', { name: actionName('broccoli') }));
        expect(await screen.findByRole('button', { name: 'Broccoli, raw' })).toBeInTheDocument();

        await typeQuery(user, ' rabe');

        // ⛔ Otherwise the cook picks "Broccoli, raw" for a line they have already renamed.
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Broccoli, raw' })).not.toBeInTheDocument();
        });
    });
});
