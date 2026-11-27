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

    describe('message wrap', () => {
        const LONG = 'Can\u2019t undo. The recipe changed since. Open its versions to check.';

        const renderLong = (): HTMLElement => {
            render(
                <UndoSnackbar
                    message={LONG}
                    action={{ label: 'Undo', onAction: vi.fn() }}
                    onPause={vi.fn()}
                    onResume={vi.fn()}
                />,
            );

            return screen.getByText(LONG);
        };

        it('shows a long message whole and never clamps, truncates or stops it wrapping', () => {
            const message = renderLong();

            expect(message.textContent).toBe(LONG);
            // Kills: the two-line clamp, truncation and nowrap, each of which cuts a message at large text.
            expect(message.className).not.toMatch(/line-clamp|truncate|nowrap|overflow-hidden|text-ellipsis/u);
            // A message may shrink below its content so it wraps by words, and a word wider than the row breaks.
            expect(message.className.split(/\s+/u)).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
        });

        it('wraps the row, so Undo moves under a message that has no room beside it, at the end', () => {
            const message = renderLong();
            const undo = screen.getByRole('button', { name: 'Undo' });

            // Kills: a row that cannot wrap, which squeezes the message instead of moving Undo.
            expect(message.parentElement?.className.split(/\s+/u)).toContain('flex-wrap');
            // Kills: a message with no basis in text units, which never leaves Undo without room to move down.
            expect(message.className).toContain('flex-[1_1_var(--snackbar-message-basis)]');
            expect(undo.className.split(/\s+/u)).toContain('ml-auto');
            // Undo keeps its 44 px target on its own row.
            expect(undo.className.split(/\s+/u)).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11']));
        });
    });
});
