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
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { webMessages } from '@/i18n/messages';

import { HomeTopBar } from '../HomeTopBar';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

const renderTopBar = (overrides: Partial<Parameters<typeof HomeTopBar>[0]> = {}): void => {
    render(
        <HomeTopBar
            chrome={chrome}
            pageTitle={chrome.pageTitles.home}
            locale="en"
            displayName="Jane Doe"
            onOpenNav={vi.fn()}
            {...overrides}
        />,
    );
};

describe('HomeTopBar', () => {
    it('renders the CALLER-supplied page title in a banner landmark', () => {
        renderTopBar({ pageTitle: chrome.pageTitles.recipes });

        const banner = screen.getByRole('banner');
        expect(banner).toBeTruthy();
        expect(within(banner).getByText(chrome.pageTitles.recipes)).toBeTruthy();
        // The bar no longer hard-codes Home's title for every shell route.
        expect(within(banner).queryByText(chrome.pageTitles.home)).toBeNull();
    });

    /**
     * The bar's title is orientational CHROME that repeats on every route — the page's own `<main>` content
     * owns the authoritative `<h1>`. Exposing the chrome title as a heading too gave every shell route TWO
     * `h1`s, and once the title became per-route it would additionally be a SECOND heading with the SAME
     * accessible name as the page's `h1` — ambiguous for heading navigation (and for `getByRole('heading')`).
     * The `<header>` banner landmark is the structural anchor; the title inside it is plain text.
     */
    it('exposes the title as plain text, NOT as a heading (the page content owns the h1)', () => {
        renderTopBar({ pageTitle: chrome.pageTitles.recipes });

        expect(screen.queryByRole('heading')).toBeNull();
        expect(screen.queryByRole('heading', { name: chrome.pageTitles.recipes })).toBeNull();
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

    it('floors every icon control and the avatar to a 44px touch target at base, reset at md (U5)', () => {
        renderTopBar();

        // A base `min-h-11 min-w-11` (44px) floor guarantees the mobile touch-target minimum regardless of
        // future icon/padding tweaks, reset to `md:min-h-0 md:min-w-0` so desktop density is untouched. It is
        // a floor below the controls' current computed size, so it changes no pixels at any breakpoint today.
        const targets = [
            screen.getByRole('button', { name: chrome.openNav }),
            screen.getByRole('button', { name: chrome.search }),
            screen.getByRole('button', { name: chrome.notifications }),
            screen.getByRole('link', { name: chrome.account }),
        ];

        for (const target of targets) {
            expect(target.className).toContain('min-h-11');
            expect(target.className).toContain('min-w-11');
            expect(target.className).toContain('md:min-h-0');
            expect(target.className).toContain('md:min-w-0');
        }
    });
});
