/**
 * Sheet (native) hands the snackbar back the moment it starts to close.
 *
 * A closing sheet keeps its `Modal` up while its exit plays, so the window is still visible but is no longer the place
 * to draw. The sheet tells its window it is presenting only while it is open and not held (`open && !held`), so a
 * snackbar shown inside it moves back to the host as soon as the close begins, not when the exit ends.
 *
 * The exit is forced through `useSheetExit`, because jsdom has no frames for the engine to report.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { AccessibilityInfo, Pressable, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import { SnackbarHost } from '../../snackbar/SnackbarHost.native.js';
import { useSnackbar } from '../../snackbar/useSnackbar.js';
import { render } from '../../testing/tamaguiTesting.native.js';
import { Sheet } from '../Sheet.native.js';

const state = vi.hoisted(() => ({ exiting: false }));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../useSheetExit.js', () => ({
    useSheetExit: () => ({ exiting: state.exiting, finishExit: () => undefined }),
}));

beforeEach(() => {
    state.exiting = false;
    vi.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockImplementation(() => Promise.resolve(false));
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function Shower(): JSX.Element {
    const { show } = useSnackbar();

    return (
        <Pressable accessibilityRole="button" onPress={() => show({ message: 'Ticks cleared' })}>
            <Text>show</Text>
        </Pressable>
    );
}

const tree = (open: boolean): JSX.Element => (
    <SnackbarHost>
        <Sheet open={open} onOpenChange={() => undefined} title="Ingredients" closeLabel="Close ingredients" size="page">
            <Shower />
        </Sheet>
    </SnackbarHost>
);

/** The one region that holds the message, and whether it is inside the sheet's window. */
function snackbarInSheet(): boolean {
    const [region, ...others] = screen
        .getAllByRole('status')
        .filter((candidate) => candidate.textContent?.includes('Ticks cleared') === true);

    expect(others).toStrictEqual([]);

    return region?.closest('[aria-modal="true"]') !== null && region !== undefined;
}

describe('Sheet (native) and the snackbar', () => {
    it('draws the snackbar inside the open sheet', () => {
        render(tree(true));

        fireEvent.click(screen.getByRole('button', { name: 'show' }));

        expect(snackbarInSheet()).toBe(true);
    });

    it('hands the snackbar back to the host as soon as the sheet starts to close, while its exit still plays', () => {
        const { rerender } = render(tree(true));

        fireEvent.click(screen.getByRole('button', { name: 'show' }));
        state.exiting = true;
        rerender(tree(false));

        expect(screen.getByText('Ingredients')).toBeDefined();
        expect(snackbarInSheet()).toBe(false);
    });
});
