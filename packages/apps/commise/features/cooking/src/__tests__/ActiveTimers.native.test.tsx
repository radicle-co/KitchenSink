/**
 * Native component tests for {@link ActiveTimers} (FR-034), rendered through react-native-web under jsdom.
 *
 * Mirrors the web spec state-for-state so the platforms cannot drift, including the touch-target floor the
 * native leaf owns (B10 / WCAG 2.5.5 — a 44pt minimum on every timer control, which the web leaf expresses
 * as a `min-h-11` utility). The same three claims are falsifiable: per-row wiring reports the pressed row's
 * id, paused reads as paused by a visible TEXT label rather than colour (NFR-004), and the clock is correct
 * at the boundaries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import type { CookingTimer } from '@kitchensink/cooking-core';

// Explicit `.native` specifier — `tsc` and the native config's resolver both map it to the native leaf.
import { ActiveTimers } from '../ActiveTimers.native';
import type { ActiveTimerView, ActiveTimersProps } from '../timerModel';

afterEach(cleanup);

const noop = () => undefined;

/** The WCAG 2.5.5 / platform touch-target floor every timer control must clear. */
const MIN_TOUCH_TARGET = 44;

function makeTimer(overrides: Partial<CookingTimer> = {}): CookingTimer {
    return {
        id: 'timer-1',
        label: 'Simmer the sauce',
        stepNumber: 3,
        durationMs: 1_500_000,
        startedAt: '2026-08-08T12:00:00.000Z',
        isPaused: false,
        ...overrides,
    };
}

function makeView(remainingMs: number, overrides: Partial<CookingTimer> = {}): ActiveTimerView {
    return { timer: makeTimer(overrides), remainingMs };
}

function renderTimers(timers: readonly ActiveTimerView[], overrides: Partial<ActiveTimersProps> = {}) {
    render(
        <LocaleProvider locale="en">
            <ActiveTimers
                timers={timers}
                onPause={overrides.onPause ?? noop}
                onResume={overrides.onResume ?? noop}
                onCancel={overrides.onCancel ?? noop}
            />
        </LocaleProvider>,
    );
}

describe('ActiveTimers (native) — empty', () => {
    it('renders no list at all when nothing is running', () => {
        renderTimers([]);

        expect(screen.queryByRole('list', { name: 'Active timers' })).toBeNull();
        expect(screen.queryByRole('listitem')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('ActiveTimers (native) — one timer', () => {
    it('names the region and renders the single timer with its label and remaining time', () => {
        renderTimers([makeView(1_500_000)]);

        expect(screen.getByRole('list', { name: 'Active timers' })).toBeTruthy();
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.getByRole('timer', { name: 'Simmer the sauce' }).textContent).toBe('25:00');
    });

    it('offers pause and cancel for a running timer, and no resume', () => {
        renderTimers([makeView(1_500_000)]);

        expect(screen.getByRole('button', { name: 'Pause timer' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Cancel timer' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Resume timer' })).toBeNull();
    });

    it('gives every control a >=44pt touch target (B10 — hands are busy and wet)', () => {
        renderTimers([makeView(1_500_000)]);

        for (const control of screen.getAllByRole('button')) {
            const style = window.getComputedStyle(control);
            expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
            expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
        }
    });
});

describe('ActiveTimers (native) — several concurrent timers', () => {
    const views: readonly ActiveTimerView[] = [
        makeView(1_500_000, { id: 'timer-a', label: 'Simmer the sauce' }),
        makeView(9_000, { id: 'timer-b', label: 'Toast the nuts', stepNumber: 5 }),
        makeView(600_000, { id: 'timer-c', label: 'Rest the dough', stepNumber: 8, isPaused: true }),
    ];

    it('renders one row per timer, each with its own label and its own remaining time', () => {
        renderTimers(views);

        expect(screen.getAllByRole('listitem')).toHaveLength(3);
        expect(screen.getByRole('timer', { name: 'Simmer the sauce' }).textContent).toBe('25:00');
        expect(screen.getByRole('timer', { name: 'Toast the nuts' }).textContent).toBe('0:09');
        expect(screen.getByRole('timer', { name: 'Rest the dough' }).textContent).toBe('10:00');
    });

    it('distinguishes paused from running by a visible TEXT label, not colour (NFR-004)', () => {
        renderTimers(views);

        const [running, alsoRunning, paused] = screen.getAllByRole('listitem');

        for (const row of [running, alsoRunning]) {
            expect(within(row as HTMLElement).getByRole('button', { name: 'Pause timer' })).toBeTruthy();
            expect(within(row as HTMLElement).queryByRole('button', { name: 'Resume timer' })).toBeNull();
        }

        expect(within(paused as HTMLElement).getByRole('button', { name: 'Resume timer' })).toBeTruthy();
        expect(within(paused as HTMLElement).queryByRole('button', { name: 'Pause timer' })).toBeNull();
    });

    it('pauses the timer whose row was pressed (mutation lens: not the first timer)', () => {
        const onPause = vi.fn();
        renderTimers(views, { onPause });

        const secondRow = screen.getAllByRole('listitem')[1] as HTMLElement;
        fireEvent.click(within(secondRow).getByRole('button', { name: 'Pause timer' }));

        expect(onPause).toHaveBeenCalledTimes(1);
        expect(onPause).toHaveBeenCalledWith('timer-b');
    });

    it('resumes the timer whose row was pressed (mutation lens: not the first timer)', () => {
        const onResume = vi.fn();
        renderTimers(views, { onResume });

        const pausedRow = screen.getAllByRole('listitem')[2] as HTMLElement;
        fireEvent.click(within(pausedRow).getByRole('button', { name: 'Resume timer' }));

        expect(onResume).toHaveBeenCalledTimes(1);
        expect(onResume).toHaveBeenCalledWith('timer-c');
    });

    it('cancels the timer whose row was pressed (mutation lens: not the first timer)', () => {
        const onCancel = vi.fn();
        renderTimers(views, { onCancel });

        const thirdRow = screen.getAllByRole('listitem')[2] as HTMLElement;
        fireEvent.click(within(thirdRow).getByRole('button', { name: 'Cancel timer' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledWith('timer-c');
    });

    it('never pauses a paused timer or resumes a running one — each row offers exactly one toggle', () => {
        renderTimers(views);

        expect(screen.getAllByRole('button', { name: 'Pause timer' })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Resume timer' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Cancel timer' })).toHaveLength(3);
    });
});

describe('ActiveTimers (native) — remaining-time boundaries', () => {
    it.each([
        [0, '0:00'],
        [1, '0:01'],
        [9_000, '0:09'],
        [59_000, '0:59'],
        [60_000, '1:00'],
        [1_500_000, '25:00'],
        [3_600_000, '60:00'],
    ])('renders %ims as %s', (remainingMs, expected) => {
        renderTimers([makeView(remainingMs)]);

        expect(screen.getByRole('timer', { name: 'Simmer the sauce' }).textContent).toBe(expected);
    });

    it('clamps an overshot (negative) remainder to 0:00 rather than counting backwards', () => {
        renderTimers([makeView(-4_000)]);

        expect(screen.getByRole('timer', { name: 'Simmer the sauce' }).textContent).toBe('0:00');
    });
});
