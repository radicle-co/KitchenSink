// @vitest-environment jsdom
/**
 * Tests for {@link useAmbiguityReviewRow}: one ambiguity review row's state, shared by the web and native leaves (U13;
 * `docs/design/rowEditorOpenDecisions.md`, S7 list contract P8 and P12, V3-9). The food search and the source naming
 * are mocked at their seams (their own suites run them for real); the pick controller is a stand-in whose `pick` is
 * recorded. What the leaves draw from this is `ambiguityReviewSurface(.native).test.tsx`'s.
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeIngredientView } from '../../__fixtures__/index.js';
import {
    COMPLETE_FRAME,
    answerOf,
    databaseFrame,
    remoteItem,
    sourceAnswered,
} from '../../__fixtures__/progressiveFrames.js';
import { recipeFormMessages } from '../../form/messages.js';
import type { ProgressiveRead } from '../../hooks/foodSuggestions.model.js';
import type { RemoteFoodPick } from '../../hooks/lineCommit.js';
import type { AmbiguityPickController, ReviewPickFailure } from '../../hooks/useAmbiguityPick.js';
import { recipeMessages } from '../../messages.js';
import type { AmbiguityReviewLine, ReviewPick } from '../model.js';

const mocks = vi.hoisted(() => ({ useIngredientSuggestionSource: vi.fn() }));

vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: mocks.useIngredientSuggestionSource,
}));
vi.mock('../../hooks/useSourceNaming.js', () => ({
    useSourceNaming: () => ({
        sourceName: (source: string) => (source === 'usda' ? 'USDA' : undefined),
        formatTime: () => '3:05 PM',
        formatList: (items: readonly string[]) => items.join(', '),
    }),
}));

import { useAmbiguityReviewRow } from '../useAmbiguityReviewRow.js';

const detail = recipeMessages.en.detail;
const form = recipeFormMessages.en;

const REVIEW: AmbiguityReviewLine = {
    position: 2,
    name: ' apple sauce ',
    line: makeIngredientView({
        name: 'apple sauce',
        quantity: { kind: 'exact', value: 2 },
        unit: 'tbsp',
        resolutionStatus: FoodResolutionStatus.AMBIGUOUS,
    }),
};
const CANNED: ReviewPick = { kind: 'catalogFood', foodId: 'F_canned' };
const STEWED: RemoteFoodPick = { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' };

/** The food search's answer for the row, and Try again. */
const searched = (read: ProgressiveRead, refetch = vi.fn()) => ({ read, refetch });
const LISTED = searched({
    kind: 'ended',
    answer: answerOf(
        databaseFrame({ catalog: [{ id: 'F_canned', name: 'Apple sauce, canned', score: 0.9 }] }),
        sourceAnswered('usda', remoteItem('Apples, stewed', 'sealed.s')),
        COMPLETE_FRAME,
    ),
    resumed: false,
});

const ASKING: ProgressiveRead = { kind: 'asking', answer: answerOf(), resumed: false };
const EVERY_PART_FAILED: ProgressiveRead = {
    kind: 'ended',
    answer: answerOf(databaseFrame({ authored: 'unavailable', catalog: 'unavailable' }), COMPLETE_FRAME),
    resumed: false,
};

/** A pick controller with nothing in flight and nothing failed, over `over`. */
const pickerWith = (over: Partial<AmbiguityPickController> = {}): AmbiguityPickController => ({
    pick: vi.fn(),
    picking: false,
    adding: undefined,
    failedAt: undefined,
    failure: undefined,
    takenAt: undefined,
    saves: 0,
    limitRefusals: 0,
    holdLimit: vi.fn(),
    ...over,
});

const failureAt = (position: number, pick: ReviewPick): ReviewPickFailure => ({
    position,
    pick,
    outcome: { kind: 'failed' },
});

beforeEach(() => {
    mocks.useIngredientSuggestionSource.mockReturnValue(LISTED);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useAmbiguityReviewRow — the search and the list', () => {
    it('searches the line’s trimmed name with the review’s limit holder', () => {
        const picker = pickerWith();

        renderHook(() => useAmbiguityReviewRow(REVIEW, picker));

        expect(mocks.useIngredientSuggestionSource).toHaveBeenLastCalledWith('apple sauce', true, picker.holdLimit);
    });

    it('names the row by the line, amount and all, and lists the database’s foods ahead of the source’s', () => {
        const { result } = renderHook(() => useAmbiguityReviewRow(REVIEW, pickerWith()));

        expect(result.current.summary).toBe('2 tbsp apple sauce');
        expect(result.current.groups.map((group) => group.candidates.map((each) => each.name))).toEqual([
            ['Apple sauce, canned'],
            ['Apples, stewed'],
        ]);
        expect(result.current.retryLabel).toBe('Try again for “apple sauce”');
    });

    it.each<[string, ProgressiveRead, string, boolean]>([
        ['while the answer runs', ASKING, detail.ambiguousReviewLoading, false],
        ['offline', { kind: 'parked' }, offlineNoticeMessages.en.readOffline, false],
        ['when every part failed, with Try again', EVERY_PART_FAILED, form.candidatesLoadFailed, true],
    ])('lists nothing and says so %s', (_case, read, status, offersRetry) => {
        mocks.useIngredientSuggestionSource.mockReturnValue(searched(read));
        const { result } = renderHook(() => useAmbiguityReviewRow(REVIEW, pickerWith()));

        expect(result.current.groups).toEqual([]);
        expect(result.current.status).toBe(status);
        expect(result.current.offersRetry).toBe(offersRetry);
    });
});

describe('useAmbiguityReviewRow — this row’s pick', () => {
    it('says nothing, offers no Try again and adds nothing while no pick concerns this row', () => {
        const { result } = renderHook(() =>
            useAmbiguityReviewRow(
                REVIEW,
                pickerWith({ failure: failureAt(1, CANNED), adding: { position: 1, pick: STEWED } }),
            ),
        );

        expect(result.current.alert).toBe('');
        expect(result.current.offersRetry).toBe(false);
        expect(result.current.adding).toBeUndefined();
    });

    it.each([
        ['a database pick', CANNED, detail.ambiguousReviewFailed],
        ['a remote pick, in P8’s words', STEWED, form.ingredientRemotePickFailed],
    ] as const)('a refused %s is said on this row, with Try again', (_case, pick, template) => {
        const { result } = renderHook(() => useAmbiguityReviewRow(REVIEW, pickerWith({ failure: failureAt(2, pick) })));

        expect(result.current.alert).toBe(template.replace('{name}', 'Apples, stewed').replace('{source}', 'USDA'));
        expect(result.current.offersRetry).toBe(true);
    });

    it('a remote pick in flight on this row says where its food is coming from (V3-9)', () => {
        const { result } = renderHook(() =>
            useAmbiguityReviewRow(REVIEW, pickerWith({ adding: { position: 2, pick: STEWED } })),
        );

        expect(result.current.adding).toBe(form.ingredientEntryAddingFromSource.replace('{source}', 'USDA'));
    });

    it('a pick re-points this line through the controller, and asks the search again if food refused it', () => {
        const refetch = vi.fn();

        mocks.useIngredientSuggestionSource.mockReturnValue(searched(LISTED.read, refetch));
        const picker = pickerWith();
        const { result } = renderHook(() => useAmbiguityReviewRow(REVIEW, picker));

        act(() => result.current.onPick(STEWED));

        expect(picker.pick).toHaveBeenCalledExactlyOnceWith(2, STEWED, refetch);
    });

    it('Try again after this row’s failure asks again and says the list was refreshed, until the next pick', () => {
        const refetch = vi.fn();

        mocks.useIngredientSuggestionSource.mockReturnValue(searched(LISTED.read, refetch));
        const { result } = renderHook(() =>
            useAmbiguityReviewRow(REVIEW, pickerWith({ failure: failureAt(2, CANNED) })),
        );

        expect(result.current.refreshed).toBe(false);
        act(() => result.current.onRetry());

        expect(refetch).toHaveBeenCalledTimes(1);
        expect(result.current.refreshed).toBe(true);

        act(() => result.current.onPick(CANNED));

        expect(result.current.refreshed).toBe(false);
    });

    it('Try again after a failed search asks again and claims no refresh of a pick', () => {
        const refetch = vi.fn();

        mocks.useIngredientSuggestionSource.mockReturnValue(searched(EVERY_PART_FAILED, refetch));
        const { result } = renderHook(() => useAmbiguityReviewRow(REVIEW, pickerWith()));

        act(() => result.current.onRetry());

        expect(refetch).toHaveBeenCalledTimes(1);
        expect(result.current.refreshed).toBe(false);
    });
});
