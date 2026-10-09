// @vitest-environment jsdom
/**
 * The web "More actions" overflow on the recipe detail — the owner's secondary actions behind one `⋯` trigger.
 *
 * ⚠️ REWRITTEN in UI-overhaul slice 2 (`docs/architecture/uiOverhaulBlueprint.md` Part B, finding D2):
 *  - the trigger is the `ellipsis` glyph named "More actions for {title}" (spec key `detail.moreActions`), never a bare
 *    "More" — a list of identical names is unusable by voice control and a screen-reader rotor;
 *  - the panel is the design system's Popover: portaled and collision-aware, so it keeps clear of the shell's bottom
 *    tab bar instead of opening under it (D2). Its role is therefore a non-modal `dialog` rather than the old
 *    `menu`, which was wrong for its content — links and a radio group inside `role="menu"`;
 *  - the destructive action is a structural slot drawn last, after a divider (spec §1.11).
 * The visibility control keeps its behaviour exactly; turning it into menu items is the slice-6 detail redesign.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MoreActionsMenu } from '../MoreActionsMenu.js';

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's popover calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

const TRIGGER = 'More actions for Lemon tart';

const renderMenu = (onDelete = vi.fn(), onHistory = vi.fn()) =>
    render(
        <MoreActionsMenu
            recipeTitle="Lemon tart"
            destructive={
                <button type="button" onClick={onDelete}>
                    Delete recipe
                </button>
            }
        >
            <button type="button" onClick={onHistory}>
                Version history
            </button>
        </MoreActionsMenu>,
    );

describe('MoreActionsMenu (web)', () => {
    it('is a collapsed ⋯ trigger named for the recipe, its actions not yet shown', () => {
        renderMenu();

        const trigger = screen.getByRole('button', { name: TRIGGER });

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.querySelector('svg.lucide-ellipsis')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull();
    });

    it('opens a panel holding every action', async () => {
        const user = userEvent.setup();
        renderMenu();

        await user.click(screen.getByRole('button', { name: TRIGGER }));

        const panel = screen.getByRole('dialog', { name: 'More actions' });

        expect(screen.getByRole('button', { name: TRIGGER }).getAttribute('aria-expanded')).toBe('true');
        expect(within(panel).getByRole('button', { name: 'Version history' })).toBeTruthy();
        expect(within(panel).getByRole('button', { name: 'Delete recipe' })).toBeTruthy();
    });

    it('draws the destructive action last, after a divider', async () => {
        const user = userEvent.setup();
        renderMenu();

        await user.click(screen.getByRole('button', { name: TRIGGER }));

        const panel = screen.getByRole('dialog', { name: 'More actions' });
        // Document order of the actions and the divider (an `<hr>` IS a `separator`), the panel's Close aside.
        const order = [...panel.querySelectorAll('button, [role="separator"], hr')]
            .filter((element) => element.getAttribute('aria-label') !== 'Close more actions')
            .map((element) => (element.tagName === 'HR' ? 'separator' : element.textContent));

        expect(within(panel).getByRole('separator')).toBeTruthy();
        expect(order).toStrictEqual(['Version history', 'separator', 'Delete recipe']);
    });

    it('draws no divider without a destructive action', async () => {
        const user = userEvent.setup();
        render(
            <MoreActionsMenu recipeTitle="Lemon tart">
                <button type="button">Version history</button>
            </MoreActionsMenu>,
        );

        await user.click(screen.getByRole('button', { name: TRIGGER }));

        expect(screen.queryByRole('separator')).toBeNull();
    });

    it('runs a child action’s own handler', async () => {
        const user = userEvent.setup();
        const onHistory = vi.fn();
        renderMenu(vi.fn(), onHistory);

        await user.click(screen.getByRole('button', { name: TRIGGER }));
        await user.click(screen.getByRole('button', { name: 'Version history' }));

        expect(onHistory).toHaveBeenCalledOnce();
    });

    it('closes on Escape and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        renderMenu();

        await user.click(screen.getByRole('button', { name: TRIGGER }));
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: TRIGGER }));
    });

    it('closes from its own Close control', async () => {
        const user = userEvent.setup();
        renderMenu();

        await user.click(screen.getByRole('button', { name: TRIGGER }));
        await user.click(screen.getByRole('button', { name: 'Close more actions' }));

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
