/**
 * Component tests for IngredientStatusPoller (T067 web poll-after-add). The headless poller drives
 * `useIngredientStatus` for one PENDING food-backed line and reports the observed status up via `onStatus`.
 * These pin: it renders nothing, it reports the observed status (with the line's id) once known, it stays
 * silent until a status is available, and it does not re-report an unchanged status. The status hook is
 * mocked so no QueryClient / backend is needed.
 */
import { render } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IngredientStatusPoller } from '@/components/recipes/IngredientStatusPoller';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

const { useIngredientStatusMock } = vi.hoisted(() => ({ useIngredientStatusMock: vi.fn() }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useIngredientStatus: useIngredientStatusMock,
}));

afterEach(() => {
    vi.clearAllMocks();
});

beforeEach(() => {
    useIngredientStatusMock.mockReturnValue({ data: undefined });
});

describe('IngredientStatusPoller', () => {
    it('renders nothing (headless — the badge lives on the form)', () => {
        const { container } = render(<IngredientStatusPoller ingredientId="ing_1" onStatus={vi.fn()} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('polls the given id through useIngredientStatus', () => {
        render(<IngredientStatusPoller ingredientId="ing_food" onStatus={vi.fn()} />);

        expect(useIngredientStatusMock).toHaveBeenCalledWith('ing_food');
    });

    it('reports the observed status (with the line id) once the poll returns one', () => {
        const onStatus = vi.fn();
        useIngredientStatusMock.mockReturnValue({
            data: makeIngredient({ id: 'ing_food', foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
        });

        render(<IngredientStatusPoller ingredientId="ing_food" onStatus={onStatus} />);

        expect(onStatus).toHaveBeenCalledWith('ing_food', FoodResolutionStatus.RESOLVED);
    });

    it('stays silent while the poll has no data yet', () => {
        const onStatus = vi.fn();
        useIngredientStatusMock.mockReturnValue({ data: undefined });

        render(<IngredientStatusPoller ingredientId="ing_food" onStatus={onStatus} />);

        expect(onStatus).not.toHaveBeenCalled();
    });

    it('does not re-report an unchanged status across re-renders', () => {
        const onStatus = vi.fn();
        useIngredientStatusMock.mockReturnValue({
            data: makeIngredient({ id: 'ing_food', foodResolutionStatus: FoodResolutionStatus.PENDING }),
        });

        const { rerender } = render(<IngredientStatusPoller ingredientId="ing_food" onStatus={onStatus} />);
        rerender(<IngredientStatusPoller ingredientId="ing_food" onStatus={onStatus} />);

        // The effect is keyed on (id, observed status) — a re-render with the same status fires it once only.
        expect(onStatus).toHaveBeenCalledTimes(1);
    });
});
