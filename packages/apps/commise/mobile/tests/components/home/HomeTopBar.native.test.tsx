/**
 * Component tests for the mobile Home top bar (US-000 / FR-046). Rendered via react-native-web under jsdom.
 * The avatar shows the viewer's REAL initials, or — for a name-less account — a neutral fallback and a
 * "your account" accessible name, never invented letters. The avatar routes to the account surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';

import { HomeTopBar } from '../../../src/components/home/chrome/HomeTopBar.js';
import { mobileMessages } from '../../../src/i18n/messages.js';

afterEach(cleanup);

const chrome = mobileMessages.en.home.chrome;

const renderTopBar = (overrides: Partial<Parameters<typeof HomeTopBar>[0]> = {}): (() => void) => {
    const onOpenAccount = vi.fn();
    render(
        <LocaleProvider locale="en">
            <HomeTopBar chrome={chrome} displayName="Jane Doe" onOpenAccount={onOpenAccount} {...overrides} />
        </LocaleProvider>,
    );

    return onOpenAccount;
};

describe('HomeTopBar (mobile)', () => {
    it('renders the page title', () => {
        renderTopBar();

        expect(screen.getByText(chrome.pageTitle)).toBeTruthy();
    });

    it('derives the avatar initials from the real display name', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        const account = screen.getByRole('button', { name: chrome.account });
        expect(account.textContent).toBe('JD');
    });

    it('falls back to a neutral glyph (never invented initials) and a name-less label when unknown', () => {
        renderTopBar({ displayName: undefined });

        const account = screen.getByRole('button', { name: chrome.accountNoName });
        // A neutral dot, not a guessed letter.
        expect(account.textContent).toBe('·');
        expect(screen.queryByRole('button', { name: chrome.account })).toBeNull();
    });

    it('routes to the account surface when the avatar is activated', () => {
        const onOpenAccount = renderTopBar();

        fireEvent.click(screen.getByRole('button', { name: chrome.account }));

        expect(onOpenAccount).toHaveBeenCalledOnce();
    });

    it('shows no fabricated notification count', () => {
        renderTopBar();

        // No digit anywhere in the bar — the top bar carries no notifications feed in v1.
        expect(screen.queryByText(/\d/u)).toBeNull();
    });
});
