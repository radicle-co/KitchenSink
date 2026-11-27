/**
 * The web compare panel (build spec §6.6), REWRITTEN for slice 6: one version against the CURRENT one, rows from
 * `compareWithCurrent` (the pure `computeConflictDiff`). Each row names the field, what the version said and what the
 * recipe says now; an element one side lacks reads "None". The two-version selection, its summary counts and its
 * full-diff toggle are gone with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SnackbarHost } from '@commise/ui/snackbar';
import {
    expectProbeHandedBack,
    expectProbeInside,
    expectProbeUndoReachable,
    showProbe,
    SnackbarProbe,
} from '@commise/ui/testing/window-snackbar';

import { recipeMessages } from '../../messages.js';
import { makeRecipeVersion, makeSnapshot } from '../__fixtures__/index.js';
import { compareWithCurrent } from '../compare.js';
import { VersionCompareView } from '../VersionCompareView.js';

afterEach(cleanup);

const lineNames = recipeMessages.en.ingredientLineName;
const old = makeRecipeVersion({
    versionNumber: 3,
    snapshot: makeSnapshot({
        title: 'Lamb',
        steps: [{ id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Mix.' }],
    }),
});
const current = makeRecipeVersion({
    versionNumber: 5,
    snapshot: makeSnapshot({
        title: 'Slow lamb',
        steps: [
            { id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Mix.' },
            { id: 'step_2', recipeId: 'rec_1', stepNumber: 2, instruction: 'Rest.' },
        ],
    }),
});

describe('VersionCompareView (web)', () => {
    it('titles the panel with the version, and lists each change as then and now', () => {
        render(
            <VersionCompareView
                open
                version={old}
                diff={compareWithCurrent(old, current, 'en', lineNames)}
                onClose={vi.fn()}
            />,
        );

        const panel = screen.getByRole('dialog', { name: 'Version 3 and the current version' });
        const title = within(panel).getByText('Title').closest('li') as HTMLElement;

        expect(within(title).getByText('Lamb')).toBeTruthy();
        expect(within(title).getByText('Slow lamb')).toBeTruthy();
        expect(within(title).getByText('Version 3')).toBeTruthy();
        expect(within(title).getByText('Current')).toBeTruthy();
    });

    it('says "None" for a step the version did not have', () => {
        render(
            <VersionCompareView
                open
                version={old}
                diff={compareWithCurrent(old, current, 'en', lineNames)}
                onClose={vi.fn()}
            />,
        );

        const step = screen.getByText('Step 2').closest('li') as HTMLElement;

        expect(within(step).getByText('None')).toBeTruthy();
        expect(within(step).getByText('Rest.')).toBeTruthy();
    });

    it('says the version matches when nothing differs', () => {
        const same = makeRecipeVersion({ versionNumber: 4, snapshot: current.snapshot });
        render(
            <VersionCompareView
                open
                version={same}
                diff={compareWithCurrent(same, current, 'en', lineNames)}
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByText('This version matches the current one.')).toBeTruthy();
        expect(screen.queryByRole('listitem')).toBeNull();
    });

    it('closes through its one exit', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(
            <VersionCompareView
                open
                version={old}
                diff={compareWithCurrent(old, current, 'en', lineNames)}
                onClose={onClose}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Close compare' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // CL-ICONBTN: the close control is the shared icon button in muted ink, with a 24 glyph.
    it('draws its close control as the shared icon button', () => {
        render(
            <VersionCompareView
                open
                version={old}
                diff={compareWithCurrent(old, current, 'en', lineNames)}
                onClose={vi.fn()}
            />,
        );
        const close = screen.getByRole('button', { name: 'Close compare' });

        expect(close.className.split(' ')).toEqual(expect.arrayContaining(['size-[44px]', 'text-ink-muted']));
        expect(close.querySelector('svg')?.getAttribute('width')).toBe('24');
    });

    it('renders nothing while closed', () => {
        render(<VersionCompareView open={false} onClose={vi.fn()} />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('VersionCompareView (web) — offers the snackbar an outlet', () => {
    function WithHost({ open }: { readonly open: boolean }) {
        return (
            <SnackbarHost>
                <SnackbarProbe />
                <VersionCompareView
                    open={open}
                    version={old}
                    diff={compareWithCurrent(old, current, 'en', lineNames)}
                    onClose={vi.fn()}
                />
            </SnackbarHost>
        );
    }

    it('draws a snackbar shown while it is open inside it, reachable by keyboard, and Undo works', async () => {
        render(<WithHost open />);
        showProbe();

        expectProbeInside(screen.getByRole('dialog'));
        await expectProbeUndoReachable(screen.getByRole('dialog'));
    });

    it('hands the same snackbar back when it closes', () => {
        const { rerender } = render(<WithHost open />);
        showProbe();
        rerender(<WithHost open={false} />);

        expectProbeHandedBack();
    });

    it('scrolls in an inner box, so the absolute outlet stays put while the content scrolls', () => {
        render(<WithHost open />);
        const panel = screen.getByRole('dialog');
        const scroller = screen.getByRole('heading', { level: 2 }).parentElement?.parentElement as HTMLElement;

        // Kills: the panel scrolling itself, which carries an absolutely placed snackbar away with the content.
        expect(panel.className).not.toContain('overflow-y-auto');
        expect(scroller.className).toContain('overflow-y-auto');
        expect(panel.contains(scroller)).toBe(true);
    });
});
