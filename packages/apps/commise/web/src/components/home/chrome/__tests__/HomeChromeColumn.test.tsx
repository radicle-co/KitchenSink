// @vitest-environment jsdom
/**
 * The shell tells the snackbar host where its `<main>` column is (issue 508): the host centres the snackbar over
 * that measured box, so beside the sidebar it never covers it, and a sidebar collapse moves it because the shell
 * watches `<main>` as well as the tab bar (the tab bar is hidden at the width the sidebar shows).
 */
import '@commise/ui/testing/resize-observer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { homeMessages } from '@commise/features-core/home';
import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { ScrollHost } from '@commise/ui/scroll-host';
import { SnackbarHost, useSnackbar } from '@commise/ui/snackbar';
import { reportResizeOf, resizeObserver } from '@commise/ui/testing/resize-observer';

import { webMessages } from '@/i18n/messages';

import { HomeChrome } from '../HomeChrome';
import { SidebarPreferenceProvider } from '../sidebarPreferenceContext';

vi.mock('next/navigation', () => ({ usePathname: () => '/en' }));

const chrome = { ...homeMessages.en.chrome, ...webMessages.en.home.chrome };

afterEach(() => {
    cleanup();
    resizeObserver.observed.clear();
    vi.restoreAllMocks();
});

const ShowButton = (): ReactNode => {
    const { show } = useSnackbar();

    return (
        <button type="button" onClick={() => show({ message: 'Removed Pasta' })}>
            show
        </button>
    );
};

/** A viewport `width` wide with `<main>` laid out from `left` to `right`; the other boxes are empty. */
const layOut = (width: number, main: { left: number; right: number }): void => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return (this.tagName === 'MAIN' ? { ...main, height: 0 } : { height: 0 }) as DOMRect;
    });
};

const renderShell = (): void => {
    render(
        <SnackbarHost>
            <ShowButton />
            <SidebarPreferenceProvider collapsed={false}>
                <ScrollHost>
                    <HomeChrome
                        chrome={chrome}
                        locale="en"
                        liveCapabilities={[RECIPE_HOME_WIDGET_CAPABILITY]}
                        activeId="home"
                        profile={{ status: 'ready', name: 'Eliza' }}
                        newRecipe={(): ReactNode => <span />}
                    >
                        <h1>Page</h1>
                    </HomeChrome>
                </ScrollHost>
            </SidebarPreferenceProvider>
        </SnackbarHost>,
    );
};

/** The host's status region, found from the message it holds, not by its place among the page's live regions. */
const region = (): HTMLElement => {
    const host = screen.getByText('Removed Pasta').closest('[role="status"]');

    if (!(host instanceof HTMLElement)) {
        throw new Error('The snackbar is not inside a status region.');
    }

    return host;
};

describe('HomeChrome (web), the snackbar column', () => {
    it('centres the snackbar over `<main>`, beside the sidebar, at 1024', () => {
        layOut(1024, { left: 256, right: 1024 });
        renderShell();
        fireEvent.click(screen.getByRole('button', { name: 'show' }));

        expect(region().style.left).toBe('256px');
        expect(region().style.right).toBe('0px');
    });

    it('follows a sidebar collapse, which resizes only `<main>`', () => {
        layOut(1024, { left: 256, right: 1024 });
        renderShell();
        fireEvent.click(screen.getByRole('button', { name: 'show' }));
        const main = screen.getByRole('main');

        layOut(1024, { left: 72, right: 1024 });
        act(() => {
            reportResizeOf(new Set([main]));
        });

        // Kills: a watch on the tab bar alone, which is hidden where the sidebar shows.
        expect(region().style.left).toBe('72px');
    });

    it('changes nothing where `<main>` spans the viewport, as below the width the sidebar shows', () => {
        layOut(600, { left: 0, right: 600 });
        renderShell();
        fireEvent.click(screen.getByRole('button', { name: 'show' }));

        expect(region().style.left).toBe('0px');
        expect(region().style.right).toBe('0px');
    });
});
