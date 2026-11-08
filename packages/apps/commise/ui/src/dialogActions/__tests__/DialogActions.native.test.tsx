import { resizeObserver as observer } from '../../testing/resizeObserver.js';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogActions } from '../DialogActions.native.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    observer.observed.clear();
});

/** Report `width` as the row's measured width, the way react-native-web's observer does. */
function layOut(width: number): void {
    const row = screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;

    Object.defineProperty(row, 'offsetWidth', { value: width, configurable: true });
    Object.defineProperty(row, 'offsetHeight', { value: 100, configurable: true });
    act(() => {
        observer.callback?.(
            [...observer.observed].map((target) => ({ target }) as unknown as ResizeObserverEntry),
            {} as ResizeObserver,
        );
    });
    act(() => {
        vi.runOnlyPendingTimers();
    });
}

const pair = (
    <>
        <button type="button">Keep</button>
        <button type="button">Do it</button>
    </>
);

const rowOf = (): HTMLElement => screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;

/**
 * `DialogActions` (native): it measures its own width, because a window width is not the width of a dialog card or a
 * sheet. Before the first layout it stacks, the safe shape for the narrowest phone.
 */
describe('DialogActions (native)', () => {
    it('stacks, the main action on top, before it has been measured', () => {
        render(<DialogActions sideBySideFrom={600}>{pair}</DialogActions>);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('column-reverse');
    });

    it('still stacks one point below the threshold', () => {
        render(<DialogActions sideBySideFrom={600}>{pair}</DialogActions>);
        layOut(599);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('column-reverse');
    });

    it('sits side by side, end-aligned, at the threshold', () => {
        render(<DialogActions sideBySideFrom={600}>{pair}</DialogActions>);
        layOut(600);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('row');
        expect(getComputedStyle(rowOf()).justifyContent).toBe('flex-end');
    });

    it('takes the threshold from its prop', () => {
        render(<DialogActions sideBySideFrom={400}>{pair}</DialogActions>);
        layOut(400);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('row');
    });

    it('sits side by side at 440 and not at 439', () => {
        render(<DialogActions sideBySideFrom={440}>{pair}</DialogActions>);
        layOut(439);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('column-reverse');

        layOut(440);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('row');
    });

    it('keeps the buttons in source order, dismiss first', () => {
        render(<DialogActions sideBySideFrom={600}>{pair}</DialogActions>);

        expect([...rowOf().querySelectorAll('button')].map((button) => button.textContent)).toStrictEqual([
            'Keep',
            'Do it',
        ]);
    });
});
