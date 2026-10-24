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

const renderAt = (year: number, monthIndex: number, day: number, hour: number, locale = 'en', name?: string): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, monthIndex, day, hour, 0, 0));

    renderWithProviders(<HomeGreeting {...(name === undefined ? {} : { name })} />, { locale });
};

describe('HomeGreeting (mobile) — time-of-day bucket', () => {
    it.each([
        [8, 'Good morning'],
        [14, 'Good afternoon'],
        [19, 'Good evening'],
        [23, 'Still up?'],
    ])('at hour %i greets "%s"', (hour, expected) => {
        renderAt(2026, 4, 31, hour);

        expect(screen.getByRole('heading', { name: expected })).toBeTruthy();
    });

    // Slice 3 (`buildSpec.md` §4.2): the greeting is the large title, and names the cook when there is a name.
    it.each([
        [14, 'Good afternoon, Eliza'],
        [23, 'Still up, Eliza?'],
    ])('at hour %i greets the cook by name: "%s"', (hour, expected) => {
        renderAt(2026, 4, 31, hour, 'en', 'Eliza');

        expect(screen.getByRole('heading', { name: expected })).toBeTruthy();
        expect(screen.getAllByRole('heading')).toHaveLength(1);
    });
});

describe('HomeGreeting (mobile) — date subtitle', () => {
    it('renders the local calendar date in the mockup long form', () => {
        renderAt(2026, 4, 31, 14);

        // 2026-05-31 is a Sunday (the mockup label "Saturday" was fictional copy).
        expect(screen.getByText('Sunday, May 31, 2026')).toBeTruthy();
    });
});
