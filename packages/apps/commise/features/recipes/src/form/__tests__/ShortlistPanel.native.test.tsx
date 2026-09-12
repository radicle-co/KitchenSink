/**
 * REWRITTEN for plan 002 S7.8: component tests for the native `ShortlistPanel`, the web panel's twin: rows 6 and 7's
 * panel (SPECIFY.1),
 * orchestration: it searches the line's own words through the progressive food search (`useIngredientSuggestionSource`,
 * mocked at its seam; its own behaviour is `ingredientSuggestionSource.test.tsx`'s), derives the view
 * (`shortlistPanelOf`, run for real), and puts a pressed food on THIS line through the host's pick
 * (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P8 and P12). What the shared body draws for each state is
 * `CandidatesPanelBody.native.test.tsx`'s and `shortlistPanel.test.ts`'s.
 */
import type { ProgressiveFrame } from '@kitchensink/food-service-client';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { headedGroup } from '@commise/test-utils';

import {
    COMPLETE_FRAME,
    answerOf,
    authoredResult,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
} from '../../__fixtures__/progressiveFrames.js';
import type { ProgressiveRead } from '../../hooks/foodSuggestions.model.js';
import type { IngredientPick, LineCommitOutcome } from '../../hooks/lineCommit.js';
import { seedLineKey } from '../lineKey.js';
import { recipeFormMessages } from '../messages.js';
import type { ShortlistPanelProps } from '../shortlistPanel.js';

const mocks = vi.hoisted(() => ({ useIngredientSuggestionSource: vi.fn() }));

vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: mocks.useIngredientSuggestionSource,
}));

import { ShortlistPanel } from '../ShortlistPanel.native.js';

const en = recipeFormMessages.en;
const KEY = seedLineKey(2, 0);
const COMMITTED: LineCommitOutcome = {
    kind: 'committed',
    key: KEY,
    binding: { ingredientId: 'ing_canned', isUserEntered: false },
};
const FRAMES: readonly ProgressiveFrame[] = [
    databaseFrame({
        authored: [authoredResult('food_mine', 'apple sauce, homemade')],
        catalog: [catalogResult('food_canned', 'Applesauce, canned')],
    }),
    sourceAnswered('usda', remoteItem('Apples, stewed', 'sealed.s')),
    COMPLETE_FRAME,
];

/** The food search's answer, and Try again. */
const searched = (read: ProgressiveRead, refetch = vi.fn()) => ({ read, refetch });
const ANSWERED = searched({ kind: 'ended', answer: answerOf(...FRAMES), resumed: false });

const renderPanel = (over: Partial<ShortlistPanelProps> = {}) => {
    const props: ShortlistPanelProps = {
        reason: 'ambiguous',
        food: 'apple sauce',
        phrase: 'apple sauce',
        inFlight: undefined,
        lastPick: undefined,
        limitRefusals: 0,
        holdLimit: vi.fn(),
        naming: {
            sourceName: (source) => (source === 'usda' ? 'USDA' : undefined),
            formatTime: () => '3:05 PM',
            formatList: (items) => items.join(', '),
        },
        onPick: vi.fn<(pick: IngredientPick) => Promise<LineCommitOutcome>>(() => Promise.resolve(COMMITTED)),
        onSettled: vi.fn(),
        onNoneOfThese: vi.fn(),
        ...over,
    };

    render(<ShortlistPanel {...props} />);

    return props;
};

beforeEach(() => {
    mocks.useIngredientSuggestionSource.mockReturnValue(ANSWERED);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ShortlistPanel (native)', () => {
    it('searches the line’s own words, only when they can be searched, and hands the search the session’s hold', () => {
        const holdLimit = vi.fn();

        renderPanel({ holdLimit });
        expect(mocks.useIngredientSuggestionSource).toHaveBeenLastCalledWith('apple sauce', true, holdLimit);

        cleanup();
        renderPanel({ phrase: 'ab', holdLimit });
        expect(mocks.useIngredientSuggestionSource).toHaveBeenLastCalledWith('ab', false, holdLimit);
    });

    it.each<['ambiguous' | 'unresolved', string]>([
        ['ambiguous', en.statusExplainAmbiguous],
        ['unresolved', en.statusExplainUnresolved],
    ])(
        'explains a %s row, then lists the cook’s own foods ahead of the catalog’s, then the source’s',
        (reason, text) => {
            renderPanel({ reason });
            const list = screen.getByLabelText('Which “apple sauce” did you mean?');

            expect(screen.getByText(text)).toBeTruthy();
            expect(
                within(list)
                    .getAllByRole('button')
                    .map((button) => button.textContent),
            ).toEqual(['apple sauce, homemade', 'Applesauce, canned']);
            // A source's group is named by its header (`docs/design/nativeContainerNames.md` N1).
            expect(within(headedGroup('From USDA')).getByRole('button').textContent).toBe('Apples, stewed');
        },
    );

    it('a press puts THAT food on the line, and closes the panel once it is on it', async () => {
        const props = renderPanel();

        fireEvent.click(screen.getByRole('button', { name: 'Applesauce, canned' }));

        expect(props.onPick).toHaveBeenCalledExactlyOnceWith({
            kind: 'catalogFood',
            foodId: 'food_canned',
            name: 'Applesauce, canned',
        });
        await waitFor(() => expect(props.onSettled).toHaveBeenCalledTimes(1));
    });

    it('a press on a remote food picks it by its reference (ADR-0055 point 10)', async () => {
        const props = renderPanel();

        fireEvent.click(screen.getByRole('button', { name: 'Apples, stewed, from USDA' }));

        expect(props.onPick).toHaveBeenCalledExactlyOnceWith({
            kind: 'remoteFood',
            reference: 'sealed.s',
            name: 'Apples, stewed',
            source: 'usda',
        });
    });

    it.each<LineCommitOutcome>([{ kind: 'failed' }, { kind: 'conflict' }, { kind: 'busy' }, { kind: 'sourceBusy' }])(
        'a press that put nothing on the line ($kind) keeps the panel open',
        async (outcome) => {
            const props = renderPanel({ onPick: vi.fn(() => Promise.resolve(outcome)) });

            fireEvent.click(screen.getByRole('button', { name: 'Applesauce, canned' }));
            await Promise.resolve();

            expect(props.onPick).toHaveBeenCalledTimes(1);
            expect(props.onSettled).not.toHaveBeenCalled();
        },
    );

    // P8: "The cached answer for this text is dropped, so the list asks again."
    it('a remote pick food refused asks the search again', async () => {
        const refetch = vi.fn();

        mocks.useIngredientSuggestionSource.mockReturnValue(searched(ANSWERED.read, refetch));
        renderPanel({ onPick: vi.fn(() => Promise.resolve<LineCommitOutcome>({ kind: 'remoteGone' })) });

        fireEvent.click(screen.getByRole('button', { name: 'Apples, stewed, from USDA' }));

        await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    });

    it('a pick in flight: its food reads busy, and the others do nothing', async () => {
        const props = renderPanel({
            inFlight: { kind: 'catalogFood', foodId: 'food_canned', name: 'Applesauce, canned' },
        });

        expect(screen.getByRole('button', { name: 'Applesauce, canned' }).getAttribute('aria-busy')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'apple sauce, homemade' }));

        expect(props.onPick).not.toHaveBeenCalled();
    });

    it('a pick that failed is said assertively, with the list to choose again', () => {
        renderPanel({
            lastPick: {
                pick: { kind: 'catalogFood', foodId: 'food_canned', name: 'Applesauce, canned' },
                outcome: { kind: 'failed' },
            },
        });

        expect(
            Array.from(document.querySelectorAll('[aria-live="assertive"]')).filter(
                (region) => region.textContent === en.candidatePickFailed,
            ),
        ).toHaveLength(1);
        expect(screen.getByLabelText('Which “apple sauce” did you mean?')).toBeTruthy();
    });

    it('nothing arrived: says so, and Try again searches again', async () => {
        const refetch = vi.fn();

        mocks.useIngredientSuggestionSource.mockReturnValue(
            searched({ kind: 'ended', answer: answerOf(), resumed: false }, refetch),
        );
        renderPanel();

        fireEvent.click(screen.getByRole('button', { name: en.statusActionRetry }));

        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('None of these hands the row back to the host and picks nothing', async () => {
        const props = renderPanel();

        fireEvent.click(screen.getByRole('button', { name: en.statusActionNoneOfThese }));

        expect(props.onNoneOfThese).toHaveBeenCalledTimes(1);
        expect(props.onPick).not.toHaveBeenCalled();
    });
});
