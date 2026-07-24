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

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
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

describe('RecipeConflictView (native) — changed-fields list (minimal, W7 Task 4 replaces)', () => {
    it('lists the diff’s changed rows by their localized field label', () => {
        freezeClock();
        renderConflict();

        expect(screen.getByText('Title')).toBeTruthy();
        expect(screen.getByText('Servings')).toBeTruthy();
    });
});

describe('RecipeConflictView (native) — field-by-field merge (FR-007c option c, controlled selections)', () => {
    const enterMerge = () => fireEvent.click(screen.getByRole('button', { name: 'Merge manually' }));

    it('enters merge mode with a per-field chooser defaulting to the user’s draft', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        expect(screen.getByRole('heading', { name: 'Merge changes field by field' })).toBeTruthy();
        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        const mineRadio = within(titleGroup).getByRole('radio', { name: 'Your version: My Draft Title' });
        expect(mineRadio.getAttribute('aria-checked')).toBe('true');
        const theirsRadio = within(titleGroup).getByRole('radio', { name: 'Latest saved version: Latest Saved Title' });
        expect(theirsRadio.getAttribute('aria-checked')).toBe('false');
    });

    it('toggles a field between mine and theirs (round-trips through onSelectionsChange)', () => {
        freezeClock();
        renderControlledConflict();
        enterMerge();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        const theirsRadio = within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' });
        fireEvent.click(theirsRadio);

        expect(theirsRadio.getAttribute('aria-checked')).toBe('true');
        expect(within(servingsGroup).getByRole('radio', { name: 'Your version: 6' }).getAttribute('aria-checked')).toBe(
            'false',
        );
    });

    it('reports the current selections to onMerge (my title left default + their servings chosen)', () => {
        freezeClock();
        const onMerge = vi.fn();
        renderControlledConflict({ onMerge });
        enterMerge();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

        expect(onMerge).toHaveBeenCalledTimes(1);
        expect(onMerge).toHaveBeenCalledWith({ servings: 'theirs' });
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
