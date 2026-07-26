/**
 * Component tests for the mobile Home top bar (US-000 / FR-046). Rendered via react-native-web under jsdom.
 * The avatar shows the viewer's REAL initials, or — for a name-less account — a neutral fallback and a
 * "your account" accessible name, never invented letters. The avatar routes to the account surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { HomeTopBar } from '../../../src/components/home/chrome/HomeTopBar.js';
import { CONTROL_ICONS } from '../../../src/components/home/chrome/icons.js';
import { mobileMessages } from '../../../src/i18n/messages.js';

afterEach(cleanup);

const chrome = mobileMessages.en.home.chrome;

const renderTopBar = (overrides: Partial<Parameters<typeof HomeTopBar>[0]> = {}): (() => void) => {
    const onOpenAccount = vi.fn();
    renderWithProviders(
        <HomeTopBar chrome={chrome} displayName="Jane Doe" onOpenAccount={onOpenAccount} {...overrides} />,
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

    it('gives the account avatar a 44pt touch target (U4 / RC-3)', () => {
        renderTopBar();

        const target = window.getComputedStyle(screen.getByRole('button', { name: chrome.account }));
        expect(target.width).toBe('44px');
        expect(target.height).toBe('44px');
    });
});

describe('HomeTopBar (mobile) — search + notifications affordances (mockup parity)', () => {
    /** The affordance and the glyph the mockup pairs it with. */
    const affordances = [
        { label: chrome.search, icon: CONTROL_ICONS.search },
        { label: chrome.notifications, icon: CONTROL_ICONS.notifications },
    ] as const;

    it('renders both mockup affordances with their glyph', () => {
        renderTopBar();

        for (const { label, icon } of affordances) {
            const control = screen.getByLabelText(`${label}, ${chrome.comingSoonSuffix}`);
            const glyph = control.querySelector('[data-commise-stub="icon"]');

            expect(glyph, `no glyph on the ${label} affordance`).not.toBeNull();
            expect(glyph?.getAttribute('data-icon-name')).toBe(icon);
        }
    });

    it('announces them as coming soon and does NOT present them as working controls', () => {
        renderTopBar();

        for (const { label } of affordances) {
            const control = screen.getByLabelText(`${label}, ${chrome.comingSoonSuffix}`);

            // Neither search nor notifications has a backing service in v1: the affordance is present (the
            // mockup's chrome is intact) but never a button that navigates nowhere — the same honesty the
            // gated tabs carry, and the reason no bare `chrome.search` button exists.
            expect(control.getAttribute('aria-disabled')).toBe('true');
            expect(screen.queryByRole('button', { name: label })).toBeNull();
        }
    });

    it('gives each affordance a 44pt touch target (U4 / RC-3)', () => {
        renderTopBar();

        for (const { label } of affordances) {
            const target = window.getComputedStyle(screen.getByLabelText(`${label}, ${chrome.comingSoonSuffix}`));

            expect(target.minWidth).toBe('44px');
            expect(target.minHeight).toBe('44px');
        }
    });
});
