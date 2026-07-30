/**
 * Tests for {@link usePollIngredientStatus} — the shared headless-hook seam (CP-6/B4) extracted from the
 * two byte-for-byte-identical `IngredientStatusPoller` leaves (web + mobile). Pins the exact behavior those
 * leaves already had: it drives `useIngredientStatus(ingredientId)` and reports the observed
 * `foodResolutionStatus` up via `onStatus(ingredientId, status)` in a single effect, staying silent until a
 * status is known and not re-firing for an unchanged status across re-renders. `useIngredientStatus` is
 * mocked (it owns the self-limiting `refetchInterval` poll — out of scope here) so no QueryClient/backend is
 * needed.
 */
import { renderHook } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useIngredientStatusMock } = vi.hoisted(() => ({ useIngredientStatusMock: vi.fn() }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useIngredientStatus: useIngredientStatusMock,
}));

import { usePollIngredientStatus } from '../usePollIngredientStatus.js';

beforeEach(() => {
    useIngredientStatusMock.mockReturnValue({ data: undefined });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('usePollIngredientStatus', () => {
    it('polls the given id through useIngredientStatus', () => {
        renderHook(() => usePollIngredientStatus('ing_food', vi.fn()));

        expect(useIngredientStatusMock).toHaveBeenCalledWith('ing_food');
    });

    it('stays silent while the poll has no data yet', () => {
        const onStatus = vi.fn();

        renderHook(() => usePollIngredientStatus('ing_food', onStatus));

        expect(onStatus).not.toHaveBeenCalled();
    });

    it('reports the observed status (with the ingredient id) once the poll returns one', () => {
        const onStatus = vi.fn();
        useIngredientStatusMock.mockReturnValue({
            data: { id: 'ing_food', foodResolutionStatus: FoodResolutionStatus.RESOLVED },
        });

        renderHook(() => usePollIngredientStatus('ing_food', onStatus));

        expect(onStatus).toHaveBeenCalledWith('ing_food', FoodResolutionStatus.RESOLVED);
    });

    it('does not re-report an unchanged status across re-renders', () => {
        const onStatus = vi.fn();
        useIngredientStatusMock.mockReturnValue({
            data: { id: 'ing_food', foodResolutionStatus: FoodResolutionStatus.PENDING },
        });

        const { rerender } = renderHook(({ id }) => usePollIngredientStatus(id, onStatus), {
            initialProps: { id: 'ing_food' },
        });
        rerender({ id: 'ing_food' });

        // The effect is keyed on (id, observed status) — a re-render with the same status fires it once only.
        expect(onStatus).toHaveBeenCalledTimes(1);
    });

    it('re-reports when the observed status changes', () => {
        const onStatus = vi.fn();
        useIngredientStatusMock.mockReturnValue({
            data: { id: 'ing_food', foodResolutionStatus: FoodResolutionStatus.PENDING },
        });

        const { rerender } = renderHook(({ id }) => usePollIngredientStatus(id, onStatus), {
            initialProps: { id: 'ing_food' },
        });

        useIngredientStatusMock.mockReturnValue({
            data: { id: 'ing_food', foodResolutionStatus: FoodResolutionStatus.RESOLVED },
        });
        rerender({ id: 'ing_food' });

        expect(onStatus).toHaveBeenNthCalledWith(1, 'ing_food', FoodResolutionStatus.PENDING);
        expect(onStatus).toHaveBeenNthCalledWith(2, 'ing_food', FoodResolutionStatus.RESOLVED);
    });
});
