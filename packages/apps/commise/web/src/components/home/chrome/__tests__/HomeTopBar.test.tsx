// @vitest-environment jsdom
/**
 * Component tests for the sticky Home top bar (US-000 / FR-046).
 *
 * The two decisions this bar makes over the mockup are what these lock in: the notification bell carries NO
 * fabricated count (there is no notifications feed in v1), and the avatar shows the viewer's REAL initials —
 * or, for a name-less account, a fallback glyph and no invented letters. Plus the hamburger opens the mobile
 * nav. Selectors are role/label only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { webMessages } from '@/i18n/messages';

import { HomeTopBar } from '../HomeTopBar';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

const renderTopBar = (overrides: Partial<Parameters<typeof HomeTopBar>[0]> = {}): void => {
    render(<HomeTopBar chrome={chrome} locale="en" displayName="Jane Doe" onOpenNav={vi.fn()} {...overrides} />);
};

describe('HomeTopBar', () => {
    it('renders the page title in a banner landmark', () => {
        renderTopBar();

        expect(screen.getByRole('banner')).toBeTruthy();
        expect(screen.getByRole('heading', { name: chrome.pageTitle })).toBeTruthy();
    });

    it('exposes the search and notifications affordances by accessible name', () => {
        renderTopBar();

        expect(screen.getByRole('button', { name: chrome.search })).toBeTruthy();
        expect(screen.getByRole('button', { name: chrome.notifications })).toBeTruthy();
    });

    it('shows NO notification count — a v1 with no feed must not fabricate one', () => {
        renderTopBar();

        // The bell control (and the whole bar) must contain no digit — the mockup's "3" badge is fabricated.
        expect(screen.getByRole('button', { name: chrome.notifications }).textContent).not.toMatch(/\d/u);
        expect(screen.getByRole('banner').textContent).not.toMatch(/\d/u);
    });

    it('derives the avatar initials from the real display name', () => {
        renderTopBar({ displayName: 'Jane Doe' });

        const account = screen.getByRole('link', { name: chrome.account });
        expect(account.textContent).toBe('JD');
        expect(account.getAttribute('href')).toBe('/en/profile');
    });

    it('falls back to a glyph (never invented initials) and a name-less accessible name when unknown', () => {
        renderTopBar({ displayName: undefined });

        // The name-less account is a real state (email sign-up). Its accessible name is the "no name"
        // variant, and it shows NO letters at all — not a guessed initial.
        const account = screen.getByRole('link', { name: chrome.accountNoName });
        expect(account.textContent).toBe('');
        expect(screen.queryByRole('link', { name: chrome.account })).toBeNull();
    });

    it('opens the mobile navigation when the hamburger is activated', async () => {
        const onOpenNav = vi.fn();
        renderTopBar({ onOpenNav });

        await userEvent.setup().click(screen.getByRole('button', { name: chrome.openNav }));

        expect(onOpenNav).toHaveBeenCalledOnce();
    });
});
