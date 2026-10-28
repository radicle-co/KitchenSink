/**
 * Native component tests for the concurrent-edit conflict view — the DEFAULT (options) view (W7 Task 3),
 * rendered via react-native-web under jsdom. Mirrors the web leaf: the per-side banner (X3, server first),
 * the three A/B/C option cards (X2), server-first ordering (X7), the still-relevant field-by-field merge
 * panel, and the minimal changed-fields list — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState } from 'react';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { spokenVariantParts } from '@commise/ui/variant-parts-line';
import type { IngredientVariantPart } from '@kitchensink/recipe-core';

import { commaJoinedTexts } from '../../__tests__/commaJoinedTexts.js';
import { conflictSideParts, type ConflictDiff } from '../conflictDiff.js';
import { makeVersionConflictSide } from '../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeConflictView } from '../RecipeConflictView.native.js';
import { recipeVersionMessages } from '../messages.js';
import { expectNativeDesignSystemButton } from '../../__tests__/nativeDesignSystemButton.js';
import type { RecipeConflictViewProps } from '../conflictView.js';
import type { RecipeMergeSelections } from '../merge.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    systemScheme.current = null;
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

/** Freeze the clock 2 minutes after `server.updatedAt` so the banner's relative time is deterministic. */
const freezeClock = (): void => {
    vi.useFakeTimers();
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
 * view itself is fully controlled and holds no merge data.
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

describe('RecipeConflictView (native) — structure', () => {
    it('renders the conflict heading', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
    });
});

describe('RecipeConflictView (native) — no version-number banner', () => {
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

describe('RecipeConflictView (native) — "Discard and close" header exit (wireframe gap #1)', () => {
    it('renders the control, addressable by role/name, in the default (options) view', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByRole('button', { name: 'Discard and close' })).toBeTruthy();
    });

    it('clicking it invokes onDiscardAndClose and fires none of the resolution callbacks', () => {
        freezeClock();
        const onDiscardAndClose = vi.fn();
        const onKeepServer = vi.fn();
        const onOverwrite = vi.fn();
        const onMerge = vi.fn();
        renderConflict({ onDiscardAndClose, onKeepServer, onOverwrite, onMerge });

        fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));

        expect(onDiscardAndClose).toHaveBeenCalledTimes(1);
        expect(onKeepServer).not.toHaveBeenCalled();
        expect(onOverwrite).not.toHaveBeenCalled();
        expect(onMerge).not.toHaveBeenCalled();
    });

    it('stays enabled while isResolving — UNLIKE the three option cards, it is never disabled', () => {
        freezeClock();
        renderConflict({ isResolving: true });

        expect(screen.getByRole('button', { name: 'Discard and close' }).getAttribute('aria-disabled')).not.toBe(
            'true',
        );
    });

    it('also renders in the merge panel (Option C), so it is reachable from every sub-view', () => {
        freezeClock();
        const onDiscardAndClose = vi.fn();
        renderConflict({ onDiscardAndClose });

        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
        expect(screen.getByRole('heading', { name: 'Compare and choose' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));
        expect(onDiscardAndClose).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeConflictView (native) — two-column per-side summary cards (wireframe gap #2)', () => {
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

describe('RecipeConflictView (native) — A/B/C option cards (X2)', () => {
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

    it('Use theirs fires onKeepServer', () => {
        freezeClock();
        const onKeepServer = vi.fn();
        renderConflict({ onKeepServer });

        fireEvent.click(screen.getByRole('button', { name: 'Use theirs' }));

        expect(onKeepServer).toHaveBeenCalledTimes(1);
    });

    it('Keep mine fires onOverwrite', () => {
        freezeClock();
        const onOverwrite = vi.fn();
        renderConflict({ onOverwrite });

        fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('Compare enters the merge panel', () => {
        freezeClock();
        renderConflict();

        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

        expect(screen.getByRole('heading', { name: 'Compare and choose' })).toBeTruthy();
    });
});

describe('RecipeConflictView (native) — isResolving disables the resolver while a resolve is in flight (double-submit fix)', () => {
    it('disables all three option cards while isResolving, combined with (not replacing) the stale-base gate', () => {
        freezeClock();
        renderConflict({ isResolving: true });

        expect(screen.getByRole('button', { name: 'Use theirs' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Keep mine' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Compare' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('a double-tap on Overwrite while isResolving fires onOverwrite at most once (the second tap is a no-op because disabled)', () => {
        freezeClock();
        const onOverwrite = vi.fn();
        renderConflict({ onOverwrite });

        fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
        expect(onOverwrite).toHaveBeenCalledTimes(1);

        // The resolve is now in flight — the caller (`useRecipeEditor`) re-renders this FULLY controlled view
        // with `isResolving: true` before a second tap could fire in real usage; assert the SAME button, now
        // disabled, swallows a second tap instead of firing a second resolve.
        cleanup();
        renderConflict({ onOverwrite, isResolving: true });
        fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('does not disable the option cards when isResolving is false and nothing else gates them', () => {
        freezeClock();
        renderConflict({ isResolving: false });

        expect(screen.getByRole('button', { name: 'Use theirs' }).getAttribute('aria-disabled')).not.toBe('true');
        expect(screen.getByRole('button', { name: 'Keep mine' }).getAttribute('aria-disabled')).not.toBe('true');
        expect(screen.getByRole('button', { name: 'Compare' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('disables "Save my choices" while isResolving, combined with (not replacing) the selection + stale-base gates', () => {
        freezeClock();
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
        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

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

        const save = screen.getByRole('button', { name: 'Save my choices' });
        expect(save.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(save);
        expect(onMerge).not.toHaveBeenCalled();
    });

    it('a double-tap on Save my choices while resolving fires onMerge at most once', () => {
        freezeClock();
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

        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        const save = screen.getByRole('button', { name: 'Save my choices' });
        fireEvent.click(save);
        expect(onMerge).toHaveBeenCalledTimes(1);

        // The resolve is now in flight — re-render with `isResolving: true`, same as the real caller would; a
        // second tap on the now-disabled button must be a no-op.
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
        fireEvent.click(screen.getByRole('button', { name: 'Save my choices' }));

        expect(onMerge).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeConflictView (native) — changed-only diff panel with markers + legend (W7 Task 4 / X1)', () => {
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

describe('RecipeConflictView (native) — per-element merge (Option C, W7 Task 5)', () => {
    const enterMerge = () => fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    it('lists ONLY the changed fields/elements from diff.rows — an unchanged field never appears', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        expect(screen.getByRole('heading', { name: 'Compare and choose' })).toBeTruthy();
        expect(screen.getByRole('radiogroup', { name: 'Title' })).toBeTruthy();
        expect(screen.getByRole('radiogroup', { name: 'Servings' })).toBeTruthy();
        expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
        expect(screen.queryByRole('radiogroup', { name: 'Description' })).toBeNull();
    });

    it('renders Server BEFORE Your version within a row (X7 — server-first radio order)', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        const radios = within(titleGroup).getAllByRole('radio');

        expect(radios).toHaveLength(2);
        expect(radios[0]?.getAttribute('aria-label')).toBe('Theirs: Latest Saved Title');
        expect(radios[1]?.getAttribute('aria-label')).toBe('Yours: My Draft Title');
    });

    it('starts with NEITHER radio checked — nothing is auto-selected', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        expect(
            within(titleGroup).getByRole('radio', { name: 'Theirs: Latest Saved Title' }).getAttribute('aria-checked'),
        ).toBe('false');
        expect(
            within(titleGroup).getByRole('radio', { name: 'Yours: My Draft Title' }).getAttribute('aria-checked'),
        ).toBe('false');
    });

    it('selecting a row builds the selections and updates the running summary', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        expect(screen.getByText('Picked: 0 from theirs, 0 from yours')).toBeTruthy();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        expect(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }).getAttribute('aria-checked')).toBe(
            'true',
        );
        expect(screen.getByText('Picked: 1 from theirs, 0 from yours')).toBeTruthy();

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        fireEvent.click(within(titleGroup).getByRole('radio', { name: 'Yours: My Draft Title' }));

        expect(screen.getByText('Picked: 1 from theirs, 1 from yours')).toBeTruthy();
    });

    it('gating (X5): Save my choices is disabled with zero selections, and clicking it fires nothing', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        enterMerge();

        const save = screen.getByRole('button', { name: 'Save my choices' });
        expect(save.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Pick at least one change to save.')).toBeTruthy();

        fireEvent.click(save);

        expect(onMerge).not.toHaveBeenCalled();
    });

    it('gating (X5): Save my choices enables after one selection and fires onMerge with it', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        enterMerge();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        const save = screen.getByRole('button', { name: 'Save my choices' });
        expect(save.getAttribute('aria-disabled')).not.toBe('true');
        expect(screen.queryByText('Pick at least one change to save.')).toBeNull();

        fireEvent.click(save);

        expect(onMerge).toHaveBeenCalledTimes(1);
        expect(onMerge).toHaveBeenCalledWith({ servings: 'theirs' });
    });

    it('is a pure pass-through over the given selections prop — reads exactly what it is given', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderConflict({ onMerge, selections: { title: 'theirs' } });
        enterMerge();

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        expect(
            within(titleGroup).getByRole('radio', { name: 'Theirs: Latest Saved Title' }).getAttribute('aria-checked'),
        ).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Save my choices' }));

        expect(onMerge).toHaveBeenCalledWith({ title: 'theirs' });
    });

    it('resets selections and returns to the three options via back', () => {
        freezeClock();
        const onSelectionsChange = vi.fn();
        renderConflict({ onSelectionsChange, selections: { title: 'theirs' } });
        enterMerge();

        fireEvent.click(screen.getByRole('button', { name: 'Back to options' }));

        expect(onSelectionsChange).toHaveBeenCalledWith({});
        expect(screen.getByRole('button', { name: 'Use theirs' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Compare and choose' })).toBeNull();
    });
});

describe('RecipeConflictView (native) — stale-base warning + confirm gate (W7 Task 5 / X6)', () => {
    it('renders NO warning for a normal case (base present, versionsBehind <= 10)', () => {
        freezeClock();
        renderConflict({ versionsBehind: 5 });

        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Keep mine' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('renders the warning + blocks Overwrite until confirmed when versionsBehind > 10', () => {
        freezeClock();
        const onOverwrite = vi.fn();
        renderConflict({ versionsBehind: 11, onOverwrite });

        expect(screen.getByRole('alert')).toBeTruthy();
        const overwrite = screen.getByRole('button', { name: 'Keep mine' });
        expect(overwrite.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(overwrite);
        expect(onOverwrite).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }));
        expect(overwrite.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(overwrite);
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
        expect(screen.getByRole('button', { name: 'Keep mine' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('blocks Save my choices in the merge panel until confirmed, alongside the selection gate', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge, versionsBehind: 11 });
        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Theirs: 4' }));

        const save = screen.getByRole('button', { name: 'Save my choices' });
        expect(save.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(save);
        expect(onMerge).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }));
        expect(save.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(save);
        expect(onMerge).toHaveBeenCalledTimes(1);
    });

    it('resets staleConfirmed AND the merge panel — re-blocking Overwrite until re-confirmed — when a SECOND, still-stale conflict arrives on the same instance (X6 robustness gap)', () => {
        freezeClock();
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
        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
        expect(screen.getByRole('heading', { name: 'Compare and choose' })).toBeTruthy();
        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }));
        expect(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }).textContent).toContain('☑');

        // A SECOND, still-stale conflict lands on the SAME component instance (new props, e.g. a retried
        // Overwrite that 409'd again) — a different server versionNumber identifies it as a NEW conflict.
        const secondServer = makeVersionConflictSide({ versionNumber: 9, updatedAt: '2026-05-09T15:00:00.000Z' });
        rerender(<RecipeConflictView {...firstProps} server={secondServer} />);

        // The merge panel toggle resets — a NEW conflict restarts at the options view.
        expect(screen.queryByRole('heading', { name: 'Compare and choose' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();

        // The confirm checkbox is UNCHECKED again, and Overwrite is BLOCKED until re-confirmed for THIS
        // conflict — the stale checkbox state must not survive across conflicts.
        expect(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }).textContent).toContain('☐');
        const overwrite = screen.getByRole('button', { name: 'Keep mine' });
        expect(overwrite.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(overwrite);
        expect(onOverwrite).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' }));
        expect(overwrite.getAttribute('aria-disabled')).not.toBe('true');
        fireEvent.click(overwrite);
        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });
});

/**
 * The stale-base confirm checkbox's CHECKED state has to reach assistive tech on the mobile-WEB build too, and
 * `accessibilityState={{ checked }}` alone does not get there (#123).
 *
 * react-native-web 0.20.0 forwards literal `aria-*` props but projects `accessibilityState` for NOTHING (its
 * sole consumer in the package, `AccessibilityUtil/isDisabled`, reads the LEGACY `accessibilityStates` array),
 * so this control rendered `<button role="checkbox">` with no state attribute at all. That is a gating control:
 * a screen-reader user could not tell whether they had already acknowledged the stale base, and the ☑/☐ glyph
 * the older assertions read is a SIGHTED affordance only.
 *
 * `aria-checked` — not `aria-selected` (valid only on `option`/`tab`/`row`/`gridcell` roles) and not
 * `aria-pressed` (a toggle-button attribute). `accessibilityState` stays alongside it because RN reverse-maps
 * `aria-checked` into `accessibilityState.checked`, keeping the device path intact. The sibling `MergeOption`
 * radios already carried `aria-checked` (asserted above) — this checkbox was the one that did not.
 */
describe('RecipeConflictView (native) — the stale-base confirm announces its checked state on web too', () => {
    const confirmBox = () => screen.getByRole('checkbox', { name: 'I understand. Let me choose anyway' });

    it('starts unchecked with `aria-checked="false"` present, not absent', () => {
        freezeClock();
        renderConflict({ versionsBehind: 11 });

        expect(confirmBox().getAttribute('aria-checked')).toBe('false');
    });

    it('reports `aria-checked="true"` once acknowledged', () => {
        freezeClock();
        renderConflict({ versionsBehind: 11 });

        fireEvent.click(confirmBox());

        expect(confirmBox().getAttribute('aria-checked')).toBe('true');
        // Lockstep with the sighted glyph — neither channel may drift from the other.
        expect(confirmBox().textContent).toContain('☑');
    });

    it('reports `aria-checked="false"` again when a NEW conflict resets the acknowledgment', () => {
        // The X6 reset is a state change AT does have to be told about: silently re-arming the gate while the
        // announced state stayed "checked" would be worse than never announcing it.
        freezeClock();
        const firstProps: RecipeConflictViewProps = {
            server,
            base,
            diff,
            versionsBehind: 11,
            isResolving: false,
            selections: {},
            onSelectionsChange: noop,
            onKeepServer: noop,
            onOverwrite: noop,
            onMerge: noop,
            onDiscardAndClose: noop,
        };
        const { rerender } = render(<RecipeConflictView {...firstProps} />);
        fireEvent.click(confirmBox());
        expect(confirmBox().getAttribute('aria-checked')).toBe('true');

        const secondServer = makeVersionConflictSide({ versionNumber: 9, updatedAt: '2026-05-09T15:00:00.000Z' });
        rerender(<RecipeConflictView {...firstProps} server={secondServer} />);

        expect(confirmBox().getAttribute('aria-checked')).toBe('false');
    });
});

/**
 * Curated U15 — see the web file: the same rows and the same set, through react-native-web. Native draws a dotted line
 * as one `Text` whose label is the spoken parts, so a line is found by that label.
 */
describe('RecipeConflictView (native) — a variant-bound ingredient row (curated U15)', () => {
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
    /** Every spoken form the rows above can show, read off the rows, so "no line here" is checked against all. */
    const SPOKEN = new Set(
        [...variantDiff.rows, ...fallbackDiff.rows].flatMap((row) =>
            (['base', 'mine', 'theirs'] as const).flatMap((side) => {
                const parts = conflictSideParts(row, side);

                return parts === undefined ? [] : [spokenVariantParts(parts)];
            }),
        ),
    );

    /** The spoken form of every dotted line under `root`, in document order. */
    const spokenLines = (root: HTMLElement): readonly string[] =>
        Array.from(root.querySelectorAll('[aria-label]'))
            .map((element) => element.getAttribute('aria-label') ?? '')
            .filter((label) => SPOKEN.has(label));

    /** The block that holds one side's value text and its dotted line. */
    const sideOf = (text: string): HTMLElement => {
        const side = screen.getByText(text).parentElement;

        if (side === null) {
            throw new Error(`No side holds "${text}".`);
        }

        return side;
    };

    /** The diff-panel row that holds the side showing `text`. */
    const rowOf = (text: string): HTMLElement => {
        const row = sideOf(text).parentElement;

        if (row === null) {
            throw new Error(`No row holds "${text}".`);
        }

        return row;
    };

    describe('the changed-fields panel', () => {
        it('draws each side its own dotted line, under its value, when every side froze the same parts', () => {
            freezeClock();
            renderConflict({ diff: variantDiff });

            expect(spokenLines(sideOf('Before: 2 lb beef brisket'))).toEqual(['flat half, select']);
            expect(spokenLines(sideOf('Theirs: 4 lb beef brisket'))).toEqual(['flat half, select']);
            expect(spokenLines(sideOf('Yours: 3 lb beef brisket'))).toEqual(['flat half, select']);
            const value = screen.getByText('Theirs: 4 lb beef brisket');
            const line = within(sideOf('Theirs: 4 lb beef brisket')).getByLabelText('flat half, select');
            expect(value.compareDocumentPosition(line)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
            expect(line.textContent).toContain('flat half · select');
        });

        it('shows each side the parts IT froze when the sides differ, and none under a base that froze none', () => {
            freezeClock();
            renderConflict({ diff: variantDiff });

            expect(spokenLines(sideOf('Before: 1 lb beef chuck'))).toEqual([]);
            expect(spokenLines(sideOf('Theirs: 5 lb beef chuck'))).toEqual(['boneless, choice']);
            expect(spokenLines(sideOf('Yours: 2 lb beef chuck'))).toEqual(['boneless']);
        });

        it('draws no dotted line for a side that has no such line', () => {
            freezeClock();
            renderConflict({ diff: variantDiff });

            expect(spokenLines(sideOf('Theirs: 6 lb beef brisket'))).toEqual(['point half, choice']);
            expect(spokenLines(rowOf('Theirs: 6 lb beef brisket'))).toEqual(['point half, choice']);
        });

        it('draws mine and theirs, and no "Was" line, on a base-evicted row', () => {
            freezeClock();
            renderConflict({ diff: fallbackDiff });

            expect(screen.queryByText(/^Before:/)).toBeNull();
            expect(spokenLines(sideOf('Theirs: 4 lb beef brisket'))).toEqual(['flat half, choice']);
            expect(spokenLines(sideOf('Yours: 3 lb beef brisket'))).toEqual(['flat half, select']);
        });

        it('finds a comma-joined label in the cook’s own words (the control), and none from a dotted line', () => {
            freezeClock();
            renderConflict({ diff: variantDiff });

            expect(commaJoinedTexts(rowOf('Yours: 200 g Butter (flat half, select)'), FLAT)).toHaveLength(1);
            expect(commaJoinedTexts(rowOf('Yours: 3 lb beef brisket'), FLAT)).toEqual([]);
        });
    });

    describe('the merge panel', () => {
        const enterMerge = () => fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

        it('names each option with its own side’s parts and draws them under its value inside the option', () => {
            freezeClock();
            renderControlledConflict({ diff: variantDiff });
            enterMerge();

            const group = screen.getByRole('radiogroup', { name: 'Ingredient: 5 lb beef chuck, boneless, choice' });
            const server = within(group).getByRole('radio', {
                name: 'Theirs: 5 lb beef chuck, boneless, choice',
            });
            const mine = within(group).getByRole('radio', { name: 'Yours: 2 lb beef chuck, boneless' });

            expect(spokenLines(server)).toEqual(['boneless, choice']);
            expect(spokenLines(mine)).toEqual(['boneless']);
        });

        it('keeps the visible group label plain: the parts are in the name and under the options', () => {
            freezeClock();
            renderControlledConflict({ diff: variantDiff });
            enterMerge();

            const group = screen.getByRole('radiogroup', { name: 'Ingredient: 4 lb beef brisket, flat half, select' });

            expect(within(group).getByText('Ingredient: 4 lb beef brisket')).toBeTruthy();
            expect(within(group).queryByText('Ingredient: 4 lb beef brisket, flat half, select')).toBeNull();
        });

        it('names a rebind row by the side that holds the line, and the empty side by its value alone', () => {
            freezeClock();
            renderControlledConflict({ diff: variantDiff });
            enterMerge();

            const group = screen.getByRole('radiogroup', {
                name: 'Ingredient: 6 lb beef brisket, point half, choice',
            });

            expect(
                within(group)
                    .getAllByRole('radio')
                    .map((radio) => radio.getAttribute('aria-label')),
            ).toEqual(['Theirs: 6 lb beef brisket, point half, choice', 'Yours: ']);
            expect(spokenLines(group)).toEqual(['point half, choice']);
        });

        it('shows no comma-joined label inside an option, while the cook’s own comma-joined words still read', () => {
            freezeClock();
            renderControlledConflict({ diff: variantDiff });
            enterMerge();

            const brisket = screen.getByRole('radiogroup', {
                name: 'Ingredient: 4 lb beef brisket, flat half, select',
            });
            const butter = screen.getByRole('radiogroup', { name: 'Ingredient: 200 g Butter' });

            expect(commaJoinedTexts(butter, FLAT)).toHaveLength(1);
            expect(commaJoinedTexts(brisket, FLAT)).toEqual([]);
        });
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2: the options view, its changed-fields panel and the merge panel are
 * each named by a header inside them, so none carries a name and each name is said once (N4).
 */
describe('RecipeConflictView (native) — N1: each name is said once, by its header', () => {
    it.each(['This recipe changed while you were editing', 'Changed fields'])(
        'the options view says "%s" through one header, and no node is labelled with it',
        (name) => {
            freezeClock();
            renderConflict();

            expect(screen.getAllByRole('heading', { name })).toHaveLength(1);
            expect(screen.queryAllByLabelText(name)).toEqual([]);
        },
    );

    it('the merge panel says "Compare and choose" through one header, and no node is labelled with it', () => {
        freezeClock();
        renderConflict();

        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

        expect(screen.getAllByRole('heading', { name: 'Compare and choose' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Compare and choose')).toEqual([]);
    });
});

describe('RecipeConflictView (native) — the design-system Button (UI overhaul slice 2)', () => {
    it('saves a merge through a primary check Button, and leaves it through a secondary chevronLeft one', () => {
        freezeClock();
        renderConflict();

        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

        expectNativeDesignSystemButton(screen.getByRole('button', { name: 'Save my choices' }), 'primary', 'check');
        expectNativeDesignSystemButton(
            screen.getByRole('button', { name: 'Back to options' }),
            'secondary',
            'chevron-left',
        );
    });
});

/** The native leaf's half of the web case above: same copy, same lifted gate. */
describe('RecipeConflictView (native) — a never-published draft', () => {
    it('speaks of a draft saved elsewhere, with no version numbers and no stale-base gate', () => {
        freezeClock();
        renderConflict({ base: undefined, versionsBehind: 6, neverPublished: true });

        expect(screen.getByRole('heading', { name: 'This draft changed somewhere else' })).toBeTruthy();
        expect(screen.getByText('Saved elsewhere')).toBeTruthy();
        expect(screen.getByText('Not saved yet')).toBeTruthy();
        expect(screen.getByText('Your changes')).toBeTruthy();
        expect(screen.queryByText(/v6/)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Keep mine' }).getAttribute('aria-disabled')).not.toBe('true');
    });
});

/**
 * D15: the view paints from colour roles at render, so it follows the device's scheme. Each surface is asserted in BOTH
 * schemes: a level-1 card is `paper` inside a `lineDivider` edge (`darkTheme.md` §4), the stale-base warning is the
 * design system's caution surface (`StandIn`: an `attention` edge on the `attentionTint` fill under `ink`), and a
 * chosen merge radio fills with `selectedEdge`.
 */
describe.each(['light', 'dark'] as const)('RecipeConflictView (native) — the %s scheme', (scheme) => {
    const colours = scheme === 'dark' ? roleDark : role;
    const copy = recipeVersionMessages.en.conflict;
    const style = (element: Element): CSSStyleDeclaration => getComputedStyle(element);

    it('paints the heading in ink and the explanation in inkMuted', () => {
        systemScheme.current = scheme;
        freezeClock();
        renderConflict();

        expect(style(screen.getByRole('heading', { name: copy.heading })).color).toBe(rgb(colours.ink));
        expect(style(screen.getByText(copy.explanation)).color).toBe(rgb(colours.inkMuted));
    });

    it('draws each option card on paper inside a lineDivider edge, its title in ink', () => {
        systemScheme.current = scheme;
        freezeClock();
        renderConflict();
        const card = screen.getByRole('button', { name: copy.optionUseTheirsTitle });

        expect(style(card).backgroundColor).toBe(rgb(colours.paper));
        expect(style(card).borderTopColor).toBe(rgb(colours.lineDivider));
        expect(style(within(card).getByText(copy.optionUseTheirsTitle)).color).toBe(rgb(colours.ink));
    });

    it('draws the stale-base warning as the caution surface: attentionTint inside an attention edge, ink text', () => {
        systemScheme.current = scheme;
        freezeClock();
        renderConflict({ versionsBehind: 11 });
        const warning = screen.getByRole('alert');

        expect(style(warning).backgroundColor).toBe(colours.attentionTint);
        expect(style(warning).borderTopColor).toBe(rgb(colours.attention));
    });

    it('fills a chosen merge radio with selectedEdge, and rings an open one in inkMuted', () => {
        systemScheme.current = scheme;
        freezeClock();
        renderControlledConflict();
        fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
        const group = screen.getByRole('radiogroup', { name: 'Title' });
        const chosen = within(group).getByRole('radio', { name: 'Yours: My Draft Title' });
        fireEvent.click(chosen);
        const open = within(group).getByRole('radio', { name: 'Theirs: Latest Saved Title' });

        const dot = (radio: HTMLElement): Element => {
            const first = radio.firstElementChild;

            if (first === null) {
                throw new Error('no radio dot');
            }

            return first;
        };

        expect(style(dot(chosen)).backgroundColor).toBe(rgb(colours.selectedEdge));
        expect(style(dot(open)).borderTopColor).toBe(rgb(colours.inkMuted));
    });
});
