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

import type { ConflictDiff } from '../conflictDiff.js';
import { makeVersionConflictSide } from '../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeConflictView } from '../RecipeConflictView.native.js';
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

describe('RecipeConflictView (native) — per-side banner (X3)', () => {
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
                    isResolving: false,
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

describe('RecipeConflictView (native) — A/B/C option cards (X2)', () => {
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

describe('RecipeConflictView (native) — isResolving disables the resolver while a resolve is in flight (double-submit fix)', () => {
    it('disables all three option cards while isResolving, combined with (not replacing) the stale-base gate', () => {
        freezeClock();
        renderConflict({ isResolving: true });

        expect(screen.getByRole('button', { name: 'Keep server version' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Overwrite with your version' }).getAttribute('aria-disabled')).toBe(
            'true',
        );
        expect(screen.getByRole('button', { name: 'Merge manually' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('a double-tap on Overwrite while isResolving fires onOverwrite at most once (the second tap is a no-op because disabled)', () => {
        freezeClock();
        const onOverwrite = vi.fn();
        renderConflict({ onOverwrite });

        fireEvent.click(screen.getByRole('button', { name: 'Overwrite with your version' }));
        expect(onOverwrite).toHaveBeenCalledTimes(1);

        // The resolve is now in flight — the caller (`useRecipeEditor`) re-renders this FULLY controlled view
        // with `isResolving: true` before a second tap could fire in real usage; assert the SAME button, now
        // disabled, swallows a second tap instead of firing a second resolve.
        cleanup();
        renderConflict({ onOverwrite, isResolving: true });
        fireEvent.click(screen.getByRole('button', { name: 'Overwrite with your version' }));

        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('does not disable the option cards when isResolving is false and nothing else gates them', () => {
        freezeClock();
        renderConflict({ isResolving: false });

        expect(screen.getByRole('button', { name: 'Keep server version' }).getAttribute('aria-disabled')).not.toBe(
            'true',
        );
        expect(
            screen.getByRole('button', { name: 'Overwrite with your version' }).getAttribute('aria-disabled'),
        ).not.toBe('true');
        expect(screen.getByRole('button', { name: 'Merge manually' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('disables "Save merged version" while isResolving, combined with (not replacing) the selection + stale-base gates', () => {
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
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Merge manually' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }));

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
            />,
        );

        const save = screen.getByRole('button', { name: 'Save merged version' });
        expect(save.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(save);
        expect(onMerge).not.toHaveBeenCalled();
    });

    it('a double-tap on Save merged version while resolving fires onMerge at most once', () => {
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
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Merge manually' }));
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }));

        const save = screen.getByRole('button', { name: 'Save merged version' });
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
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

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

describe('RecipeConflictView (native) — per-element merge (Option C, W7 Task 5)', () => {
    const enterMerge = () => fireEvent.click(screen.getByRole('button', { name: 'Merge manually' }));

    it('lists ONLY the changed fields/elements from diff.rows — an unchanged field never appears', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        expect(screen.getByRole('heading', { name: 'Merge changes field by field' })).toBeTruthy();
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
        expect(radios[0]?.getAttribute('aria-label')).toBe('Latest saved version: Latest Saved Title');
        expect(radios[1]?.getAttribute('aria-label')).toBe('Your version: My Draft Title');
    });

    it('starts with NEITHER radio checked — nothing is auto-selected', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        expect(
            within(titleGroup)
                .getByRole('radio', { name: 'Latest saved version: Latest Saved Title' })
                .getAttribute('aria-checked'),
        ).toBe('false');
        expect(
            within(titleGroup)
                .getByRole('radio', { name: 'Your version: My Draft Title' })
                .getAttribute('aria-checked'),
        ).toBe('false');
    });

    it('selecting a row builds the selections and updates the running summary', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        expect(screen.getByText('Summary: 0 choices from server, 0 choices from your version')).toBeTruthy();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }));

        expect(
            within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }).getAttribute('aria-checked'),
        ).toBe('true');
        expect(screen.getByText('Summary: 1 choice from server, 0 choices from your version')).toBeTruthy();

        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        fireEvent.click(within(titleGroup).getByRole('radio', { name: 'Your version: My Draft Title' }));

        expect(screen.getByText('Summary: 1 choice from server, 1 choice from your version')).toBeTruthy();
    });

    it('gating (X5): Save merged version is disabled with zero selections, and clicking it fires nothing', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        enterMerge();

        const save = screen.getByRole('button', { name: 'Save merged version' });
        expect(save.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Choose a value for at least one field to save the merged version.')).toBeTruthy();

        fireEvent.click(save);

        expect(onMerge).not.toHaveBeenCalled();
    });

    it('gating (X5): Save merged version enables after one selection and fires onMerge with it', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        enterMerge();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }));

        const save = screen.getByRole('button', { name: 'Save merged version' });
        expect(save.getAttribute('aria-disabled')).not.toBe('true');
        expect(screen.queryByText('Choose a value for at least one field to save the merged version.')).toBeNull();

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
            within(titleGroup)
                .getByRole('radio', { name: 'Latest saved version: Latest Saved Title' })
                .getAttribute('aria-checked'),
        ).toBe('true');

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

describe('RecipeConflictView (native) — stale-base warning + confirm gate (W7 Task 5 / X6)', () => {
    it('renders NO warning for a normal case (base present, versionsBehind <= 10)', () => {
        freezeClock();
        renderConflict({ versionsBehind: 5 });

        expect(screen.queryByRole('alert')).toBeNull();
        expect(
            screen.getByRole('button', { name: 'Overwrite with your version' }).getAttribute('aria-disabled'),
        ).not.toBe('true');
    });

    it('renders the warning + blocks Overwrite until confirmed when versionsBehind > 10', () => {
        freezeClock();
        const onOverwrite = vi.fn();
        renderConflict({ versionsBehind: 11, onOverwrite });

        expect(screen.getByRole('alert')).toBeTruthy();
        const overwrite = screen.getByRole('button', { name: 'Overwrite with your version' });
        expect(overwrite.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(overwrite);
        expect(onOverwrite).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
        expect(overwrite.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(overwrite);
        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('renders the warning when base is undefined, even with a LOW versionsBehind (unreliable alone)', () => {
        freezeClock();
        renderConflict({ base: undefined, versionsBehind: 1 });

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Overwrite with your version' }).getAttribute('aria-disabled')).toBe(
            'true',
        );
    });

    it('blocks Save merged version in the merge panel until confirmed, alongside the selection gate', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge, versionsBehind: 11 });
        fireEvent.click(screen.getByRole('button', { name: 'Merge manually' }));

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }));

        const save = screen.getByRole('button', { name: 'Save merged version' });
        expect(save.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(save);
        expect(onMerge).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
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
        };
        const { rerender } = render(<RecipeConflictView {...firstProps} />);

        // Enter the merge panel for the FIRST conflict and confirm its stale-base warning there (the same
        // shared checkbox gates Save merged version).
        fireEvent.click(screen.getByRole('button', { name: 'Merge manually' }));
        expect(screen.getByRole('heading', { name: 'Merge changes field by field' })).toBeTruthy();
        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
        expect(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }).textContent).toContain('☑');

        // A SECOND, still-stale conflict lands on the SAME component instance (new props, e.g. a retried
        // Overwrite that 409'd again) — a different server versionNumber identifies it as a NEW conflict.
        const secondServer = makeVersionConflictSide({ versionNumber: 9, updatedAt: '2026-05-09T15:00:00.000Z' });
        rerender(<RecipeConflictView {...firstProps} server={secondServer} />);

        // The merge panel toggle resets — a NEW conflict restarts at the options view.
        expect(screen.queryByRole('heading', { name: 'Merge changes field by field' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();

        // The confirm checkbox is UNCHECKED again, and Overwrite is BLOCKED until re-confirmed for THIS
        // conflict — the stale checkbox state must not survive across conflicts.
        expect(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }).textContent).toContain('☐');
        const overwrite = screen.getByRole('button', { name: 'Overwrite with your version' });
        expect(overwrite.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(overwrite);
        expect(onOverwrite).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('checkbox', { name: 'I understand — continue anyway' }));
        expect(overwrite.getAttribute('aria-disabled')).not.toBe('true');
        fireEvent.click(overwrite);
        expect(onOverwrite).toHaveBeenCalledTimes(1);
    });
});
