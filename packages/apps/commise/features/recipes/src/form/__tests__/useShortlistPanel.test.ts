/**
 * Tests for {@link useShortlistPanel}, rows 6 and 7's panel orchestration shared by the web and native leaves
 * (SPECIFY.1 rows 6 and 7; `docs/design/rowEditorOpenDecisions.md`, S7 list contract P8 and P12). The food search is
 * mocked at its seam (`ingredientSuggestionSource.test.tsx` owns it); the view is `shortlistPanelOf`'s, run for real.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    COMPLETE_FRAME,
    answerOf,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
} from '../../__fixtures__/progressiveFrames.js';
import type { CandidatesPanelBody } from '../candidatesPanel.js';
import type { IngredientPick, LineCommitOutcome } from '../../hooks/lineCommit.js';
import { seedLineKey } from '../lineKey.js';
import { recipeFormMessages } from '../messages.js';
import type { ShortlistPanelProps } from '../shortlistPanel.js';

const mocks = vi.hoisted(() => ({ useIngredientSuggestionSource: vi.fn() }));

vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: mocks.useIngredientSuggestionSource,
}));

import { useShortlistPanel } from '../useShortlistPanel.js';

const en = recipeFormMessages.en;
const COMMITTED: LineCommitOutcome = {
    kind: 'committed',
    key: seedLineKey(2, 0),
    binding: { ingredientId: 'ing_canned', isUserEntered: false },
};
const CANNED: IngredientPick = { kind: 'catalogFood', foodId: 'food_canned', name: 'Applesauce, canned' };
const STEWED: IngredientPick = { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' };

/** The search's answer: one catalog food, then one USDA food. */
const answered = (refetch = vi.fn()) => ({
    read: {
        kind: 'ended',
        answer: answerOf(
            databaseFrame({ catalog: [catalogResult('food_canned', 'Applesauce, canned')] }),
            sourceAnswered('usda', remoteItem('Apples, stewed', 'sealed.s')),
            COMPLETE_FRAME,
        ),
        resumed: false,
    },
    refetch,
});

const propsWith = (over: Partial<ShortlistPanelProps> = {}): ShortlistPanelProps => ({
    reason: 'ambiguous',
    food: 'apple sauce',
    phrase: ' apple sauce ',
    inFlight: undefined,
    lastPick: undefined,
    limitRefusals: 0,
    holdLimit: vi.fn(),
    naming: { sourceName: () => 'USDA', formatTime: () => '3:05 PM', formatList: (items) => items.join(', ') },
    onPick: vi.fn<(pick: IngredientPick) => Promise<LineCommitOutcome>>(() => Promise.resolve(COMMITTED)),
    onSettled: vi.fn(),
    onNoneOfThese: vi.fn(),
    ...over,
});

/** The candidate id of the option named `name`, read from the view the hook derived. */
const candidateIdOf = (body: CandidatesPanelBody, name: string): string => {
    const option =
        body.kind === 'list'
            ? body.groups.flatMap((group) => group.options).find((each) => each.name === name)
            : undefined;

    expect(option, `no option named ${name}`).toBeDefined();

    return option?.candidateId ?? '';
};

beforeEach(() => {
    mocks.useIngredientSuggestionSource.mockReturnValue(answered());
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useShortlistPanel', () => {
    it.each([
        [' apple sauce ', 'apple sauce', true],
        ['ab', 'ab', false],
    ])(
        'searches the trimmed words of %j, only when they can be searched, with the session’s hold',
        (phrase, words, ok) => {
            const props = propsWith({ phrase });

            renderHook(() => useShortlistPanel(props));

            expect(mocks.useIngredientSuggestionSource).toHaveBeenLastCalledWith(words, ok, props.holdLimit);
        },
    );

    it.each([
        ['ambiguous', en.statusExplainAmbiguous],
        ['unresolved', en.statusExplainUnresolved],
    ] as const)('derives the view for a %s row', (reason, explanation) => {
        const { result } = renderHook(() => useShortlistPanel(propsWith({ reason })));

        expect(result.current.view.explanation).toBe(explanation);
        expect(result.current.view.body.kind).toBe('list');
    });

    it('a pick puts THAT food on the line, and settles the panel once it is on it', async () => {
        const props = propsWith();
        const { result } = renderHook(() => useShortlistPanel(props));

        act(() => result.current.onPick(candidateIdOf(result.current.view.body, 'Applesauce, canned')));

        expect(props.onPick).toHaveBeenCalledExactlyOnceWith(CANNED);
        await waitFor(() => expect(props.onSettled).toHaveBeenCalledTimes(1));
    });

    it.each<LineCommitOutcome>([{ kind: 'failed' }, { kind: 'conflict' }, { kind: 'busy' }, { kind: 'sourceBusy' }])(
        'a pick that put nothing on the line ($kind) neither settles nor searches again',
        async (outcome) => {
            const refetch = vi.fn();

            mocks.useIngredientSuggestionSource.mockReturnValue(answered(refetch));
            const props = propsWith({ onPick: vi.fn(() => Promise.resolve(outcome)) });
            const { result } = renderHook(() => useShortlistPanel(props));

            await act(async () => {
                result.current.onPick(candidateIdOf(result.current.view.body, 'Applesauce, canned'));
                await Promise.resolve();
            });

            expect(props.onPick).toHaveBeenCalledTimes(1);
            expect(props.onSettled).not.toHaveBeenCalled();
            expect(refetch).not.toHaveBeenCalled();
        },
    );

    it('a remote pick food refused searches again, and does not settle', async () => {
        const refetch = vi.fn();

        mocks.useIngredientSuggestionSource.mockReturnValue(answered(refetch));
        const props = propsWith({ onPick: vi.fn(() => Promise.resolve<LineCommitOutcome>({ kind: 'remoteGone' })) });
        const { result } = renderHook(() => useShortlistPanel(props));

        act(() => result.current.onPick(candidateIdOf(result.current.view.body, 'Apples, stewed')));

        expect(props.onPick).toHaveBeenCalledExactlyOnceWith(STEWED);
        await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
        expect(props.onSettled).not.toHaveBeenCalled();
    });

    it('picks nothing while a pick is in flight on the row', () => {
        const props = propsWith({ inFlight: CANNED });
        const { result } = renderHook(() => useShortlistPanel(props));

        act(() => result.current.onPick(candidateIdOf(result.current.view.body, 'Apples, stewed')));

        expect(props.onPick).not.toHaveBeenCalled();
    });

    it('picks nothing for an option the list no longer holds', () => {
        const props = propsWith();
        const { result } = renderHook(() => useShortlistPanel(props));

        act(() => result.current.onPick('catalog:food_gone'));

        expect(props.onPick).not.toHaveBeenCalled();
    });

    it('Try again searches again, and None of these hands the row back to the host', () => {
        const refetch = vi.fn();

        mocks.useIngredientSuggestionSource.mockReturnValue(answered(refetch));
        const props = propsWith();
        const { result } = renderHook(() => useShortlistPanel(props));

        act(() => result.current.onRetryRead());
        act(() => result.current.onNoneOfThese());

        expect(refetch).toHaveBeenCalledTimes(1);
        expect(props.onNoneOfThese).toHaveBeenCalledTimes(1);
        expect(props.onPick).not.toHaveBeenCalled();
    });
});
