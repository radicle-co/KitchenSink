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
 * The Home header board (HomeAndroid384 / HomeIphone390): ONE row — the greeting and date stacked on the start side,
 * the 44 pt profile button on the end side. It is no longer the shared `LargeTitleHeader` with a floating action.
 */
describe('HomeGreeting (mobile) — the one-row header', () => {
    const renderRow = (name?: string): void => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
        renderWithProviders(
            <HomeGreeting
                {...(name === undefined ? {} : { name })}
                action={{
                    kind: 'avatar',
                    avatar: (
                        <button type="button" aria-label="Profile, Eliza">
                            E
                        </button>
                    ),
                }}
            />,
            { locale: 'en' },
        );
    };

    it('keeps the greeting as the one heading, with the date under it and the button after both', () => {
        renderRow('Eliza');
        const heading = screen.getByRole('heading', { name: 'Good afternoon, Eliza' });
        const date = screen.getByText('Sunday, May 31');
        const profile = screen.getByRole('button', { name: 'Profile, Eliza' });

        expect(screen.getAllByRole('heading')).toHaveLength(1);
        expect(heading.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(date.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('lays the text block and the button side by side in one row, the button last (end side)', () => {
        renderRow('Eliza');
        const profile = screen.getByRole('button', { name: 'Profile, Eliza' });
        const heading = screen.getByRole('heading', { name: 'Good afternoon, Eliza' });
        const row = heading.parentElement?.parentElement as HTMLElement;

        expect(row.contains(profile)).toBe(true);
        expect(getComputedStyle(row).flexDirection).toBe('row');
        expect(getComputedStyle(row).alignItems).toBe('center');
        // The text block takes the free width and wraps; the action is never squeezed below its 44 pt target.
        expect(getComputedStyle(profile.parentElement as HTMLElement).minWidth).toBe('44px');
        expect(getComputedStyle(profile.parentElement as HTMLElement).minHeight).toBe('44px');
    });

    it('wraps a long name instead of pushing the button off the row', () => {
        renderRow('Maximilian-Alexander Featherstonehaugh-Cholmondeley');
        const heading = screen.getByRole('heading');

        expect(getComputedStyle(heading.parentElement as HTMLElement).flexShrink).toBe('1');
        expect(screen.getByRole('button', { name: 'Profile, Eliza' })).toBeTruthy();
    });

    it('draws the header without an action when there is none', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
        renderWithProviders(<HomeGreeting />, { locale: 'en' });

        expect(screen.getByRole('heading', { name: 'Good afternoon' })).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
