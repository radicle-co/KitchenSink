/**
 * Native component tests for {@link TimerAlert} (FR-034), rendered through react-native-web under jsdom.
 *
 * Mirrors the web spec state-for-state: nothing completed renders NOTHING, the announcement names the
 * timer that actually fired, the region is ASSERTIVE and atomic (React Native's `aria-live` is a
 * first-class alias for `accessibilityLiveRegion`, so this is device-correct on TalkBack, not a web-only
 * attribute), and dismiss is a real, named control reporting the completed timer's id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import type { CookingTimer } from '@kitchensink/cooking-core';

// Explicit `.native` specifier — `tsc` and the native config's resolver both map it to the native leaf.
import { TimerAlert } from '../TimerAlert.native';

afterEach(cleanup);

const noop = () => undefined;

/** The WCAG 2.5.5 / platform touch-target floor the dismiss control must clear. */
const MIN_TOUCH_TARGET = 44;

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

describe('TimerAlert (native)', () => {
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

    /**
     * The web leaf also carries `aria-atomic`; React Native has no such prop and needs none — an Android
     * live region announces its whole content on change, which is what atomic means. So the cross-platform
     * claim asserted here is the POLITENESS, which both platforms express identically.
     */
    it('exposes the announcement as an ASSERTIVE live region', () => {
        renderAlert(makeTimer());

        expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
    });

    it('offers an accessible dismiss control that reports the completed timer id', () => {
        const onDismiss = vi.fn();
        renderAlert(makeTimer({ id: 'timer-9' }), onDismiss);

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onDismiss).toHaveBeenCalledWith('timer-9');
    });

    it('gives the dismiss control a >=44pt touch target (B10 — hands are busy and wet)', () => {
        renderAlert(makeTimer());

        const style = window.getComputedStyle(screen.getByRole('button', { name: 'Dismiss' }));
        expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
        expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    });

    it('does not fire the dismiss intent on render (mutation lens: the banner is inert until pressed)', () => {
        const onDismiss = vi.fn();
        renderAlert(makeTimer(), onDismiss);

        expect(onDismiss).not.toHaveBeenCalled();
    });
});
