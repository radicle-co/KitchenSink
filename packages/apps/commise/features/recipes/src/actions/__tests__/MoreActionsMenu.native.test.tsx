/**
 * Native component tests for the "More" overflow menu (C4 wireframe parity), rendered via react-native-web
 * under jsdom. Mirrors the web leaf's closed/open states and action reachability; outside-click/Escape
 * dismissal is a web-only affordance (there is no pointer-outside or keyboard concept to mirror on-device),
 * so this file covers what native actually offers: open via the trigger, every action reachable, and
 * toggling closed by re-pressing the trigger.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { MoreActionsMenu } from '../MoreActionsMenu.native.js';

afterEach(cleanup);

describe('MoreActionsMenu (native)', () => {
    it('renders a closed disclosure: the trigger is present, the menu and its actions are not', () => {
        render(
            <MoreActionsMenu>
                <button type="button">Version history</button>
            </MoreActionsMenu>,
        );

        expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull();
    });

    it('opens the menu on trigger press, exposing every action by role and name', async () => {
        const user = userEvent.setup();
        render(
            <MoreActionsMenu>
                <button type="button">Version history</button>
                <button type="button">Delete recipe</button>
            </MoreActionsMenu>,
        );

        await user.click(screen.getByRole('button', { name: 'More' }));

        expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Version history' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete recipe' })).toBeTruthy();
    });

    it('invokes the child action’s own handler when pressed inside the open menu', async () => {
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

    it('re-pressing the trigger toggles the menu closed', async () => {
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
});
