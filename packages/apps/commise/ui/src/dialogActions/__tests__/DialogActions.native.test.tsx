import { resizeObserver as observer } from '../../testing/resizeObserver.js';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, type FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { DialogActions } from '../DialogActions.native.js';
import { DialogActionsWidthContext } from '../dialogActionsWidth.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    observer.observed.clear();
});

/**
 * Report `width` as the row's measured width, the way react-native-web's observer does.
 *
 * `levels` is how many parents up the row is from the Keep button: 1 for a plain row, 2 with `shares="equal"`, where each
 * button sits in a share inside the row. A case that passes `levels > 1` also asserts a row at a width that should give
 * one, so a wrong `levels` (the wrong node measured, the list left stacked) cannot pass a "stacked" case for that reason.
 */
function layOut(width: number, levels = 1): void {
    let row = screen.getByRole('button', { name: 'Keep' }) as HTMLElement;

    for (let level = 0; level < levels; level += 1) {
        row = row.parentElement as HTMLElement;
    }

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

const scaled = (textScale: number, sideBySideFrom: 400 | 440 | 600 = 400): void => {
    renderWithTamagui(<DialogActions sideBySideFrom={sideBySideFrom}>{pair}</DialogActions>, 'light', textScale);
};

/**
 * The threshold is in text units (staff D1, D4): `sideBySideFrom` times the system text scale clamped to [1, 2]. Each
 * case kills one mutation (qse C-1, C-2): the scale term, the cap, the floor.
 */
describe('DialogActions (native) — the threshold in text units', () => {
    it('stacks at 799 and sits in a row at 800 at text scale 2', () => {
        scaled(2);
        layOut(799);
        expect(getComputedStyle(rowOf()).flexDirection).toBe('column-reverse');

        layOut(800);
        expect(getComputedStyle(rowOf()).flexDirection).toBe('row');
    });

    it('stacks an iPad dialog box of 416 at iOS extra-large (1.118): 400 x 1.118 = 447', () => {
        scaled(1.118);
        layOut(416);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('column-reverse');
    });

    it('caps the scale at 2: width 800 at 3.571 is a row (uncapped, the threshold is 1428)', () => {
        scaled(3.571);
        layOut(800);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('row');
    });

    it('floors the scale at 1: a 358 phone box stacks at iOS Small 0.882 (unfloored, 353 is a row)', () => {
        scaled(0.882);
        layOut(358);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('column-reverse');
    });
});

/** Counts how often it MOUNTS, so a flip that remounts a button is seen (qse C-3: no ref). */
const mounts = { count: 0 };

const Counting: FC = () => {
    useEffect(() => {
        mounts.count += 1;
    }, []);

    return <button type="button">Keep</button>;
};

describe('DialogActions (native) — equal shares', () => {
    beforeEach(() => {
        mounts.count = 0;
    });

    it('wraps each child in a share that grows only in a row, and never remounts a child on a flip', () => {
        renderWithTamagui(
            <DialogActions sideBySideFrom={400} shares="equal">
                <Counting />
                <button type="button">Do it</button>
            </DialogActions>,
            'light',
        );
        const share = (): HTMLElement => screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;

        layOut(300, 2);
        expect(getComputedStyle(share()).flexGrow).not.toBe('1');

        layOut(720, 2);
        expect(getComputedStyle(share()).flexGrow).toBe('1');
        expect(getComputedStyle(share()).flexBasis).toMatch(/^0(px|%)?$/u);
        expect(mounts.count).toBe(1);

        layOut(300, 2);
        expect(mounts.count).toBe(1);
    });

    it('gives a conditional (null or false) child no empty share', () => {
        renderWithTamagui(
            <DialogActions sideBySideFrom={400} shares="equal">
                {null}
                <button type="button">Keep</button>
                {false}
                <button type="button">Do it</button>
            </DialogActions>,
            'light',
        );

        expect(rowOf().parentElement?.childElementCount).toBe(2);
    });

    it('keeps tree order: dismiss first, confirm last', () => {
        renderWithTamagui(
            <DialogActions sideBySideFrom={400} shares="equal">
                {pair}
            </DialogActions>,
            'light',
        );

        expect([...document.querySelectorAll('button')].map((button) => button.textContent)).toStrictEqual([
            'Keep',
            'Do it',
        ]);
    });

    it('adds no wrapper for the default shares', () => {
        render(<DialogActions sideBySideFrom={400}>{pair}</DialogActions>);

        expect(rowOf().childElementCount).toBe(2);
    });
});

/**
 * The memento (staff D5): a frame that moves its footer holds the last measured width above the remount, and the
 * remounted actions seed from it.
 */
describe('DialogActions (native) — the width memento', () => {
    const withMemento = (width: number | null, remember = vi.fn()): void => {
        render(
            <DialogActionsWidthContext.Provider value={{ width, remember }}>
                <DialogActions sideBySideFrom={400}>{pair}</DialogActions>
            </DialogActionsWidthContext.Provider>,
        );
    };

    it('is a row on its first render when the memento holds a wide width', () => {
        withMemento(720);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('row');
    });

    it('stacks when the memento holds nothing', () => {
        withMemento(null);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('column-reverse');
    });

    it('lets its own layout win over the seed, and records it', () => {
        const remember = vi.fn();

        withMemento(720, remember);
        layOut(300);

        expect(getComputedStyle(rowOf()).flexDirection).toBe('column-reverse');
        expect(remember).toHaveBeenCalledWith(300);
    });
});
