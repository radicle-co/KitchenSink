/**
 * Component tests for IngredientStatusPoller (T067 web poll-after-add). The headless poller drives
 * `useIngredientStatus` for one PENDING food-backed line and reports the observed status up via `onStatus`.
 * These pin: it renders nothing, it reports the observed status (with the line's id) once known, it stays
 * silent until a status is available, and it does not re-report an unchanged status.
 *
 * Migrated (CP-6 T3) off `vi.mock('@kitchensink/recipe-service-client/hooks', ...)` onto the type-checked
 * fake-client seam: `renderWithRecipeClient` mounts the poller through the REAL `useIngredientStatus` hook
 * (via `@commise/features-recipes/hooks`'s `usePollIngredientStatus`) over a real, network-guarded
 * `RecipeServiceClient` (`createFakeRecipeServiceClient`), stubbed per test with a type-checked
 * `vi.spyOn(client, 'getIngredientStatus')` — a renamed/re-signatured client method now fails `tsc` here,
 * not just the assertion at runtime.
 */
import { cleanup, waitFor } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';

import { IngredientStatusPoller } from '@/components/recipes/IngredientStatusPoller';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** A fake client whose `getIngredientStatus` never resolves (models an in-flight/unobserved poll). */
function pendingClient(): RecipeServiceClient {
    const client = createFakeRecipeServiceClient();
    vi.spyOn(client, 'getIngredientStatus').mockReturnValue(new Promise(() => {}));

    return client;
}

describe('IngredientStatusPoller', () => {
    it('renders nothing (headless — the badge lives on the form)', () => {
        const { container } = renderWithRecipeClient(
            <IngredientStatusPoller ingredientId="ing_1" onStatus={vi.fn()} />,
            pendingClient(),
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('polls the given id through the real client', () => {
        const client = pendingClient();
        const getIngredientStatusSpy = vi.mocked(client.getIngredientStatus);

        renderWithRecipeClient(<IngredientStatusPoller ingredientId="ing_food" onStatus={vi.fn()} />, client);

        expect(getIngredientStatusSpy).toHaveBeenCalledWith('ing_food');
    });

    it('reports the observed status (with the line id) once the poll returns one', async () => {
        const onStatus = vi.fn();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getIngredientStatus').mockResolvedValue(
            makeIngredient({ id: 'ing_food', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        );

        renderWithRecipeClient(<IngredientStatusPoller ingredientId="ing_food" onStatus={onStatus} />, client);

        await waitFor(() => expect(onStatus).toHaveBeenCalledWith('ing_food', FoodResolutionStatus.RESOLVED));
    });

    it('stays silent while the poll has no data yet', () => {
        const onStatus = vi.fn();

        renderWithRecipeClient(<IngredientStatusPoller ingredientId="ing_food" onStatus={onStatus} />, pendingClient());

        expect(onStatus).not.toHaveBeenCalled();
    });

    it('does not re-report an unchanged status across re-renders', async () => {
        const onStatus = vi.fn();
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getIngredientStatus').mockResolvedValue(
            makeIngredient({ id: 'ing_food', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        );

        const { rerender } = renderWithRecipeClient(
            <IngredientStatusPoller ingredientId="ing_food" onStatus={onStatus} />,
            client,
        );

        await waitFor(() => expect(onStatus).toHaveBeenCalledTimes(1));

        rerender(<IngredientStatusPoller ingredientId="ing_food" onStatus={onStatus} />);

        // The effect is keyed on (id, observed status) — a re-render with the same status fires it once only.
        expect(onStatus).toHaveBeenCalledTimes(1);
    });
});
