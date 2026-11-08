/**
 * The Undo snackbar puts an action on the INVERSE surface, so it states that surface (`componentFixes.md` §10b): the
 * action presses to the inverse row of the press table (the inverse ink over the inverse fill) and rings in
 * `inverseAction`, flush. It used to press with a hand-written `hover:bg-inverse-ink/10`.
 *
 * Mutation lens: write the ink-alpha hover back, or drop the tone, and a test fails. Written before the change.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FOCUS_RING_CLASS } from '../../focusRing/focusRingClass.js';
import { PRESS_FILL_CLASS } from '../../surfaceTone/surfaceToneClass.js';
import { surfaceToneOf } from '../../testing/surfaceToneOf.js';
import { UndoSnackbar } from '../UndoSnackbar.js';

afterEach(cleanup);

const renderBar = (): void => {
    render(
        <UndoSnackbar
            message="Recipe deleted"
            action={{ label: 'Undo', onAction: vi.fn() }}
            onPause={vi.fn()}
            onResume={vi.fn()}
        />,
    );
};

describe('UndoSnackbar (web)', () => {
    it('states the inverse surface to its action', () => {
        renderBar();

        expect(surfaceToneOf(screen.getByRole('button', { name: 'Undo' }))).toBe('inverse');
    });

    it('presses to the inverse row, with no hand-written wash, and rings flush in inverseAction', () => {
        renderBar();
        const tokens = screen.getByRole('button', { name: 'Undo' }).className.split(/\s+/u);

        expect(tokens).toEqual(expect.arrayContaining(PRESS_FILL_CLASS.pointer.split(' ')));
        expect(tokens).toEqual(expect.arrayContaining(FOCUS_RING_CLASS.inverse.split(' ')));
        expect(tokens.some((token) => token.includes('bg-inverse-ink/'))).toBe(false);
    });
});
