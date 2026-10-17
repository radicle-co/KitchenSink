/**
 * Web's "Back to top" (buildSpec §3.6): absent until the reader is more than four screens down a page taller than four
 * screens and scrolling up; a labelled secondary button; pressing it scrolls to the top and hands focus back to the H1;
 * hidden with the keyboard; 16 px above a floating create button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ScrollHost } from '../../scrollHost/ScrollHost.js';
import { BackToTop } from '../BackToTop.js';

let coarse = false;

beforeEach(() => {
    coarse = false;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 8000 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

/** Scroll to a y and let the host's frame-throttled sample run, as a real scroll of several frames would. */
const scroll = async (y: number): Promise<void> => {
    await act(async () => {
        Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
        window.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
};

const renderButton = (onReturn = vi.fn(), aboveFab = false) =>
    render(
        <ScrollHost>
            <input aria-label="Search" />
            <BackToTop label="Back to top" onReturn={onReturn} aboveFab={aboveFab} />
        </ScrollHost>,
    );

describe('BackToTop (web)', () => {
    it('is absent at the top of a long page', () => {
        renderButton();

        expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();
    });

    it('stays absent while scrolling DOWN past four screens', async () => {
        renderButton();

        await scroll(3000);
        await scroll(4000);

        await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull());
    });

    it('shows past four screens once the reader scrolls up, and returns to the top and the H1', async () => {
        const onReturn = vi.fn();
        renderButton(onReturn);

        await scroll(4400);
        await scroll(4000);

        const button = await screen.findByRole('button', { name: 'Back to top' });
        fireEvent.click(button);

        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
        expect(onReturn).toHaveBeenCalledOnce();
    });

    it('hides while the on-screen keyboard is open', async () => {
        coarse = true;
        renderButton();

        await scroll(4400);
        await scroll(4000);
        await screen.findByRole('button', { name: 'Back to top' });
        act(() => screen.getByLabelText('Search').focus());

        expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();
    });

    it('sits 16 px above a floating create button where one shows', async () => {
        renderButton(vi.fn(), true);

        await scroll(4400);
        await scroll(4000);
        const button = await screen.findByRole('button', { name: 'Back to top' });

        expect(button.closest('div.fixed')?.className).toContain('bottom-[calc(var(--bottom-chrome,0px)+5.5rem)]');
    });
});
