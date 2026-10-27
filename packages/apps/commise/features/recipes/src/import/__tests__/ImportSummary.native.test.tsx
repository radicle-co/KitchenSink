/**
 * Native component tests for `ImportSummary`, rendered through react-native-web under jsdom. Mirrors
 * `ImportSummary.test.tsx`, plus the native rule that the coverage shows only at the wide container class.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

const windowWidth = vi.hoisted(() => ({ current: 390 }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: windowWidth.current }),
    };
});

import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportSummary } from '../ImportSummary.native.js';
import { importMessages } from '../messages.js';
import type { ImportSummaryProps } from '../props.js';

const s = importMessages.en.summary;

afterEach(() => {
    cleanup();
    windowWidth.current = 390;
});

function renderSummary(overrides: Partial<ImportSummaryProps> = {}) {
    const handlers = { onSeeAdded: vi.fn(), onFixUnreadable: vi.fn(), onChooseFoods: vi.fn() };
    render(
        <ImportSummary
            sourceName="Paprika"
            finishedWhen="today at 11:20"
            added={855}
            neededNothing={546}
            reviewed={300}
            skipped={9}
            alreadyHere={6}
            unreadable={['Untitled 3']}
            asWrittenLines={41}
            asWrittenRecipes={27}
            countedRecipes={828}
            {...handlers}
            {...overrides}
        />,
    );

    return handlers;
}

// `componentFixes.md` §10: the as-written block paints `surfaceMuted` and holds Choose foods, in both themes. (Written after
// the code it covers.)
describe.each(['light', 'dark'] as const)('ImportSummary (native) — the surface it paints, %s theme', (scheme) => {
    afterEach(() => {
        systemScheme.current = null;
    });

    it('wraps Choose foods in a block painted with the muted fill', () => {
        systemScheme.current = scheme;
        renderSummary();
        let block: HTMLElement | null = screen.getByRole('button', { name: s.chooseFoods });

        while (block !== null && getComputedStyle(block).backgroundColor !== rgb(rolesFor(scheme).surfaceMuted)) {
            block = block.parentElement;
        }

        expect(block, 'no ancestor of Choose foods paints the muted fill').not.toBeNull();
    });
});

describe('ImportSummary (native)', () => {
    it('says every count, and each action reports', () => {
        const { onSeeAdded, onFixUnreadable, onChooseFoods } = renderSummary();

        expect(screen.getByRole('heading', { name: s.title })).toBeTruthy();
        expect(screen.getByText('855 added')).toBeTruthy();
        expect(screen.getByText('6 already here')).toBeTruthy();
        expect(screen.getByText('1 could not be read')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: s.seeThem }));
        fireEvent.click(screen.getByRole('button', { name: s.fix }));
        fireEvent.click(screen.getByRole('button', { name: s.chooseFoods }));

        expect([onSeeAdded, onFixUnreadable, onChooseFoods].map((h) => h.mock.calls.length)).toEqual([1, 1, 1]);
    });

    it('draws no row for a count of zero', () => {
        renderSummary({ alreadyHere: 0, unreadable: [], asWrittenLines: 0 });

        expect(screen.queryByText(/already here/u)).toBeNull();
        expect(screen.queryByRole('button', { name: s.fix })).toBeNull();
        expect(screen.queryByRole('button', { name: s.chooseFoods })).toBeNull();
    });

    it('shows the nutrition coverage only at the wide container class', () => {
        renderSummary();
        expect(screen.queryByText('828 of 855 recipes')).toBeNull();
        cleanup();

        windowWidth.current = 1194;
        renderSummary();
        expect(screen.getByText('828 of 855 recipes')).toBeTruthy();
    });
});
