// @vitest-environment jsdom
/**
 * U13 — the NATIVE half of the batched AMBIGUITY REVIEW surface, asserting the same state set as the web
 * mirror (`ambiguityReviewSurface.test.tsx`, §14): the decision layer is shared, so what this suite pins
 * is only that the native markup renders each state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';

const { useSuggestIngredientsMock, useRecordIngredientCorrectionMock } = vi.hoisted(() => ({
    useSuggestIngredientsMock: vi.fn(),
    useRecordIngredientCorrectionMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useSuggestIngredients: useSuggestIngredientsMock,
    useRecordIngredientCorrection: useRecordIngredientCorrectionMock,
}));

import { AmbiguityReview } from '../AmbiguityReview.native.js';

const en = recipeMessages.en.detail;

/** One AMBIGUOUS line with the given name. */
const ambiguousLine = (name: string, id = name) =>
    makeIngredientView({ ingredientId: id, name, resolutionStatus: FoodResolutionStatus.AMBIGUOUS });

/** A settled suggest carrying one catalog candidate. */
function settledSuggest(): Record<string, unknown> {
    return {
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: {
            suggestions: [{ provenance: 'catalog', foodId: 'F_pick', name: 'Apple sauce, canned', score: 0.9 }],
            catalogAvailability: 'ok',
        },
        refetch: vi.fn(),
    };
}

/** An idle correction mutation. */
function correctionMutation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { mutate: vi.fn(), isPending: false, isError: false, data: undefined, reset: vi.fn(), ...overrides };
}

beforeEach(() => {
    useSuggestIngredientsMock.mockReturnValue(settledSuggest());
    useRecordIngredientCorrectionMock.mockReturnValue(correctionMutation());
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('AmbiguityReview (native) — every state', () => {
    it('renders NOTHING for a recipe with no ambiguity and no clone count — the common case is silent', () => {
        const { container } = render(<AmbiguityReview ingredients={makeRecipeDetail().ingredients} />);

        expect(container.innerHTML).toBe('');
    });

    it('the ENTRY counts lines (singular), and the surface stays closed until toggled', () => {
        render(<AmbiguityReview ingredients={[ambiguousLine('apple sauce')]} />);

        expect(screen.getByText(en.ambiguousNoticeOne)).toBeTruthy();
        // Closed: no row rendered, and NO suggest fired — dismissal-safe by construction.
        expect(screen.queryByText('Apple sauce, canned')).toBeNull();
        expect(useSuggestIngredientsMock).not.toHaveBeenCalled();
    });

    it('opening the surface re-derives each row’s shortlist LIVE (gap 19) and a pick writes ONE correction', () => {
        const mutate = vi.fn();

        useRecordIngredientCorrectionMock.mockReturnValue(correctionMutation({ mutate }));
        render(<AmbiguityReview ingredients={[ambiguousLine('apple sauce')]} />);

        fireEvent.click(screen.getByRole('button', { name: en.ambiguousReviewToggle }));
        fireEvent.click(screen.getByRole('button', { name: 'Apple sauce, canned' }));

        expect(useSuggestIngredientsMock).toHaveBeenCalledWith('apple sauce', undefined, { enabled: true });
        expect(mutate).toHaveBeenCalledWith({ phrase: 'apple sauce', foodId: 'F_pick', surfacing: 'recipe_line' });
        expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('SIBLINGS sharing a phrase fold to one row carrying the binds-many caption (gap 18)', () => {
        render(
            <AmbiguityReview ingredients={[ambiguousLine('apple sauce', 'a'), ambiguousLine('Apple Sauce', 'b')]} />,
        );

        fireEvent.click(screen.getByRole('button', { name: en.ambiguousReviewToggle }));

        expect(screen.getAllByText('apple sauce')).toHaveLength(1);
        expect(screen.getByText('Applies to 2 lines in this recipe.')).toBeTruthy();
    });

    it('a SAVED pick renders the persisted confirmation — dismissal is safe from that moment', () => {
        useRecordIngredientCorrectionMock.mockReturnValue(
            correctionMutation({ data: { recorded: true, mappingId: 'm1', scope: 'author' } }),
        );
        render(<AmbiguityReview ingredients={[ambiguousLine('apple sauce')]} />);

        fireEvent.click(screen.getByRole('button', { name: en.ambiguousReviewToggle }));

        expect(screen.getByText(en.ambiguousReviewSaved)).toBeTruthy();
    });

    it('⛔ a FAILED write surfaces on ITS row alone, retryable, and retry refreshes the shortlist', () => {
        const refetch = vi.fn();

        useSuggestIngredientsMock.mockReturnValue({ ...settledSuggest(), refetch });
        useRecordIngredientCorrectionMock.mockReturnValue(correctionMutation({ isError: true }));
        render(<AmbiguityReview ingredients={[ambiguousLine('apple sauce')]} />);

        fireEvent.click(screen.getByRole('button', { name: en.ambiguousReviewToggle }));

        expect(screen.getByText(en.ambiguousReviewFailed)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: en.ambiguousReviewRetry }));

        expect(refetch).toHaveBeenCalledTimes(1);
        expect(screen.getByText(en.ambiguousReviewRefreshed)).toBeTruthy();
    });

    it('the CLONE banner renders its own sentence with the count, and dismisses one-time', () => {
        render(<AmbiguityReview ingredients={[]} cloneUnboundLineCount={3} />);

        expect(
            screen.getByText('3 ingredients need re-matching — the original used the author’s own foods.'),
        ).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: en.cloneUnboundDismiss }));

        expect(
            screen.queryByText('3 ingredients need re-matching — the original used the author’s own foods.'),
        ).toBeNull();
    });

    it('a clone that unbound NOTHING shows no banner — the ordinary clone is silent', () => {
        const { container } = render(<AmbiguityReview ingredients={[]} cloneUnboundLineCount={0} />);

        expect(container.innerHTML).toBe('');
    });
});
