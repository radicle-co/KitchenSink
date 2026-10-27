// @vitest-environment jsdom
/**
 * Component tests for the web `SeeWhy`: the visible disclosure that opens a line's reason in place (owner design
 * 2026-10-26, "INTERACTION GAPS"). It was a spoken-only control (the reason went to the polite region and nowhere else);
 * a cook who cannot hear it, or who looks away, never saw why. Now the link toggles `aria-expanded`, the reason opens
 * under the row, it is announced once (on opening), and tapping again closes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SeeWhy } from '../SeeWhy.js';

afterEach(cleanup);

const REASON = 'Our check did not run this month, so this is our best guess.';

function renderWhy(name?: string) {
    const onOpen = vi.fn();

    render(<SeeWhy label="See why" reason={REASON} onOpen={onOpen} {...(name === undefined ? {} : { name })} />);

    return { onOpen };
}

describe('SeeWhy (web)', () => {
    it('starts closed: a collapsed disclosure button, no reason on screen', () => {
        renderWhy();

        expect(screen.getByRole('button', { name: 'See why' }).getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText(REASON)).toBeNull();
    });

    it('⛔ opens the reason in place, announces it once, and closes on a second press without announcing again', () => {
        const { onOpen } = renderWhy();
        const button = screen.getByRole('button', { name: 'See why' });

        fireEvent.click(button);

        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText(REASON)).toBeTruthy();
        expect(onOpen).toHaveBeenCalledTimes(1);

        fireEvent.click(button);

        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText(REASON)).toBeNull();
        expect(onOpen).toHaveBeenCalledTimes(1);

        fireEvent.click(button);

        expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it('draws the reason in the 14 px muted meta role', () => {
        renderWhy();
        fireEvent.click(screen.getByRole('button', { name: 'See why' }));

        const reason = screen.getByText(REASON);

        expect(reason.className).toContain('text-meta');
        expect(reason.className).toContain('text-ink-muted');
    });

    it('takes a longer accessible name that starts with the visible words (WCAG 2.5.3)', () => {
        renderWhy('See why our check suggested Butter for 3 tbsp butter');

        expect(screen.getByRole('button', { name: /^See why our check suggested Butter/u })).toBeTruthy();
    });
});
