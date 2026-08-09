/**
 * Component tests for the web {@link TimerAlert} (FR-034) — the completion banner.
 *
 * A kitchen is noisy and the cook's hands are busy, so the alert has to survive being neither heard nor
 * looked at. That makes three things falsifiable here:
 *  1. **Nothing completed renders NOTHING** — no empty live region sitting in the tree waiting to announce
 *     a stray update.
 *  2. **The announcement names the timer** — "Toast the nuts timer finished", not a generic "done", so a
 *     cook running three timers knows which one fired.
 *  3. **It is an ASSERTIVE live region**, so a screen reader interrupts rather than queueing behind
 *     whatever it was reading; and the dismiss control is a real, named button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import type { CookingTimer } from '@kitchensink/cooking-core';

import { TimerAlert } from '../TimerAlert';

afterEach(cleanup);

const noop = () => undefined;

function makeTimer(overrides: Partial<CookingTimer> = {}): CookingTimer {
    return {
        id: 'timer-1',
        label: 'Toast the nuts',
        stepNumber: 5,
        durationMs: 300_000,
        startedAt: '2026-08-08T12:00:00.000Z',
        isPaused: false,
        ...overrides,
    };
}

function renderAlert(completedTimer?: CookingTimer, onDismiss: (timerId: string) => void = noop) {
    render(
        <LocaleProvider locale="en">
            <TimerAlert completedTimer={completedTimer} onDismiss={onDismiss} />
        </LocaleProvider>,
    );
}

describe('TimerAlert (web)', () => {
    it('renders NOTHING while no timer has completed (mutation lens: no idle live region)', () => {
        renderAlert(undefined);

        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('announces the COMPLETED timer by name when one finishes', () => {
        renderAlert(makeTimer());

        expect(screen.getByRole('alert').textContent).toContain('Toast the nuts timer finished');
    });

    it('names the timer that actually fired (mutation lens: not a hard-coded or stale label)', () => {
        renderAlert(makeTimer({ id: 'timer-9', label: 'Rest the dough' }));

        expect(screen.getByRole('alert').textContent).toContain('Rest the dough timer finished');
        expect(screen.queryByText(/Toast the nuts/)).toBeNull();
    });

    it('exposes the announcement as an ASSERTIVE, atomic live region', () => {
        renderAlert(makeTimer());

        const alert = screen.getByRole('alert');
        expect(alert.getAttribute('aria-live')).toBe('assertive');
        expect(alert.getAttribute('aria-atomic')).toBe('true');
    });

    it('offers an accessible dismiss control that reports the completed timer id', () => {
        const onDismiss = vi.fn();
        renderAlert(makeTimer({ id: 'timer-9' }), onDismiss);

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onDismiss).toHaveBeenCalledWith('timer-9');
    });

    it('does not fire the dismiss intent on render (mutation lens: the banner is inert until pressed)', () => {
        const onDismiss = vi.fn();
        renderAlert(makeTimer(), onDismiss);

        expect(onDismiss).not.toHaveBeenCalled();
    });
});
