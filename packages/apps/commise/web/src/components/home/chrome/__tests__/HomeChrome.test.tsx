// @vitest-environment jsdom
/**
 * The web app shell (`buildSpec.md` §3.2; slice 3): no top bar and no drawer; the sidebar and the tab bar switch at
 * `nav`; `<main>` is the `main` container and reserves the bar plus the floating button; `--bottom-chrome` is the bar's
 * height below `nav` and 0 from it or on a focused task, where the tab bar is gone; and the collapse writes its cookie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { ScrollHost } from '@commise/ui/scroll-host';

import { webMessages } from '@/i18n/messages';

import { HomeChrome } from '../HomeChrome';
import { SIDEBAR_COOKIE } from '../sidebarPreference';
import { SidebarPreferenceProvider } from '../sidebarPreferenceContext';

vi.mock('next/navigation', () => ({ usePathname: () => '/en' }));

const chrome = webMessages.en.home.chrome;

beforeEach(() => {
    document.cookie = `${SIDEBAR_COOKIE}=; max-age=0; path=/`;
});
afterEach(cleanup);

const renderChrome = ({
    focusedTask = false,
    collapsed = false,
}: { focusedTask?: boolean; collapsed?: boolean } = {}) =>
    render(
        <SidebarPreferenceProvider collapsed={collapsed}>
            <ScrollHost>
                <HomeChrome
                    chrome={chrome}
                    locale="en"
                    liveCapabilities={[RECIPE_HOME_WIDGET_CAPABILITY]}
                    activeId="home"
                    profile={{ status: 'ready', name: 'Eliza' }}
                    focusedTask={focusedTask}
                    newRecipe={(railed): ReactNode => <button type="button">{railed ? 'rail' : 'New recipe'}</button>}
                >
                    <h1>Page</h1>
                </HomeChrome>
            </ScrollHost>
        </SidebarPreferenceProvider>,
    );

describe('HomeChrome (web)', () => {
    it('has no top bar, no hamburger and no drawer', () => {
        renderChrome();

        expect(screen.queryByRole('banner')).toBeNull();
        expect(screen.queryByRole('button', { name: /navigation/i })).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('renders both navigations, which CSS switches at nav: the sidebar from 840, the tab bar below', () => {
        renderChrome();

        // Both landmarks are named "Main"; only one is ever displayed, because CSS switches them at `nav`.
        const [sidebarNav, tabBar] = screen.getAllByRole('navigation');

        expect(sidebarNav?.parentElement?.className).toContain('nav:flex');
        expect(tabBar?.hasAttribute('data-tab-bar')).toBe(true);
        expect(tabBar?.className).toContain('nav:hidden');
    });

    it('makes <main> the main container, with the gutters as padding and the bar plus the button reserved at its foot', () => {
        renderChrome();
        const main = screen.getByRole('main');

        expect(main.className).toContain('@container/main');
        expect(main.className).toContain('px-4');
        expect(main.className).toContain('nav:px-8');
        expect(main.className).toContain('pb-[calc(var(--bottom-chrome)+6.5rem)]');
    });

    it('sets --bottom-chrome to the tab bar below nav and 0 from it', () => {
        const { container } = renderChrome();

        expect(container.firstElementChild?.className).toContain(
            '[--bottom-chrome:calc(4rem+env(safe-area-inset-bottom))]',
        );
        expect(container.firstElementChild?.className).toContain('nav:[--bottom-chrome:0px]');
    });

    it('drops the tab bar and zeroes --bottom-chrome on a focused task, whose own bar owns the foot', () => {
        const { container } = renderChrome({ focusedTask: true });

        expect(document.querySelector('[data-tab-bar]')).toBeNull();
        expect(container.firstElementChild?.className).toContain('[--bottom-chrome:0px]');
    });

    it('starts from the server-read preference and writes the collapse to its cookie', () => {
        renderChrome({ collapsed: true });

        expect(screen.getByRole('button', { name: 'rail' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
        expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=expanded`);

        fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
        expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);
    });
});
