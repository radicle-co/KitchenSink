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
import { fireEvent } from '@testing-library/dom';
import { useState } from 'react';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import type { ConflictDiff } from '../conflictDiff.js';
import { makeVersionConflictSide } from '../__fixtures__/index.js';
import { RecipeConflictView } from '../RecipeConflictView.js';
import type { RecipeConflictViewProps, RecipeMergeSelections } from '../model.js';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const noop = () => undefined;

const server = makeVersionConflictSide({
    versionNumber: 6,
    deviceLabel: 'iPhone',
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

const mineValues = makeRecipeFormValues({ title: 'My Draft Title', servings: 6 });
const theirsValues = makeRecipeFormValues({ title: 'Latest Saved Title', servings: 4 });

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
        mineValues,
        theirsValues,
        selections: {},
        onSelectionsChange: noop,
        onKeepServer: noop,
        onOverwrite: noop,
        onMerge: noop,
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
        mineValues,
        theirsValues,
        onKeepServer: noop,
        onOverwrite: noop,
        onMerge: noop,
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

describe('RecipeConflictView (web) — per-side banner (X3)', () => {
    it('renders the server banner with version, relative time, and device', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByText('Server version (v6): Saved 2 minutes ago on iPhone')).toBeTruthy();
    });

    it('renders the user’s own banner as local unsaved changes', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByText('Your version: local unsaved changes')).toBeTruthy();
    });

    it('omits the device clause when the server side carries no deviceLabel', () => {
        freezeClock();
        renderConflict({ server: { ...server, deviceLabel: undefined } });

        expect(screen.getByText('Server version (v6): Saved 2 minutes ago')).toBeTruthy();
        expect(screen.queryByText(/on iPhone/)).toBeNull();
    });

    it('renders the server banner BEFORE the your-version banner (X7 — server-first ordering)', () => {
        freezeClock();
        renderConflict();

        const serverBanner = screen.getByText('Server version (v6): Saved 2 minutes ago on iPhone');
        const mineBanner = screen.getByText('Your version: local unsaved changes');

        // eslint-disable-next-line no-bitwise
        expect(serverBanner.compareDocumentPosition(mineBanner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('escapes an untrusted deviceLabel as text — renders no element from it', () => {
        freezeClock();
        const { container } = render(
            <RecipeConflictView
                {...({
                    server: { ...server, deviceLabel: '<img src=x onerror=alert(1)>' },
                    base,
                    diff,
                    versionsBehind: 1,
                    mineValues,
                    theirsValues,
                    selections: {},
                    onSelectionsChange: noop,
                    onKeepServer: noop,
                    onOverwrite: noop,
                    onMerge: noop,
                } satisfies RecipeConflictViewProps)}
            />,
        );

        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});

describe('RecipeConflictView (web) — A/B/C option cards (X2)', () => {
    it('renders all three option cards with a title and description', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByRole('button', { name: 'Keep server version' })).toBeTruthy();
        expect(screen.getByText('Discard your local changes and keep the server version.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Overwrite with your version' })).toBeTruthy();
        expect(screen.getByText('Your local changes win and become the new version.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Merge manually' })).toBeTruthy();
        expect(screen.getByText('Review each changed field and choose which version to keep.')).toBeTruthy();
    });

    it('Option A fires onKeepServer', () => {
        freezeClock();
        const onKeepServer = vi.fn();
        renderConflict({ onKeepServer });

        fireEvent.click(screen.getByRole('button', { name: 'Keep server version' }));

        expect(onKeepServer).toHaveBeenCalledTimes(1);
    });

    it('Option B fires onOverwrite', () => {
        freezeClock();
        const onOverwrite = vi.fn();
        renderConflict({ onOverwrite });

        fireEvent.click(screen.getByRole('button', { name: 'Overwrite with your version' }));

        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('Option C enters the merge panel', () => {
        freezeClock();
        renderConflict();

        fireEvent.click(screen.getByRole('button', { name: 'Merge manually' }));

        expect(screen.getByRole('heading', { name: 'Merge changes field by field' })).toBeTruthy();
    });
});

describe('RecipeConflictView (web) — changed-only diff panel with markers + legend (W7 Task 4 / X1)', () => {
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

        const serverValue = screen.getByText('Latest saved version: Weeknight Pasta');
        const mineValue = screen.getByText('Your version: My Draft Title');

        // eslint-disable-next-line no-bitwise
        expect(serverValue.compareDocumentPosition(mineValue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders the "was" base value when the row carries one', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.getByText('Was: Weeknight Pasta')).toBeTruthy();
        expect(screen.getByText('Was: 4')).toBeTruthy();
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

        expect(screen.queryByText(/^Was:/)).toBeNull();
    });

    it('marks a `changed` row with an accessible "changed" marker (not colour alone)', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.getByRole('img', { name: 'changed' })).toBeTruthy();
    });

    it('marks a `conflict` row with an accessible "conflict" marker, distinct from "changed"', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.getByRole('img', { name: 'conflict' })).toBeTruthy();
        // Exactly one marker per row — no stray accessible-image nodes.
        expect(screen.getAllByRole('img')).toHaveLength(2);
    });

    it('renders a legend explaining all three markers', () => {
        freezeClock();
        renderConflict({ diff: changedOnlyDiff });

        expect(screen.getByText('[=] unchanged')).toBeTruthy();
        expect(screen.getByText('[→] changed')).toBeTruthy();
        expect(screen.getByText('[!!] conflict')).toBeTruthy();
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
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.queryByText('[→] changed')).toBeNull();
    });
});

describe('RecipeConflictView (web) — field-by-field merge (FR-007c option c, controlled selections)', () => {
    const enterMerge = () => fireEvent.click(screen.getByRole('button', { name: 'Merge manually' }));

    it('enters merge mode with a per-field chooser defaulting to the user’s draft', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        expect(screen.getByRole('heading', { name: 'Merge changes field by field' })).toBeTruthy();
        // Each editable field is its own radio group; title defaults to the user's draft value.
        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        const mineRadio = within(titleGroup).getByRole('radio', { name: 'Your version: My Draft Title' });
        const theirsRadio = within(titleGroup).getByRole('radio', { name: 'Latest saved version: Latest Saved Title' });
        expect((mineRadio as HTMLInputElement).checked).toBe(true);
        expect((theirsRadio as HTMLInputElement).checked).toBe(false);
    });

    it('toggles a field between mine and theirs (round-trips through onSelectionsChange)', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        const theirsRadio = within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' });
        fireEvent.click(theirsRadio);

        expect((theirsRadio as HTMLInputElement).checked).toBe(true);
        expect(
            (within(servingsGroup).getByRole('radio', { name: 'Your version: 6' }) as HTMLInputElement).checked,
        ).toBe(false);
    });

    it('reports the current selections to onMerge (my title left default + their servings chosen)', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        enterMerge();

        // Keep the title on mine (default); pull servings from theirs.
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

        // The leaf reports the RAW selections (composition is the caller's job, not this view's) — sparse,
        // only the field the user actually touched.
        expect(onMerge).toHaveBeenCalledTimes(1);
        expect(onMerge).toHaveBeenCalledWith({ servings: 'theirs' });
    });

    it('submitting with no changes reports an empty selections object (every field stays at its default)', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        enterMerge();

        fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

        expect(onMerge).toHaveBeenCalledWith({});
    });

    it('is a pure pass-through over the given selections prop — reads exactly what it is given', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderConflict({ onMerge, selections: { title: 'theirs' } });
        enterMerge();

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        expect(
            (
                within(titleGroup).getByRole('radio', {
                    name: 'Latest saved version: Latest Saved Title',
                }) as HTMLInputElement
            ).checked,
        ).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

        expect(onMerge).toHaveBeenCalledWith({ title: 'theirs' });
    });

    it('resets selections and returns to the three options via back', () => {
        freezeClock();
        const onSelectionsChange = vi.fn();
        renderConflict({ onSelectionsChange, selections: { title: 'theirs' } });
        enterMerge();

        fireEvent.click(screen.getByRole('button', { name: 'Back to options' }));

        expect(onSelectionsChange).toHaveBeenCalledWith({});
        expect(screen.getByRole('button', { name: 'Keep server version' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Merge changes field by field' })).toBeNull();
    });
});
