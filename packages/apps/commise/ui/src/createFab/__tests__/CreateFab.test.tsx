/**
 * The web CreateFab (buildSpec §3.4): named by its label in every form; extended at the top, a disc while a phone
 * scrolls down; hidden with the keyboard and in first run; a disc when its label takes more than half the window; gone
 * from 840 (the sidebar holds it); solid `action` (D13: web is never glass).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ScrollHost } from '../../scrollHost/ScrollHost.js';
import { CreateFab } from '../CreateFab.js';

let coarse = false;
let twinWidth = 100;

beforeEach(() => {
    coarse = false;
    twinWidth = 100;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const width = this.getAttribute('aria-hidden') === 'true' ? twinWidth : 0;

        return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const renderFab = (firstRun = false, onPress = vi.fn()) =>
    render(
        <ScrollHost>
            <input aria-label="Search your recipes" />
            <CreateFab label="New recipe" icon="plus" onPress={onPress} firstRun={firstRun} />
        </ScrollHost>,
    );

const fab = (): HTMLElement => screen.getByRole('button', { name: 'New recipe' });

describe('CreateFab (web)', () => {
    it('is a button named by its label that runs the create action', () => {
        const onPress = vi.fn();
        renderFab(false, onPress);

        fireEvent.click(fab());

        expect(onPress).toHaveBeenCalledOnce();
        expect(fab().getAttribute('data-presentation')).toBe('extended');
    });

    it('shrinks to a disc while a phone scrolls down, keeping its name, and grows back on scroll up', async () => {
        renderFab();

        act(() => {
            Object.defineProperty(window, 'scrollY', { configurable: true, value: 600 });
            window.dispatchEvent(new Event('scroll'));
        });
        await waitFor(() => expect(fab().getAttribute('data-presentation')).toBe('icon'));
        expect(screen.getByText('New recipe', { selector: '.sr-only' })).toBeTruthy();

        act(() => {
            Object.defineProperty(window, 'scrollY', { configurable: true, value: 200 });
            window.dispatchEvent(new Event('scroll'));
        });
        await waitFor(() => expect(fab().getAttribute('data-presentation')).toBe('extended'));
    });

    it('hides while the on-screen keyboard is open', () => {
        coarse = true;
        renderFab();

        act(() => screen.getByLabelText('Search your recipes').focus());

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('is not drawn in the first-run state', () => {
        renderFab(true);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('stays a disc when its label is wider than half the window', async () => {
        twinWidth = 250;
        renderFab();

        await waitFor(() => expect(fab().getAttribute('data-presentation')).toBe('icon'));
    });

    it('is a solid action surface at the trailing corner, above the bottom chrome, and gone from 840', () => {
        renderFab();

        expect(fab().className).toContain('bg-action');
        expect(fab().className).toContain('end-4');
        expect(fab().className).toContain('bottom-[calc(var(--bottom-chrome,0px)+1rem)]');
        expect(fab().className).toContain('nav:hidden');
    });
});
