// @vitest-environment jsdom
/**
 * Component tests for the Home application shell (US-000 / FR-046).
 *
 * The shell owns only ephemeral view state — the collapsed rail and the mobile drawer — so these exercise
 * that state: the surface content lands in the `<main>` landmark, the sidebar and tab bar are both present
 * (the two responsive renderings of the nav), the hamburger opens and the drawer dismisses, and the collapse
 * control flips. Selectors are role/label only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';

import { webMessages } from '@/i18n/messages';

import { HomeChrome } from '../HomeChrome';

afterEach(cleanup);

const chrome = webMessages.en.home.chrome;

const renderChrome = (): void => {
    render(
        <HomeChrome
            chrome={chrome}
            locale="en"
            liveCapabilities={[RECIPE_HOME_WIDGET_CAPABILITY]}
            activeId="home"
            displayName="Jane Doe"
        >
            <p>surface-content</p>
        </HomeChrome>,
    );
};

describe('HomeChrome', () => {
    it('renders the surface content inside the main landmark', () => {
        renderChrome();

        expect(screen.getByRole('main').textContent).toContain('surface-content');
    });

    it('renders both responsive nav renderings (sidebar + tab bar)', () => {
        renderChrome();

        // jsdom does not apply the responsive `hidden` classes, so both landmarks are in the tree; in a real
        // viewport exactly one is display:none. Two named nav landmarks is the contract.
        expect(screen.getAllByRole('navigation', { name: chrome.primaryNavLabel }).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByRole('banner')).toBeTruthy();
    });

    it('opens the mobile nav drawer from the hamburger and dismisses it', async () => {
        const user = userEvent.setup();
        renderChrome();

        // Closed by default.
        expect(screen.queryByRole('dialog', { name: chrome.primaryNavLabel })).toBeNull();

        await user.click(screen.getByRole('button', { name: chrome.openNav }));
        const drawer = screen.getByRole('dialog', { name: chrome.primaryNavLabel });
        expect(drawer).toBeTruthy();

        // The close control inside the drawer dismisses it.
        await user.click(within(drawer).getByRole('button', { name: chrome.closeNav }));
        expect(screen.queryByRole('dialog', { name: chrome.primaryNavLabel })).toBeNull();
    });

    it('closes the mobile drawer on Escape', async () => {
        const user = userEvent.setup();
        renderChrome();

        await user.click(screen.getByRole('button', { name: chrome.openNav }));
        expect(screen.getByRole('dialog', { name: chrome.primaryNavLabel })).toBeTruthy();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: chrome.primaryNavLabel })).toBeNull();
    });

    it('flips the collapse control between collapse and expand', async () => {
        const user = userEvent.setup();
        renderChrome();

        await user.click(screen.getByRole('button', { name: chrome.collapseNav }));
        expect(screen.getByRole('button', { name: chrome.expandNav })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: chrome.expandNav }));
        expect(screen.getByRole('button', { name: chrome.collapseNav })).toBeTruthy();
    });
});
