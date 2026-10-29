// @vitest-environment jsdom
/**
 * Component tests for the web concurrent-edit conflict view — the DEFAULT (options) view (W7 Task 3):
 * the per-side banner (X3, server first), the three A/B/C option cards (X2), and server-first ordering
 * (X7). Also covers the still-relevant field-by-field merge panel (Option C, FR-007c option c) and a
 * minimal changed-fields list rendered from the precomputed `ConflictDiff` (W7 Task 1) — Task 4 replaces
 * the latter with the full marker/legend panel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useState } from 'react';

import type { IngredientVariantPart } from '@kitchensink/recipe-core';

import { commaJoinedTexts } from '../../__tests__/commaJoinedTexts.js';
import { expectDesignSystemButton } from '../../__tests__/designSystemButton.js';
import type { ConflictDiff } from '../conflictDiff.js';
import { makeVersionConflictSide } from '../__fixtures__/index.js';
import { RecipeConflictView } from '../RecipeConflictView.js';
import type { RecipeConflictViewProps } from '../conflictView.js';
import type { RecipeMergeSelections } from '../merge.js';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const noop = () => undefined;

const server = makeVersionConflictSide({
    versionNumber: 6,
    updatedAt: '2026-05-09T14:30:00.000Z',
});
const base = makeVersionConflictSide({ versionNumber: 5 });

const diff: ConflictDiff = {
    rows: [
        {
            key: 'title',
            fieldKind: 'title',
            marker: 'conflict',
            base: 'Weeknight Pasta',
            mine: 'My Draft Title',
            theirs: 'Latest Saved Title',
            mineChanged: true,
            theirsChanged: true,
        },
        {
            key: 'servings',
            fieldKind: 'servings',
            marker: 'changed',
            base: '4',
            mine: '6',
            theirs: '4',
            mineChanged: true,
            theirsChanged: false,
        },
    ],
    hasConflict: true,
    isEmpty: false,
};

/**
 * Freeze the clock 2 minutes after `server.updatedAt` so the banner's relative time is deterministic.
 * `shouldAdvanceTime` lets fake timers still tick in real (sub-millisecond, test-scale) increments —
 * required so React's `act()`/scheduler internals (which schedule via `setTimeout`) can flush during
 * `userEvent` interactions instead of hanging forever on a timer nobody advances.
 */
const freezeClock = (): void => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-05-09T14:32:00.000Z'));
};

function renderConflict(overrides: Partial<RecipeConflictViewProps> = {}) {
    const props: RecipeConflictViewProps = {
        server,
        base,
        diff,
        versionsBehind: 1,
        isResolving: false,
        selections: {},
        onSelectionsChange: noop,
        onKeepServer: noop,
        onOverwrite: noop,
        onMerge: noop,
        onDiscardAndClose: noop,
        ...overrides,
    };
    render(<RecipeConflictView {...props} />);

    return props;
}

/**
 * A stateful wrapper mirroring how a real caller (the `useRecipeEditor` machine) owns `selections` — the
 * view itself is fully controlled and holds no merge data, so a round-trip toggle-then-read test needs a
 * parent that actually applies `onSelectionsChange`.
 */
function ControlledConflict(props: Omit<RecipeConflictViewProps, 'selections' | 'onSelectionsChange'>) {
    const [selections, setSelections] = useState<RecipeMergeSelections>({});

    return <RecipeConflictView {...props} selections={selections} onSelectionsChange={setSelections} />;
}

function renderControlledConflict(
    overrides: Partial<Omit<RecipeConflictViewProps, 'selections' | 'onSelectionsChange'>> = {},
) {
    const props: Omit<RecipeConflictViewProps, 'selections' | 'onSelectionsChange'> = {
        server,
        base,
        diff,
        versionsBehind: 1,
        isResolving: false,
        onKeepServer: noop,
        onOverwrite: noop,
        onMerge: noop,
        onDiscardAndClose: noop,
        ...overrides,
    };
    render(<ControlledConflict {...props} />);

    return props;
}

describe('RecipeConflictView (web) — structure', () => {
    it('renders the conflict heading', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
    });
});

describe('RecipeConflictView (web) — no version-number banner', () => {
    it('draws no per-side banner and no version numbers: the cards carry the two sides', () => {
        freezeClock();
        renderConflict();

        expect(screen.queryByText(/Server version/)).toBeNull();
        expect(screen.queryByText(/local unsaved changes/)).toBeNull();
        expect(screen.queryByText(/\bv\d+\b/)).toBeNull();
    });

    /**
     * REWRITTEN for the 2026-08-26 owner ruling that deleted device attribution. This guard used to fire its
     * markup payload at the server side's device label. That field is gone and the banner now renders only a
     * version NUMBER and a formatted relative time — neither user-controlled — so aiming the payload there
     * would have made the case vacuous. It is re-aimed at a diff ROW VALUE instead, which is the untrusted
     * recipe text this surface still renders, so the conflict view keeps an XSS guard rather than losing one.
     */
    it('escapes an untrusted diff value as text — renders no element from it', () => {
        freezeClock();
        const { container } = render(
            <RecipeConflictView
                {...({
                    server,
                    base,
                    diff: {
                        ...diff,
                        rows: [{ ...diff.rows[0]!, theirs: '<img src=x onerror=alert(1)>' }],
                    },
                    versionsBehind: 1,
                    isResolving: false,
                    selections: {},
                    onSelectionsChange: noop,
                    onKeepServer: noop,
                    onOverwrite: noop,
                    onMerge: noop,
                    onDiscardAndClose: noop,
                } satisfies RecipeConflictViewProps)}
            />,
        );

        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});

describe('RecipeConflictView (web) — "Discard and close" header exit (wireframe gap #1)', () => {
    it('renders the control, addressable by role/name, in the default (options) view', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByRole('button', { name: 'Discard and close' })).toBeTruthy();
    });

    it('clicking it invokes onDiscardAndClose and fires none of the resolution callbacks', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onDiscardAndClose = vi.fn();
        const onKeepServer = vi.fn();
        const onOverwrite = vi.fn();
        const onMerge = vi.fn();
        renderConflict({ onDiscardAndClose, onKeepServer, onOverwrite, onMerge });

        await user.click(screen.getByRole('button', { name: 'Discard and close' }));

        expect(onDiscardAndClose).toHaveBeenCalledTimes(1);
        expect(onKeepServer).not.toHaveBeenCalled();
        expect(onOverwrite).not.toHaveBeenCalled();
        expect(onMerge).not.toHaveBeenCalled();
    });

    it('stays enabled while isResolving — UNLIKE the three option cards, it is never disabled', () => {
        freezeClock();
        renderConflict({ isResolving: true });

        const discard = screen.getByRole<HTMLButtonElement>('button', { name: 'Discard and close' });
        expect(discard.disabled).toBe(false);
    });

    it('also renders in the merge panel (Option C), so it is reachable from every sub-view', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onDiscardAndClose = vi.fn();
        renderConflict({ onDiscardAndClose });

        await user.click(screen.getByRole('button', { name: 'Compare' }));
        expect(screen.getByRole('heading', { name: 'Compare and choose' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Discard and close' }));
        expect(onDiscardAndClose).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeConflictView (web) — two-column per-side summary cards (wireframe gap #2)', () => {
    // A distinct `updatedAt` on `base` (the fixture default otherwise matches `server`'s own timestamp) so
    // the SERVER and YOUR-version cards' Saved lines are individually addressable, not two identical
    // strings. The cards' "Device:" row went with the 2026-08-26 owner ruling.
    const distinctBase = { ...base, updatedAt: '2026-05-08T10:00:00.000Z' };

    it('renders the THEIRS card with its heading and saved time', () => {
        freezeClock();
        renderConflict({ base: distinctBase });

        expect(screen.getByText('Saved elsewhere')).toBeTruthy();
        expect(screen.getByText('May 9, 2026, 2:30 PM')).toBeTruthy();
        // The 2026-08-26 ruling removed the card's device row; nothing on a card may reintroduce it.
        expect(screen.queryByText(/^Device:/)).toBeNull();
    });

    it('renders the YOURS card from `base`: "Your changes", not saved yet, started from the base time', () => {
        freezeClock();
        renderConflict({ base: distinctBase });

        expect(screen.getByText('Your changes')).toBeTruthy();
        expect(screen.getByText('Not saved yet. Started from May 8, 2026, 10:00 AM')).toBeTruthy();
    });

    it('renders the THEIRS card BEFORE the YOURS card (X7 — server-first ordering)', () => {
        freezeClock();
        renderConflict();

        const theirsHeading = screen.getByText('Saved elsewhere');
        const yoursHeading = screen.getByText('Your changes');

        expect(theirsHeading.compareDocumentPosition(yoursHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('says only "Not saved yet" on the YOURS card when base is undefined (evicted)', () => {
        freezeClock();
        renderConflict({ base: undefined });

        expect(screen.getByText('Your changes')).toBeTruthy();
        expect(screen.getByText('Not saved yet')).toBeTruthy();
        expect(screen.queryByText(/Started from/)).toBeNull();
    });
});

describe('RecipeConflictView (web) — A/B/C option cards (X2)', () => {
    it('leads with Compare, then Keep mine, then Use theirs (owner ruling T5, 2026-10-29)', () => {
        freezeClock();
        renderConflict();

        const options = ['Compare', 'Keep mine', 'Use theirs'];
        const order = screen
            .getAllByRole('button')
            .map((button) => button.textContent ?? '')
            .map((text) => options.find((name) => text.includes(name)))
            .filter((name): name is string => name !== undefined);

        expect(order).toEqual(options);
    });

    it('renders all three option cards with a title and description', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByRole('button', { name: 'Use theirs' })).toBeTruthy();
        expect(screen.getByText('Use the version saved elsewhere. Your changes here are dropped.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Keep mine' })).toBeTruthy();
        expect(screen.getByText('Save your changes. They replace the version saved elsewhere.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy();
        expect(screen.getByText('See each change side by side, then choose.')).toBeTruthy();
    });

    it('Use theirs fires onKeepServer', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onKeepServer = vi.fn();
        renderConflict({ onKeepServer });

        await user.click(screen.getByRole('button', { name: 'Use theirs' }));

        expect(onKeepServer).toHaveBeenCalledTimes(1);
    });

    it('Keep mine fires onOverwrite', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onOverwrite = vi.fn();
        renderConflict({ onOverwrite });

        await user.click(screen.getByRole('button', { name: 'Keep mine' }));

        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('Compare enters the merge panel', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        renderConflict();

        await user.click(screen.getByRole('button', { name: 'Compare' }));

        expect(screen.getByRole('heading', { name: 'Compare and choose' })).toBeTruthy();
    });
});

describe('RecipeConflictView (web) — isResolving disables the resolver while a resolve is in flight (double-submit fix)', () => {
    /**
     * REWRITTEN from native `disabled`: the control the cook just pressed goes busy, and a real browser drops focus
     * to <body> the moment a focused control is natively disabled (WCAG 2.2 SC 2.4.3). It stays focusable and
     * `aria-disabled` (`busyControlProps`), and the press is refused — so every card is refused, not just marked.
     */
    it('busies all three option cards while isResolving, focusable and refusing every press', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onKeepServer = vi.fn();
        const onOverwrite = vi.fn();
        renderConflict({ isResolving: true, onKeepServer, onOverwrite });

        for (const name of ['Use theirs', 'Keep mine', 'Compare']) {
            const card = screen.getByRole<HTMLButtonElement>('button', { name });
            expect(card.disabled).toBe(false);
            expect(card.getAttribute('aria-disabled')).toBe('true');
            await user.click(card);
        }

        expect(onKeepServer).not.toHaveBeenCalled();
        expect(onOverwrite).not.toHaveBeenCalled();
        expect(screen.queryByRole('heading', { name: 'Compare and choose' })).toBeNull();
    });

    it('a double-click on Overwrite while isResolving fires onOverwrite at most once (the second click is a no-op because disabled)', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onOverwrite = vi.fn();
        renderConflict({ onOverwrite });

        const overwrite = screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' });
        await user.click(overwrite);
        expect(onOverwrite).toHaveBeenCalledTimes(1);

        // The resolve is now in flight — the caller (`useRecipeEditor`) re-renders this FULLY controlled view
        // with `isResolving: true` before the click handler could possibly run again in real usage; assert
        // the SAME button, now disabled, swallows a second click instead of firing a second resolve.
        cleanup();
        renderConflict({ onOverwrite, isResolving: true });
        await user.click(screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' }));

        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('does not disable the option cards when isResolving is false and nothing else gates them', () => {
        freezeClock();
        renderConflict({ isResolving: false });

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use theirs' }).disabled).toBe(false);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' }).disabled).toBe(false);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Compare' }).disabled).toBe(false);
    });

    it('disables "Save my choices" while isResolving, combined with (not replacing) the selection + stale-base gates', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onMerge = vi.fn();
        // Enter the merge panel and select a field while NOT resolving (entering merge mode is itself gated
        // on `isResolving`), then flip to resolving on the SAME instance — mirrors the real flow where the
        // caller sets `isResolving` only once a resolve is actually submitted.
        const { rerender } = render(
            <ControlledConflict
                server={server}
                base={base}
                diff={diff}
                versionsBehind={1}
                isResolving={false}
                onKeepServer={noop}
                onOverwrite={noop}
                onMerge={onMerge}
                onDiscardAndClose={noop}
            />,
        );
        await user.click(screen.getByRole('button', { name: 'Compare' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        await user.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        rerender(
            <ControlledConflict
                server={server}
                base={base}
                diff={diff}
                versionsBehind={1}
                isResolving
                onKeepServer={noop}
                onOverwrite={noop}
                onMerge={onMerge}
                onDiscardAndClose={noop}
            />,
        );

        const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save my choices' });
        // REWRITTEN from `disabled`: Save is the control just pressed, so it keeps focus while busy (SC 2.4.3).
        expect(save.disabled).toBe(false);
        expect(save.getAttribute('aria-disabled')).toBe('true');

        await user.click(save);
        expect(onMerge).not.toHaveBeenCalled();
    });

    it('a double-click on Save my choices while resolving fires onMerge at most once', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onMerge = vi.fn();
        // Same mounted instance throughout (via `rerender`), NOT a remount — mirrors the real flow where the
        // caller flips `isResolving` on the SAME conflict while the merge panel + selections stay live.
        const { rerender } = render(
            <ControlledConflict
                server={server}
                base={base}
                diff={diff}
                versionsBehind={1}
                isResolving={false}
                onKeepServer={noop}
                onOverwrite={noop}
                onMerge={onMerge}
                onDiscardAndClose={noop}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Compare' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        await user.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save my choices' });
        await user.click(save);
        expect(onMerge).toHaveBeenCalledTimes(1);

        // The resolve is now in flight — re-render with `isResolving: true`, same as the real caller would;
        // a second click on the now-disabled button must be a no-op.
        rerender(
            <ControlledConflict
                server={server}
                base={base}
                diff={diff}
                versionsBehind={1}
                isResolving
                onKeepServer={noop}
                onOverwrite={noop}
                onMerge={onMerge}
                onDiscardAndClose={noop}
            />,
        );
        await user.click(screen.getByRole<HTMLButtonElement>('button', { name: 'Save my choices' }));

        expect(onMerge).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeConflictView (web) — changed-only diff panel with word badges (W7 Task 4 / X1)', () => {
    const changedOnlyDiff: ConflictDiff = {
        rows: [
            {
                key: 'title',
                fieldKind: 'title',
                marker: 'changed',
                base: 'Weeknight Pasta',
                mine: 'My Draft Title',
                theirs: 'Weeknight Pasta',
                mineChanged: true,
                theirsChanged: false,
            },
            {
                key: 'servings',
                fieldKind: 'servings',
                marker: 'conflict',
                base: '4',
                mine: '6',
                theirs: '8',
                mineChanged: true,
                theirsChanged: true,
            },
        ],
        hasConflict: true,
        isEmpty: false,
    };

    it('renders EXACTLY the diff’s changed-only rows — an unchanged field (Description) is absent', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.getByText('Title')).toBeTruthy();
        expect(screen.getByText('Servings')).toBeTruthy();
        expect(screen.queryByText('Description')).toBeNull();
    });

    it('renders the Server value BEFORE the Yours value on each row (X7 — the Task-3 placeholder had this backwards)', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        const serverValue = screen.getByText('Theirs: Weeknight Pasta');
        const mineValue = screen.getByText('Yours: My Draft Title');

        expect(serverValue.compareDocumentPosition(mineValue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders the "was" base value when the row carries one', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.getByText('Before: Weeknight Pasta')).toBeTruthy();
        expect(screen.getByText('Before: 4')).toBeTruthy();
    });

    it('omits the "was" line when a row carries no base (base-evicted 2-way fallback)', () => {
        freezeClock();
        const fallbackDiff: ConflictDiff = {
            rows: [
                {
                    key: 'title',
                    fieldKind: 'title',
                    marker: 'conflict',
                    mine: 'My Draft Title',
                    theirs: 'Latest Saved Title',
                    mineChanged: true,
                    theirsChanged: true,
                },
            ],
            hasConflict: true,
            isEmpty: false,
        };
        renderConflict({ diff: fallbackDiff });

        expect(screen.queryByText(/^Before:/)).toBeNull();
    });

    it('marks a `changed` row with the visible word "Changed" (text, not colour or a glyph)', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.getByText('Changed')).toBeTruthy();
    });

    it('marks a `conflict` row with the visible word "Both changed", distinct from "Changed"', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.getByText('Both changed')).toBeTruthy();
        // The word badge replaced the glyph: no stray accessible-image nodes and no `[→]` / `[!!]` glyphs.
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByText(/\[(→|!!|=)\]/)).toBeNull();
    });

    it('draws no legend: the badges are words, so there is nothing to decode', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
        expect(screen.queryByText('Legend')).toBeNull();
    });

    it('includes the step’s position in a per-element step row’s label', () => {
        freezeClock();
        const stepDiff: ConflictDiff = {
            rows: [
                {
                    key: 'steps[2]',
                    fieldKind: 'step',
                    marker: 'changed',
                    base: 'Add kale and cook until wilted',
                    mine: 'Add spinach and cook until wilted',
                    theirs: 'Add kale and cook until wilted',
                    mineChanged: true,
                    theirsChanged: false,
                },
            ],
            hasConflict: false,
            isEmpty: false,
        };
        renderConflict({ diff: stepDiff });

        expect(screen.getByText('Step 3')).toBeTruthy();
    });

    it('includes the ingredient’s identity in a per-element ingredient row’s label', () => {
        freezeClock();
        const ingredientDiff: ConflictDiff = {
            rows: [
                {
                    key: 'ingredients:ing_1',
                    fieldKind: 'ingredient',
                    marker: 'changed',
                    base: '200g Pasta',
                    mine: '250g Pasta',
                    theirs: '200g Pasta',
                    mineChanged: true,
                    theirsChanged: false,
                },
            ],
            hasConflict: false,
            isEmpty: false,
        };
        renderConflict({ diff: ingredientDiff });

        expect(screen.getByText('Ingredient: 200g Pasta')).toBeTruthy();
    });

    it('renders a defensive "no differences" message when diff.rows is empty, instead of an empty panel', () => {
        freezeClock();
        renderConflict({ diff: { rows: [], hasConflict: false, isEmpty: true } });

        expect(screen.getByText('No differences to show.')).toBeTruthy();
        expect(screen.queryByText('Changed')).toBeNull();
    });
});

describe('RecipeConflictView (web) — per-element merge (Option C, W7 Task 5)', () => {
    const enterMerge = async (user: UserEvent) => {
        await user.click(screen.getByRole('button', { name: 'Compare' }));
    };

    it('lists ONLY the changed fields/elements from diff.rows — an unchanged field never appears', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        renderControlledConflict();
        await enterMerge(user);

        expect(screen.getByRole('heading', { name: 'Compare and choose' })).toBeTruthy();
        expect(screen.getByRole('radiogroup', { name: 'Title' })).toBeTruthy();
        expect(screen.getByRole('radiogroup', { name: 'Servings' })).toBeTruthy();
        // The fixture `diff` carries exactly 2 rows — no extra field (e.g. Description) is invented.
        expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
        expect(screen.queryByRole('radiogroup', { name: 'Description' })).toBeNull();
    });

    it('renders Server BEFORE Your version within a row (X7 — server-first radio order)', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        renderControlledConflict();
        await enterMerge(user);

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        const radios = within(titleGroup).getAllByRole('radio');

        expect(radios).toHaveLength(2);
        expect((radios[0] as HTMLInputElement).labels?.[0]?.textContent).toBe('Theirs: Latest Saved Title');
        expect((radios[1] as HTMLInputElement).labels?.[0]?.textContent).toBe('Yours: My Draft Title');
    });

    it('starts with NEITHER radio checked — nothing is auto-selected', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        renderControlledConflict();
        await enterMerge(user);

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        expect(
            (
                within(titleGroup).getByRole('radio', {
                    name: 'Theirs: Latest Saved Title',
                }) as HTMLInputElement
            ).checked,
        ).toBe(false);
        expect(
            (within(titleGroup).getByRole('radio', { name: 'Yours: My Draft Title' }) as HTMLInputElement).checked,
        ).toBe(false);
    });

    it('selecting a row builds the selections and updates the running summary', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        renderControlledConflict();
        await enterMerge(user);

        expect(screen.getByText('Picked: 0 from theirs, 0 from yours')).toBeTruthy();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        await user.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        expect((within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }) as HTMLInputElement).checked).toBe(
            true,
        );
        expect(screen.getByText('Picked: 1 from theirs, 0 from yours')).toBeTruthy();

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        await user.click(within(titleGroup).getByRole('radio', { name: 'Yours: My Draft Title' }));

        expect(screen.getByText('Picked: 1 from theirs, 1 from yours')).toBeTruthy();
    });

    it('gating (X5): Save my choices is disabled with zero selections, and clicking it fires nothing', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        await enterMerge(user);

        const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save my choices' });
        expect(save.disabled).toBe(true);
        expect(screen.getByText('Pick at least one change to save.')).toBeTruthy();

        await user.click(save);

        expect(onMerge).not.toHaveBeenCalled();
    });

    it('gating (X5): Save my choices enables after one selection and fires onMerge with it', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        await enterMerge(user);

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        await user.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save my choices' });
        expect(save.disabled).toBe(false);
        expect(screen.queryByText('Pick at least one change to save.')).toBeNull();

        await user.click(save);

        expect(onMerge).toHaveBeenCalledTimes(1);
        expect(onMerge).toHaveBeenCalledWith({ servings: 'theirs' });
    });

    it('is a pure pass-through over the given selections prop — reads exactly what it is given', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onMerge = vi.fn();
        renderConflict({ onMerge, selections: { title: 'theirs' } });
        await enterMerge(user);

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        expect(
            (
                within(titleGroup).getByRole('radio', {
                    name: 'Theirs: Latest Saved Title',
                }) as HTMLInputElement
            ).checked,
        ).toBe(true);

        await user.click(screen.getByRole('button', { name: 'Save my choices' }));

        expect(onMerge).toHaveBeenCalledWith({ title: 'theirs' });
    });

    it('resets selections and returns to the three options via back', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onSelectionsChange = vi.fn();
        renderConflict({ onSelectionsChange, selections: { title: 'theirs' } });
        await enterMerge(user);

        await user.click(screen.getByRole('button', { name: 'Back to options' }));

        expect(onSelectionsChange).toHaveBeenCalledWith({});
        expect(screen.getByRole('button', { name: 'Use theirs' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Compare and choose' })).toBeNull();
    });
});

describe('RecipeConflictView (web) — stale-base warning + confirm gate (W7 Task 5 / X6)', () => {
    it('renders NO warning for a normal case (base present, versionsBehind <= 10)', () => {
        freezeClock();
        renderConflict({ versionsBehind: 5 });

        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' }).disabled).toBe(false);
    });

    it('renders the warning + blocks Overwrite until confirmed when versionsBehind > 10', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onOverwrite = vi.fn();
        renderConflict({ versionsBehind: 11, onOverwrite });

        expect(screen.getByRole('alert')).toBeTruthy();
        const overwrite = screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' });
        expect(overwrite.disabled).toBe(true);

        await user.click(overwrite);
        expect(onOverwrite).not.toHaveBeenCalled();

        await user.click(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }));
        expect(overwrite.disabled).toBe(false);

        await user.click(overwrite);
        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    // One sentence serves both causes (the server is far ahead, or the base fell out of history), so it must not claim
    // a count: with a dropped base and `versionsBehind: 1` "Many changes" would be false.
    it.each([
        ['the server is more than 10 versions ahead', { versionsBehind: 11 }],
        ['the base was dropped from history, with only one version behind', { base: undefined, versionsBehind: 1 }],
    ])('says the same true thing when %s', (_cause, props) => {
        freezeClock();
        renderConflict(props);

        const text = screen.getByRole('alert').textContent ?? '';
        expect(text).toContain('Some changes saved elsewhere can’t be shown here.');
        expect(text).toContain('Keeping yours or comparing may undo changes you can’t see.');
        expect(text).not.toContain('Many changes');
    });

    it('renders the warning when base is undefined, even with a LOW versionsBehind (unreliable alone)', () => {
        freezeClock();
        renderConflict({ base: undefined, versionsBehind: 1 });

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' }).disabled).toBe(true);
    });

    it('keeps a stale-blocked Overwrite natively disabled while another option resolves — out of the tab order', () => {
        // The cook cannot have pressed a blocked card, so the in-flight resolve belongs to another option and
        // the blocked card has no focus to keep. Busy must not promote it to a focusable `aria-disabled` control:
        // if the resolve then failed with focus on it, the card would become natively disabled under the cursor.
        freezeClock();
        renderConflict({ versionsBehind: 11, isResolving: true });

        const overwrite = screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' });
        expect(overwrite.disabled).toBe(true);
        expect(overwrite.getAttribute('aria-disabled')).toBeNull();
        expect(overwrite.getAttribute('aria-busy')).toBeNull();
    });

    it('dims a busy card and a blocked card to the same level, so one screen shows one "unavailable"', () => {
        freezeClock();
        renderConflict({ versionsBehind: 11, isResolving: true });

        const overwrite = screen.getByRole('button', { name: 'Keep mine' });
        const keepServer = screen.getByRole('button', { name: 'Use theirs' });
        expect(overwrite.className).toContain('disabled:opacity-50');
        expect(keepServer.className).toContain('aria-disabled:opacity-50');
        expect(keepServer.className).not.toContain('aria-disabled:opacity-60');
    });

    it('blocks Save my choices in the merge panel until confirmed, alongside the selection gate', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge, versionsBehind: 11 });
        await user.click(screen.getByRole('button', { name: 'Compare' }));

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        await user.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save my choices' });
        expect(save.disabled).toBe(true);
        await user.click(save);
        expect(onMerge).not.toHaveBeenCalled();

        await user.click(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }));
        expect(save.disabled).toBe(false);

        await user.click(save);
        expect(onMerge).toHaveBeenCalledTimes(1);
    });

    it('resets staleConfirmed AND the merge panel — re-blocking Overwrite until re-confirmed — when a SECOND, still-stale conflict arrives on the same instance (X6 robustness gap)', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        const onOverwrite = vi.fn();
        const firstProps: RecipeConflictViewProps = {
            server,
            base,
            diff,
            versionsBehind: 11,
            isResolving: false,
            selections: {},
            onSelectionsChange: noop,
            onKeepServer: noop,
            onOverwrite,
            onMerge: noop,
            onDiscardAndClose: noop,
        };
        const { rerender } = render(<RecipeConflictView {...firstProps} />);

        // Enter the merge panel for the FIRST conflict and confirm its stale-base warning there (the same
        // shared checkbox gates Save my choices).
        await user.click(screen.getByRole('button', { name: 'Compare' }));
        expect(screen.getByRole('heading', { name: 'Compare and choose' })).toBeTruthy();
        await user.click(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }));
        expect(
            screen.getByRole<HTMLInputElement>('checkbox', { name: 'I understand. Let me choose anyway' }).checked,
        ).toBe(true);

        // A SECOND, still-stale conflict lands on the SAME component instance (new props, e.g. a retried
        // Overwrite that 409'd again) — a different server versionNumber identifies it as a NEW conflict.
        const secondServer = makeVersionConflictSide({ versionNumber: 9, updatedAt: '2026-05-09T15:00:00.000Z' });
        rerender(<RecipeConflictView {...firstProps} server={secondServer} />);

        // The merge panel toggle resets — a NEW conflict restarts at the options view.
        expect(screen.queryByRole('heading', { name: 'Compare and choose' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();

        // The confirm checkbox is UNCHECKED again, and Overwrite is BLOCKED until re-confirmed for THIS
        // conflict — the stale checkbox state must not survive across conflicts.
        expect(
            screen.getByRole<HTMLInputElement>('checkbox', { name: 'I understand. Let me choose anyway' }).checked,
        ).toBe(false);
        const overwrite = screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' });
        expect(overwrite.disabled).toBe(true);

        await user.click(overwrite);
        expect(onOverwrite).not.toHaveBeenCalled();

        await user.click(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }));
        expect(overwrite.disabled).toBe(false);
        await user.click(overwrite);
        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });
});

/**
 * Curated U15 (`docs/design/ingredientSpecialization.md` §S1, R25, R27): an ingredient row draws each side's dotted line
 * under that side's value, and a name that includes a variant-bound value includes all its parts. The rows below are
 * the shapes `computeConflictDiff` produces: one identity whose sides froze the same parts, one whose sides froze
 * different parts, one side of a rebind (the other side has no such line), and a line whose cook-written words hold a
 * comma-joined phrase — the comma detector's positive control. The native mirror asserts the same set.
 */
describe('RecipeConflictView (web) — a variant-bound ingredient row (curated U15)', () => {
    const FLAT: readonly IngredientVariantPart[] = [
        { attribute: 'cut', text: 'flat half' },
        { attribute: 'grade', text: 'select' },
    ];
    const flat = ['flat half', 'select'] as const;
    const variantDiff: ConflictDiff = {
        rows: [
            {
                key: 'ingredients:ing_flat',
                fieldKind: 'ingredient',
                marker: 'conflict',
                base: '2 lb beef brisket',
                mine: '3 lb beef brisket',
                theirs: '4 lb beef brisket',
                mineChanged: true,
                theirsChanged: true,
                baseVariantParts: flat,
                mineVariantParts: flat,
                theirsVariantParts: flat,
            },
            {
                key: 'ingredients:ing_chuck',
                fieldKind: 'ingredient',
                marker: 'conflict',
                base: '1 lb beef chuck',
                mine: '2 lb beef chuck',
                theirs: '5 lb beef chuck',
                mineChanged: true,
                theirsChanged: true,
                mineVariantParts: ['boneless'],
                theirsVariantParts: ['boneless', 'choice'],
            },
            {
                key: 'ingredients:ing_point',
                fieldKind: 'ingredient',
                marker: 'changed',
                mine: '',
                theirs: '6 lb beef brisket',
                mineChanged: false,
                theirsChanged: true,
                theirsVariantParts: ['point half', 'choice'],
            },
            {
                key: 'ingredients:ing_butter',
                fieldKind: 'ingredient',
                marker: 'changed',
                base: '200 g Butter',
                mine: '200 g Butter (flat half, select)',
                theirs: '200 g Butter',
                mineChanged: true,
                theirsChanged: false,
            },
        ],
        hasConflict: true,
        isEmpty: false,
    };
    const fallbackDiff: ConflictDiff = {
        rows: [
            {
                key: 'ingredients:ing_flat',
                fieldKind: 'ingredient',
                marker: 'conflict',
                mine: '3 lb beef brisket',
                theirs: '4 lb beef brisket',
                mineChanged: true,
                theirsChanged: true,
                mineVariantParts: flat,
                theirsVariantParts: ['flat half', 'choice'],
            },
        ],
        hasConflict: true,
        isEmpty: false,
    };

    /** The parts shown under `root`, in document order: each part is a `lang="en"` span of the dotted line. */
    const shownParts = (root: Element): readonly (string | null)[] =>
        Array.from(root.querySelectorAll('[lang="en"]')).map((part) => part.textContent);

    /** The block that holds one side's value text and its dotted line. */
    const sideOf = (text: string): HTMLElement => {
        const side = screen.getByText(text).parentElement;

        if (side === null) {
            throw new Error(`No side holds "${text}".`);
        }

        return side;
    };

    /** The `<label>` an option's text and dotted line sit in. */
    const labelOf = (radio: HTMLInputElement): HTMLLabelElement => {
        const label = radio.labels?.[0];

        if (label === undefined) {
            throw new Error('The radio has no label.');
        }

        return label;
    };

    /** The diff-panel list item that holds `text`. */
    const itemOf = (text: string): HTMLElement => {
        const item = screen.getByText(text).closest('li');

        if (item === null) {
            throw new Error(`No list item holds "${text}".`);
        }

        return item;
    };

    describe('the changed-fields panel', () => {
        it('draws each side its own dotted line, under its value, when every side froze the same parts', () => {
            freezeClock();
            renderConflict({ diff: variantDiff });

            expect(shownParts(sideOf('Before: 2 lb beef brisket'))).toEqual(['flat half', 'select']);
            expect(shownParts(sideOf('Theirs: 4 lb beef brisket'))).toEqual(['flat half', 'select']);
            expect(shownParts(sideOf('Yours: 3 lb beef brisket'))).toEqual(['flat half', 'select']);
            const value = screen.getByText('Theirs: 4 lb beef brisket');
            const firstPart = sideOf('Theirs: 4 lb beef brisket').querySelector('[lang="en"]');
            expect(firstPart === null ? 0 : value.compareDocumentPosition(firstPart)).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
        });

        it('shows each side the parts IT froze when the sides differ, and none under a base that froze none', () => {
            freezeClock();
            renderConflict({ diff: variantDiff });

            expect(shownParts(sideOf('Before: 1 lb beef chuck'))).toEqual([]);
            expect(shownParts(sideOf('Theirs: 5 lb beef chuck'))).toEqual(['boneless', 'choice']);
            expect(shownParts(sideOf('Yours: 2 lb beef chuck'))).toEqual(['boneless']);
        });

        it('draws no dotted line for a side that has no such line', () => {
            freezeClock();
            renderConflict({ diff: variantDiff });

            // The side that holds the line shows its parts, and the row shows nothing else: none under the empty side.
            expect(shownParts(sideOf('Theirs: 6 lb beef brisket'))).toEqual(['point half', 'choice']);
            expect(shownParts(itemOf('Theirs: 6 lb beef brisket'))).toEqual(['point half', 'choice']);
        });

        it('draws mine and theirs, and no "Was" line, on a base-evicted row', () => {
            freezeClock();
            renderConflict({ diff: fallbackDiff });

            expect(screen.queryByText(/^Before:/)).toBeNull();
            expect(shownParts(sideOf('Theirs: 4 lb beef brisket'))).toEqual(['flat half', 'choice']);
            expect(shownParts(sideOf('Yours: 3 lb beef brisket'))).toEqual(['flat half', 'select']);
        });

        it('finds a comma-joined label in the cook’s own words (the control), and none from a dotted line', () => {
            freezeClock();
            renderConflict({ diff: variantDiff });

            expect(commaJoinedTexts(itemOf('Yours: 200 g Butter (flat half, select)'), FLAT)).toHaveLength(1);
            expect(commaJoinedTexts(itemOf('Yours: 3 lb beef brisket'), FLAT)).toEqual([]);
        });
    });

    describe('the merge panel', () => {
        const enterMerge = async (user: UserEvent) => {
            await user.click(screen.getByRole('button', { name: 'Compare' }));
        };

        it('names each option with its own side’s parts and draws them under its value inside the option', async () => {
            freezeClock();
            const user = userEvent.setup({ delay: null });
            renderControlledConflict({ diff: variantDiff });
            await enterMerge(user);

            const group = screen.getByRole('radiogroup', { name: 'Ingredient: 5 lb beef chuck, boneless, choice' });
            const server = within(group).getByRole('radio', {
                name: 'Theirs: 5 lb beef chuck, boneless, choice',
            }) as HTMLInputElement;
            const mine = within(group).getByRole('radio', {
                name: 'Yours: 2 lb beef chuck, boneless',
            }) as HTMLInputElement;

            expect(shownParts(labelOf(server))).toEqual(['boneless', 'choice']);
            expect(shownParts(labelOf(mine))).toEqual(['boneless']);
        });

        it('keeps the visible legend plain: the parts are in the name and under the options, never in the legend', async () => {
            freezeClock();
            const user = userEvent.setup({ delay: null });
            renderControlledConflict({ diff: variantDiff });
            await enterMerge(user);

            const group = screen.getByRole('radiogroup', { name: 'Ingredient: 4 lb beef brisket, flat half, select' });

            expect(group.querySelector('legend')?.textContent).toBe('Ingredient: 4 lb beef brisket');
        });

        it('names a rebind row by the side that holds the line, and the empty side by its value alone', async () => {
            freezeClock();
            const user = userEvent.setup({ delay: null });
            renderControlledConflict({ diff: variantDiff });
            await enterMerge(user);

            const group = screen.getByRole('radiogroup', {
                name: 'Ingredient: 6 lb beef brisket, point half, choice',
            });
            const radios = within(group).getAllByRole('radio') as HTMLInputElement[];

            expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
                'Theirs: 6 lb beef brisket, point half, choice',
                'Yours: ',
            ]);
            expect(shownParts(group)).toEqual(['point half', 'choice']);
        });

        it('shows no comma-joined label inside an option, while the cook’s own comma-joined words still read', async () => {
            freezeClock();
            const user = userEvent.setup({ delay: null });
            renderControlledConflict({ diff: variantDiff });
            await enterMerge(user);

            const brisket = screen.getByRole('radiogroup', {
                name: 'Ingredient: 4 lb beef brisket, flat half, select',
            });
            const butter = screen.getByRole('radiogroup', { name: 'Ingredient: 200 g Butter' });

            expect(commaJoinedTexts(butter, FLAT)).toHaveLength(1);
            expect(commaJoinedTexts(brisket, FLAT)).toEqual([]);
        });
    });
});

describe('RecipeConflictView (web) — the design-system Button (UI overhaul slice 2)', () => {
    it('saves a merge through a primary check Button, and leaves it through a secondary chevronLeft one', async () => {
        freezeClock();
        const user = userEvent.setup({ delay: null });
        renderConflict();

        await user.click(screen.getByRole('button', { name: 'Compare' }));

        expectDesignSystemButton(screen.getByRole('button', { name: 'Save my choices' }), 'primary', 'check');
        expectDesignSystemButton(screen.getByRole('button', { name: 'Back to options' }), 'secondary', 'chevron-left');
    });
});

/**
 * A never-published draft records no versions (ADR-0058), so its 409 has no `base`. Without `neverPublished` the view
 * would show "Your version" with an evicted-history warning and block Overwrite behind it — each of which is false for
 * a draft. These assertions fail if the prop is dropped anywhere between the leaf and `conflictCopyOf`.
 */
describe('RecipeConflictView (web) — a never-published draft', () => {
    it('uses the same side words as every conflict, never "theirs" for the other save (owner ruling T6)', () => {
        freezeClock();
        renderConflict({ base: undefined, versionsBehind: 6, neverPublished: true });

        expect(screen.getByText('Saved elsewhere')).toBeTruthy();
        expect(screen.getByText('Your changes')).toBeTruthy();
        expect(screen.queryByText(/theirs/i, { selector: 'h1, h2, h3, p' })).toBeNull();
    });

    it('speaks of a draft saved elsewhere, with no version numbers and no stale-base gate', () => {
        freezeClock();
        renderConflict({ base: undefined, versionsBehind: 6, neverPublished: true });

        expect(screen.getByRole('heading', { name: 'This draft changed somewhere else' })).toBeTruthy();
        expect(screen.getByText('Saved elsewhere')).toBeTruthy();
        expect(screen.getByText('Not saved yet')).toBeTruthy();
        expect(screen.getByText('Your changes')).toBeTruthy();
        expect(screen.queryByText(/v6/)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Keep mine' }).disabled).toBe(false);
    });
});
