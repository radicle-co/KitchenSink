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
        [0, 'Still up?'],
        [4, 'Still up?'],
        [5, 'Good morning'],
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
    it('renders the local calendar date without the year (board: "Sunday 25 October")', () => {
        renderAt(2026, 4, 31, 14);

        // 2026-05-31 is a Sunday (the mockup label "Saturday" was fictional copy).
        expect(screen.getByText('Sunday, May 31')).toBeTruthy();
    });
});

/**
 * The Home header board (HomeAndroid384 / HomeIphone390): ONE row — the greeting and date stacked on the start side and
 * nothing on the end side, because no title row carries the avatar (owner ruling 2026-11-11, N3; Profile is the You tab).
 * Rewritten from the board that drew the 44 pt profile button at the end of this row.
 */
describe('HomeGreeting (mobile) — the one-row header', () => {
    const renderRow = (name?: string): void => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
        renderWithProviders(<HomeGreeting {...(name === undefined ? {} : { name })} />, { locale: 'en' });
    };

    it('keeps the greeting as the one heading, with the date under it and nothing after them', () => {
        renderRow('Eliza');
        const heading = screen.getByRole('heading', { name: 'Good afternoon, Eliza' });
        const date = screen.getByText('Sunday, May 31');

        expect(screen.getAllByRole('heading')).toHaveLength(1);
        expect(heading.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('lays the text block in a row that takes the free width and wraps', () => {
        renderRow('Eliza');
        const heading = screen.getByRole('heading', { name: 'Good afternoon, Eliza' });
        const row = heading.parentElement?.parentElement as HTMLElement;

        expect(getComputedStyle(row).flexDirection).toBe('row');
        expect(getComputedStyle(heading.parentElement as HTMLElement).flexShrink).toBe('1');
    });

    it('wraps a long name instead of overflowing the row', () => {
        renderRow('Maximilian-Alexander Featherstonehaugh-Cholmondeley');
        const heading = screen.getByRole('heading');

        expect(getComputedStyle(heading.parentElement as HTMLElement).flexShrink).toBe('1');
    });
});
