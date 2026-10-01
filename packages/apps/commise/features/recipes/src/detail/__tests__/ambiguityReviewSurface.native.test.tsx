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
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
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

    // Plan 002: a clone KEEPS a line bound to the original cook's private food (rewritten from "N ingredients need
    // re-matching", which stopped being true: the lines are not unbound and nothing needs re-matching).
    it('the CLONE banner says the lines use the original cook’s private foods, and dismisses one-time', () => {
        render(<AmbiguityReview ingredients={[]} clonePrivateFoodLineCount={3} />);

        const text = en.clonePrivateFoodsBannerMany.replace('{count}', '3');

        expect(screen.getByText(text)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: en.clonePrivateFoodsDismiss }));

        expect(screen.queryByText(text)).toBeNull();
    });

    it('⛔ a banner on its own carries no label naming a review there is nothing to do in (WCAG 2.4.6)', () => {
        render(<AmbiguityReview ingredients={[]} clonePrivateFoodLineCount={1} />);

        expect(screen.queryByLabelText(en.ambiguousReviewHeading)).toBeNull();
        expect(screen.getByText(en.clonePrivateFoodsBannerOne)).toBeTruthy();
    });

    it('the CLONE banner uses its singular sentence for one line — never "1 ingredients"', () => {
        render(<AmbiguityReview ingredients={[]} clonePrivateFoodLineCount={1} />);

        expect(screen.getByText(en.clonePrivateFoodsBannerOne)).toBeTruthy();
    });

    it('⛔ the CLONE banner points at no control the editor does not have, and never says "re-match"', () => {
        for (const copy of [en.clonePrivateFoodsBannerOne, en.clonePrivateFoodsBannerMany]) {
            expect(copy).not.toMatch(/re-match|choose a food|when you edit/iu);
            expect(copy).toMatch(/private food/u);
        }
    });

    it('a clone that unbound NOTHING shows no banner — the ordinary clone is silent', () => {
        const { container } = render(<AmbiguityReview ingredients={[]} clonePrivateFoodLineCount={0} />);

        expect(container.innerHTML).toBe('');
    });
});
