/**
 * What the Ingredients section SAYS during a paste, counted (designer condition 2): "Reading N pasted lines." once, when
 * the paste starts, and never a line as it is read; the visible progress block is not a live region. The announcer is the
 * real `usePasteAnnouncement` over the real `pasteProgressOf`, drawn through the section's own polite regions.
 * The editor's "Ingredients complete" (exactly once, on settle) is counted in `RecipeEditorView.test.tsx`.
 */
import { act, cleanup } from '@testing-library/react';
// Its leaves draw through the design system's Tamagui `Text` (ADR-0080), so the tree renders in its provider.
import { render } from '@commise/ui/testing/tamagui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';

import { makeIngredientNutrition, makeIngredientRowEditor, makeLookupRetry } from '../../__fixtures__/index.js';
import { RecipeIngredientsFields } from '../../form/RecipeIngredientsFields.native.js';
import type { PasteReadingRow } from '../../form/props.js';
import { defaultRecipeFormValues } from '../../form/values.js';
import { pasteMilestoneOf, pasteProgressOf } from '../pasteProgress.js';
import { usePasteAnnouncement, PASTE_ANNOUNCE_INTERVAL_MS } from '../usePasteAnnouncement.js';

vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const LINES = 6;
const rowsFrom = (head: number, state: PasteReadingRow['state']): readonly PasteReadingRow[] =>
    Array.from({ length: LINES - head }, (_unused, offset) => ({
        key: `j:${String(head + offset)}`,
        lineIndex: head + offset,
        sourceLine: `${String(head + offset)} cup rice`,
        state: offset === 0 ? state : 'queued',
    }));

/** The section with a paste `done` lines in, its announcer real. */
const Section: FC<{ readonly done: number; readonly state?: PasteReadingRow['state'] }> = ({
    done,
    state = 'reading',
}) => {
    const rows = rowsFrom(done, state);
    const progress = rows.length === 0 ? undefined : pasteProgressOf(rows, done, LINES);
    const announcement = usePasteAnnouncement(
        rows.length === 0 ? undefined : 'job-1',
        progress === undefined ? undefined : pasteMilestoneOf(progress),
        progress === undefined ? 0 : progress.status.kind === 'needsYou' ? progress.status.count : progress.count,
    );

    return (
        <RecipeIngredientsFields
            values={defaultRecipeFormValues()}
            onChange={vi.fn()}
            nutrition={makeIngredientNutrition()}
            lookupRetry={makeLookupRetry()}
            rowEditor={makeIngredientRowEditor()}
            paste={{
                reading: rows,
                progress,
                onRetryLookup: vi.fn(),
                onRetryParse: vi.fn(),
                onAddAsWritten: vi.fn(),
                onAddRestAsWritten: vi.fn(),
                focusSignal: 0,
                retryFailed: false,
                focusRow: undefined,
                onRowFocusHandled: vi.fn(),
                announcement,
                onOpen: undefined,
            }}
        />
    );
};

/** What the polite regions say now, as one list of non-empty texts. */
const spoken = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('[aria-live="polite"]')]
        .map((node) => node.textContent ?? '')
        .filter((text) => text !== '');

describe('the paste’s polite regions while six lines are read one by one', () => {
    it('say "Reading 6 pasted lines." once, and never a line as it is read', async () => {
        const { container, rerender } = render(<Section done={0} />);
        const history: string[] = [];

        const note = () => {
            const now = spoken(container).join(' | ');

            if (now !== '' && history.at(-1) !== now) {
                history.push(now);
            }
        };

        await act(() => vi.advanceTimersByTimeAsync(0));
        note();

        for (let done = 1; done < LINES; done += 1) {
            rerender(<Section done={done} />);
            await act(() => vi.advanceTimersByTimeAsync(PASTE_ANNOUNCE_INTERVAL_MS * 2));
            note();
        }

        expect(history).toEqual(['Reading 6 pasted lines.']);
    });

    it('draw the per-line progress in a block that is not live, so it is never read out as it changes', () => {
        const { container } = render(<Section done={2} />);

        const live = [...container.querySelectorAll('[aria-live], [role="alert"]')];

        expect(live.some((node) => /Reading line|Waiting to read line/u.test(node.textContent ?? ''))).toBe(false);
        expect(container.textContent).toContain('Reading line 3');
    });

    it('say nothing more when the last line joins: the finish belongs to the "Added" region and the editor’s', async () => {
        const { container, rerender } = render(<Section done={5} />);

        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(spoken(container)).toEqual(['Reading 6 pasted lines.']);

        rerender(<Section done={LINES} />);
        await act(() => vi.advanceTimersByTimeAsync(PASTE_ANNOUNCE_INTERVAL_MS * 2));

        expect(spoken(container)).toEqual([]);
    });
});

describe('Reading again after an offline recovery', () => {
    it('is said once per recovery, never on the way back from a stall that cleared by itself', async () => {
        const { container, rerender } = render(<Section done={1} />);
        const history: string[] = [];

        const note = () => {
            const now = spoken(container).join(' | ');

            if (now !== '' && history.at(-1) !== now) {
                history.push(now);
            }
        };

        const step = async (state: PasteReadingRow['state']) => {
            rerender(<Section done={1} state={state} />);
            await act(() => vi.advanceTimersByTimeAsync(PASTE_ANNOUNCE_INTERVAL_MS * 2));
            note();
        };

        await act(() => vi.advanceTimersByTimeAsync(0));
        note();
        await step('waiting');
        await step('reading');
        await step('waiting');
        await step('reading');

        expect(history.filter((text) => text === 'Reading again.')).toHaveLength(2);
        expect(history.filter((text) => /^Reading \d+ pasted lines\.$/u.test(text))).toHaveLength(1);
    });
});
