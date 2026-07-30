// @vitest-environment jsdom
/**
 * Component tests for the web Home greeting (US-000 / FR-046). The greeting is time-of-day aware and the
 * subtitle is a locale-formatted date; both derive from the viewer's local clock. These freeze the clock with
 * fake timers so every time-of-day bucket is asserted deterministically — a greeting that ignored the hour
 * (e.g. hard-coded "Good afternoon") would fail every non-afternoon case.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { HomeGreeting } from '../HomeGreeting';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** Render the greeting with the clock frozen at a fixed LOCAL instant. */
const renderAt = (year: number, monthIndex: number, day: number, hour: number, locale = 'en'): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, monthIndex, day, hour, 0, 0));

    renderWithProviders(<HomeGreeting />, { locale });
};

describe('HomeGreeting (web) — time-of-day bucket', () => {
    // Each row is [hour, expected greeting]. The boundary hours (5, 12, 17, 22) are chosen on purpose: they
    // are where the bucket flips, so an off-by-one in the shared bucketer is caught here.
    it.each([
        [8, 'Good morning, Chef!'],
        [5, 'Good morning, Chef!'],
        [14, 'Good afternoon, Chef!'],
        [12, 'Good afternoon, Chef!'],
        [19, 'Good evening, Chef!'],
        [17, 'Good evening, Chef!'],
        [23, 'Still up, Chef?'],
        [2, 'Still up, Chef?'],
    ])('at hour %i greets "%s"', (hour, expected) => {
        renderAt(2026, 4, 31, hour);

        expect(screen.getByRole('heading', { name: expected })).toBeTruthy();
    });
});

describe('HomeGreeting (web) — date subtitle', () => {
    it('renders the local calendar date in the mockup long form', () => {
        // 2026-05-31 is a Sunday (the mockup label "Saturday" was fictional copy).
        renderAt(2026, 4, 31, 14);

        expect(screen.getByText('Sunday, May 31, 2026')).toBeTruthy();
    });

    it('localizes the date for a non-English locale', () => {
        renderAt(2026, 4, 31, 14, 'es');

        // The Spanish month name proves the locale actually reached the formatter.
        expect(screen.getByText(/mayo/u)).toBeTruthy();
    });
});
