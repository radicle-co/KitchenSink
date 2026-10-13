/**
 * Tooltip (web) — the design-system label for a control whose name is already its own, drawn in a portal so a clipping
 * ancestor (the collapsed sidebar rail's `overflow-y-auto`, W-02) cannot cut it, and meeting WCAG 1.4.13 for hover and
 * focus content: it SHOWS on hover and on keyboard focus, is DISMISSIBLE with Escape without moving the pointer or the
 * focus, is HOVERABLE (the pointer can move onto it) and PERSISTENT (it stays until the pointer and the focus leave).
 *
 * The tip is visual only (`aria-hidden`): the wrapped control's own accessible name carries the words, so a screen
 * reader hears the name once, not twice.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tooltip } from '../Tooltip.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('dir');
});

/** The tip: the portalled, aria-hidden element carrying the words (an aria-hidden node is outside `getByRole`). */
const tip = (): HTMLElement | null => document.body.querySelector('[data-tooltip]');

const renderTooltip = (): HTMLElement => {
    render(
        <div data-rail="" style={{ overflow: 'hidden', width: 80 }}>
            <Tooltip label="New recipe">
                <button type="button" aria-label="New recipe">
                    +
                </button>
            </Tooltip>
            <button type="button">Elsewhere</button>
        </div>,
    );

    return screen.getByRole('button', { name: 'New recipe' });
};

describe('Tooltip (web)', () => {
    it('draws nothing at rest', () => {
        renderTooltip();

        expect(tip()).toBeNull();
    });

    it('leaves the wrapped control exactly as it was: its own name, and no description or role added', () => {
        const button = renderTooltip();

        expect(button.getAttribute('aria-describedby')).toBeNull();
        expect(button.getAttribute('aria-label')).toBe('New recipe');
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('shows on hover, in a portal OUTSIDE the clipping ancestor, hidden from assistive technology', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.hover(button);

        const shown = tip();

        expect(shown?.textContent).toBe('New recipe');
        expect(shown?.getAttribute('aria-hidden')).toBe('true');
        expect(shown?.closest('[data-rail]')).toBeNull();
        expect(shown?.parentElement).toBe(document.body);
    });

    it('hides when the pointer leaves', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.hover(button);
        await user.unhover(button);

        expect(tip()).toBeNull();
    });

    // A browser reports a move from one element to the next as ONE `pointerout` carrying the element it entered, which
    // is what React turns into leave/enter. `userEvent.hover` jumps the pointer with no `relatedTarget`, which reads as
    // leaving the window, so this fires the browser's own event pair.
    it('stays while the pointer moves onto the tip itself, and hides when it leaves the tip (SC 1.4.13 hoverable)', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.hover(button);

        const shown = tip() as HTMLElement;

        fireEvent.pointerOut(button, { relatedTarget: shown, pointerType: 'mouse' });
        fireEvent.pointerOver(shown, { relatedTarget: button, pointerType: 'mouse' });

        expect(tip()).not.toBeNull();

        fireEvent.pointerOut(shown, { relatedTarget: document.body, pointerType: 'mouse' });
        fireEvent.pointerOver(document.body, { relatedTarget: shown, pointerType: 'mouse' });

        expect(tip()).toBeNull();
    });

    it('shows on keyboard focus and hides on blur', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.tab();

        expect(document.activeElement).toBe(button);
        expect(tip()?.textContent).toBe('New recipe');

        await user.tab();

        expect(tip()).toBeNull();
    });

    it('does not show for a focus a pointer caused (not focus-visible)', () => {
        const button = renderTooltip();
        const matches = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
            return selector === ':focus-visible' ? false : Element.prototype.matches.call(this, selector);
        });

        fireEvent.focus(button);

        expect(matches).toHaveBeenCalledWith(':focus-visible');
        expect(tip()).toBeNull();
    });

    it('does not show for a touch, which has no hover to leave', () => {
        const button = renderTooltip();

        fireEvent.pointerEnter(button, { pointerType: 'touch' });

        expect(tip()).toBeNull();
    });

    it('is dismissed by Escape while hovered, without the pointer moving (SC 1.4.13 dismissible)', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.hover(button);
        await user.keyboard('{Escape}');

        expect(tip()).toBeNull();
    });

    it('is dismissed by Escape while focused, and stays dismissed until the control is left', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.tab();
        await user.keyboard('{Escape}');

        expect(tip()).toBeNull();
        // Still focused, still dismissed: a repeat is not a new engagement.
        expect(document.activeElement).toBe(button);

        await user.tab();
        await user.tab({ shift: true });

        expect(tip()?.textContent).toBe('New recipe');
    });

    it('stays dismissed while the other of hover and focus is still engaged', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.tab();
        await user.hover(button);
        await user.keyboard('{Escape}');
        await user.unhover(button);

        expect(tip()).toBeNull();
    });

    it('puts the tip on the control’s end side: right in a left-to-right page, left in a right-to-left one', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.hover(button);
        expect(tip()?.getAttribute('data-placement')).toBe('right');
        await user.unhover(button);

        document.documentElement.dir = 'rtl';
        await user.hover(button);

        expect(tip()?.getAttribute('data-placement')).toBe('left');
    });

    it('joins the tip to the control by padding on the control’s side, so the pointer can cross onto it', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();

        await user.hover(button);

        expect(tip()?.className.split(' ')).toContain('pl-4');
    });

    it('removes its listeners when it closes, so a later Escape elsewhere is not intercepted', async () => {
        const user = userEvent.setup();
        const button = renderTooltip();
        const remove = vi.spyOn(document, 'removeEventListener');

        await user.hover(button);
        await user.unhover(button);

        expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
});
