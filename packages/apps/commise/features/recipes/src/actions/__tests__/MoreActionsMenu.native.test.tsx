/**
 * The native "More actions" overflow on the recipe detail — an inline disclosure under its `⋯` trigger.
 *
 * ⚠️ REWRITTEN in UI-overhaul slice 2 (blueprint Part B): the trigger is the `ellipsis` glyph named "More actions for
 * {title}", 48 dp square on Android and 44 pt on iOS, announcing its disclosure state; the destructive action is a
 * structural slot drawn last, after a divider. The panel stays inline (there is no pointer "outside" on device), and
 * the visibility control inside it keeps its behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Platform, Text } from 'react-native';

import { MoreActionsMenu } from '../MoreActionsMenu.native.js';

afterEach(cleanup);

const TRIGGER = 'More actions for Lemon tart';

function onPlatform(os: 'ios' | 'android'): () => void {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

    return () => Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
}

const renderMenu = (onDelete = vi.fn()) =>
    render(
        <MoreActionsMenu
            recipeTitle="Lemon tart"
            destructive={
                <Text accessibilityRole="button" onPress={onDelete}>
                    Delete recipe
                </Text>
            }
        >
            <Text accessibilityRole="button">Version history</Text>
        </MoreActionsMenu>,
    );

describe('MoreActionsMenu (native)', () => {
    it('is a collapsed ⋯ trigger named for the recipe, its actions not yet shown', () => {
        renderMenu();

        const trigger = screen.getByRole('button', { name: TRIGGER });

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe('ellipsis');
        expect(screen.queryByText('Version history')).toBeNull();
    });

    it('opens inline, announcing expanded, with the destructive action last after a divider', () => {
        renderMenu();

        fireEvent.click(screen.getByRole('button', { name: TRIGGER }));

        const panel = screen.getByRole('group', { name: 'More actions' });
        const order = [...panel.children].map((child) => child.getAttribute('role') ?? child.textContent);

        expect(screen.getByRole('button', { name: TRIGGER }).getAttribute('aria-expanded')).toBe('true');
        expect(order).toStrictEqual(['button', 'separator', 'button']);
        expect(within(panel).getByText('Delete recipe')).toBeTruthy();
    });

    it('runs the destructive action’s own handler', () => {
        const onDelete = vi.fn();
        renderMenu(onDelete);

        fireEvent.click(screen.getByRole('button', { name: TRIGGER }));
        fireEvent.click(screen.getByText('Delete recipe'));

        expect(onDelete).toHaveBeenCalledOnce();
    });

    it('closes when the trigger is pressed again', () => {
        renderMenu();

        fireEvent.click(screen.getByRole('button', { name: TRIGGER }));
        fireEvent.click(screen.getByRole('button', { name: TRIGGER }));

        expect(screen.queryByText('Version history')).toBeNull();
    });

    it('sizes the trigger at 44pt on iOS and 48dp on Android', () => {
        for (const [os, size] of [
            ['ios', '44px'],
            ['android', '48px'],
        ] as const) {
            const restore = onPlatform(os);

            try {
                const { unmount } = renderMenu();
                const style = getComputedStyle(screen.getByRole('button', { name: TRIGGER }));

                expect(style.minWidth, os).toBe(size);
                expect(style.minHeight, os).toBe(size);
                unmount();
            } finally {
                restore();
            }
        }
    });
});
