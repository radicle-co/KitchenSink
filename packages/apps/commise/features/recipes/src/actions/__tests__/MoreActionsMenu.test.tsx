// @vitest-environment jsdom
/**
 * Component tests for the web "More" overflow menu (C4 wireframe parity) — the disclosure that groups the
 * recipe-detail header's secondary owner actions behind one `[More]` control. Covers the closed/open states,
 * that every child action is reachable by role/name once opened, and the keyboard/outside-click dismiss
 * paths a real disclosure needs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { buttonSurfaceClass } from '@commise/ui/button';

import { MoreActionsMenu } from '../MoreActionsMenu.js';

afterEach(cleanup);

describe('MoreActionsMenu (web)', () => {
    it('renders a closed disclosure: the trigger is present, the menu and its actions are not', () => {
        render(
            <MoreActionsMenu>
                <button type="button">Version history</button>
            </MoreActionsMenu>,
        );

        const trigger = screen.getByRole('button', { name: 'More' });
        expect(trigger).toBeTruthy();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull();
    });

    it('opens the menu on trigger click, exposing every action by role and name', async () => {
        const user = userEvent.setup();
        render(
            <MoreActionsMenu>
                <button type="button">Version history</button>
                <button type="button">Delete recipe</button>
            </MoreActionsMenu>,
        );

        await user.click(screen.getByRole('button', { name: 'More' }));

        expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Version history' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete recipe' })).toBeTruthy();
    });

    it('invokes the child action’s own handler when clicked inside the open menu', async () => {
        const onSelect = vi.fn();
        const user = userEvent.setup();
        render(
            <MoreActionsMenu>
                <button type="button" onClick={onSelect}>
                    Delete recipe
                </button>
            </MoreActionsMenu>,
        );

        await user.click(screen.getByRole('button', { name: 'More' }));
        await user.click(screen.getByRole('button', { name: 'Delete recipe' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        render(
            <MoreActionsMenu>
                <button type="button">Version history</button>
            </MoreActionsMenu>,
        );

        const trigger = screen.getByRole('button', { name: 'More' });
        await user.click(trigger);
        expect(screen.getByRole('menu')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('closes when a click lands outside the menu', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <MoreActionsMenu>
                    <button type="button">Version history</button>
                </MoreActionsMenu>
                <button type="button">Elsewhere</button>
            </div>,
        );

        await user.click(screen.getByRole('button', { name: 'More' }));
        expect(screen.getByRole('menu')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('re-clicking the trigger toggles the menu closed', async () => {
        const user = userEvent.setup();
        render(
            <MoreActionsMenu>
                <button type="button">Version history</button>
            </MoreActionsMenu>,
        );

        const trigger = screen.getByRole('button', { name: 'More' });
        await user.click(trigger);
        expect(screen.getByRole('menu')).toBeTruthy();

        await user.click(trigger);

        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('wears the design-system secondary surface (palette + 44px touch floor), not a hand-rolled pill', () => {
        render(
            <MoreActionsMenu>
                <button type="button">Version history</button>
            </MoreActionsMenu>,
        );

        // The trigger must own its own `ref` (focus return on Escape), so it cannot be the `Button` COMPONENT —
        // it applies the shared DS surface recipe instead, which is what keeps it from drifting.
        expect(screen.getByRole('button', { name: 'More' }).className).toBe(buttonSurfaceClass('secondary'));
    });
});
