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

import { palette, semantic } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';

import { cssColor } from '../../__tests__/cssColor.js';

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

/**
 * The trigger's control quality, which the DS `Button` would normally supply. This trigger deliberately is
 * NOT that component (it must announce disclosure `expanded` state, which `ButtonProps` does not model — see
 * the leaf's own comment), so the properties the DS would have guaranteed are asserted directly here. Without
 * these, "we kept the Pressable for a good reason" quietly becomes "we kept an off-palette 36pt control".
 */
describe('MoreActionsMenu (native) — trigger control quality', () => {
    const renderMenu = () =>
        render(
            <MoreActionsMenu>
                <button type="button">Version history</button>
            </MoreActionsMenu>,
        );

    it('announces its disclosure state, collapsed then expanded', async () => {
        const user = userEvent.setup();
        renderMenu();
        const trigger = screen.getByRole('button', { name: 'More' });

        // This is the whole reason the control is not a DS Button — so it must actually be true.
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        await user.click(trigger);

        expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('true');
    });

    it('meets the 44pt touch floor the DS Button would have guaranteed', () => {
        renderMenu();

        expect(window.getComputedStyle(screen.getByRole('button', { name: 'More' })).minHeight).toBe('44px');
    });

    it('wears the DS secondary surface — the shared border token, not an ad-hoc mist hairline', () => {
        renderMenu();
        const style = window.getComputedStyle(screen.getByRole('button', { name: 'More' }));

        expect(style.borderTopColor).toBe(semantic.border);
        expect(style.backgroundColor).toBe(cssColor(palette.white));
    });

    it('rounds the trigger from the radius scale, not a magic 999', () => {
        renderMenu();

        expect(window.getComputedStyle(screen.getByRole('button', { name: 'More' })).borderTopLeftRadius).toBe(
            `${nativeTokens.radius.full}px`,
        );
    });
});
