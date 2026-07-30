/**
 * Component tests for the mobile Home greeting (US-000 / FR-046 / FR-044). Rendered via react-native-web under
 * jsdom. The greeting is time-of-day aware and the subtitle is a locale-formatted date; both derive from the
 * viewer's local clock through the SHARED formatters, so this asserts every bucket with a frozen clock — a
 * greeting that ignored the hour would fail every non-matching case.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { HomeGreeting } from '../../../src/components/home/HomeGreeting.js';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const renderAt = (year: number, monthIndex: number, day: number, hour: number, locale = 'en'): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, monthIndex, day, hour, 0, 0));

    renderWithProviders(<HomeGreeting />, { locale });
};

describe('HomeGreeting (mobile) — time-of-day bucket', () => {
    it.each([
        [8, 'Good morning, Chef!'],
        [14, 'Good afternoon, Chef!'],
        [19, 'Good evening, Chef!'],
        [23, 'Still up, Chef?'],
    ])('at hour %i greets "%s"', (hour, expected) => {
        renderAt(2026, 4, 31, hour);

        expect(screen.getByText(expected)).toBeTruthy();
    });
});

describe('HomeGreeting (mobile) — date subtitle', () => {
    it('renders the local calendar date in the mockup long form', () => {
        renderAt(2026, 4, 31, 14);

        // 2026-05-31 is a Sunday (the mockup label "Saturday" was fictional copy).
        expect(screen.getByText('Sunday, May 31, 2026')).toBeTruthy();
    });
});
