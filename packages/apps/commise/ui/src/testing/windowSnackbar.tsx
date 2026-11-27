/**
 * @module testing/window-snackbar — the probe and the three checks every web window's snackbar outlet owes, run against
 * the real `SnackbarHost` and the real window (nothing mocked): the snackbar is drawn inside the window, a keyboard
 * reaches Undo and Undo works, and closing the window hands the same snackbar back.
 *
 * Each window's test file mounts `<SnackbarHost><SnackbarProbe /><TheWindow /></SnackbarHost>`, so the shape of the
 * three checks lives once and a window cannot pass with a weaker one.
 *
 * @pattern Test Double (Spy) — a button that shows one snackbar with an Undo, and a record of its press
 */
import { act, screen, within, type ByRoleOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { expect, vi, type Mock } from 'vitest';

import { useSnackbar } from '../snackbar/useSnackbar.js';
import { present } from './present.js';

/** What the probe's snackbar says. */
export const PROBE_MESSAGE = 'Probe shown';

/** The press of the probe's Undo. */
export const probeUndo: Mock<() => void> = vi.fn<() => void>();

/**
 * A button, outside the window, that shows the probe's snackbar. Orchestration of one press: it reads the host's
 * `show` and hands it the probe's message and Undo.
 *
 * @returns The button.
 * @sideEffect Shows a snackbar through the nearest host when pressed.
 */
export function SnackbarProbe(): JSX.Element {
    const { show } = useSnackbar();

    return (
        <button
            type="button"
            onClick={() => {
                show({ message: PROBE_MESSAGE, action: { label: 'Undo', onAction: probeUndo } });
            }}
        >
            show probe
        </button>
    );
}

/**
 * The snackbar's status region in one web window, and a check of the layout around it. A web window holds exactly two
 * `status` elements: the announcement slot, then the snackbar's own region as its next sibling and the last element
 * child of the window (the offline notice speaks through the slot). It throws unless all three hold, so every row that
 * reads the region also fails when the slot is missing, doubled, nested in the region or placed after it. Never find
 * the region by its text: a snackbar written into the slot would pass.
 *
 * @param win - The window's element (its dialog, or the box a `WindowScope` sits in).
 * @param options - The `getAllByRole` options, for a window that is hidden from the accessibility tree.
 * @returns The snackbar's region.
 * @throws Error when the window's two status elements are not laid out as the outlet draws them: the slot, then the
 *     region, last.
 */
export function snackbarRegionOf(win: HTMLElement, options?: ByRoleOptions): HTMLElement {
    const statuses = within(win).getAllByRole('status', options);
    const region = present(statuses.at(-1), 'the snackbar region');

    if (statuses.length !== 2) {
        throw new Error(`Expected the slot and the region, found ${String(statuses.length)} status elements.`);
    }

    if (region.parentElement?.lastElementChild !== region) {
        throw new Error('Expected the snackbar region to be the last element child of its window.');
    }

    if (region.previousElementSibling !== statuses[0]) {
        throw new Error('Expected the announcement slot right before the snackbar region.');
    }

    return region;
}

/** Every status region, hidden or not, that holds the probe's message. */
const holders = (): HTMLElement[] =>
    screen.getAllByRole('status', { hidden: true }).filter((region) => region.textContent.includes(PROBE_MESSAGE));

/**
 * Show the probe's snackbar. The probe's button is hidden from the accessibility tree while a modal window is open, so
 * it is pressed by its text.
 *
 * @sideEffect Presses the probe's button.
 */
export function showProbe(): void {
    probeUndo.mockClear();
    act(() => {
        screen.getByText('show probe').click();
    });
}

/**
 * The snackbar is drawn inside the window, in one place only, and focus has not moved to it by itself.
 *
 * @param win - The window's element (its dialog).
 */
export function expectProbeInside(win: HTMLElement): void {
    const regions = holders();

    // Kills: a window with no outlet, which leaves the snackbar behind the scrim (visible, unreachable).
    expect(regions).toHaveLength(1);
    expect(win.contains(present(regions[0], 'the probe region'))).toBe(true);
    // Kills: an autofocus on the snackbar, which takes a keyboard user out of the dialog they were reading.
    expect(regions[0]?.contains(document.activeElement)).toBe(false);
}

/**
 * A keyboard reaches Undo by walking the window's focus order, and Undo works.
 *
 * @param win - The window's element (its dialog).
 */
export async function expectProbeUndoReachable(win: HTMLElement): Promise<void> {
    const user = userEvent.setup();
    const undo = within(win).getByRole('button', { name: 'Undo' });
    let reached = false;

    for (let step = 0; step < 16 && !reached; step += 1) {
        await user.tab();
        reached = document.activeElement === undo;
    }

    // Kills: a trap that leaves the outlet out of its walk.
    expect(reached).toBe(true);

    await user.keyboard('{Enter}');

    expect(probeUndo).toHaveBeenCalledOnce();
}

/**
 * After the window closed, the same snackbar is drawn once outside it, and its Undo works.
 */
export function expectProbeHandedBack(): void {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(holders()).toHaveLength(1);

    probeUndo.mockClear();
    act(() => {
        within(present(holders()[0], 'the probe region')).getByRole('button', { name: 'Undo', hidden: true }).click();
    });

    // Kills: an outlet that stays registered after its window is gone, which leaves the snackbar nowhere.
    expect(probeUndo).toHaveBeenCalledOnce();
}
