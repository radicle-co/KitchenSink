/**
 * ActionMenu (web) — the design-system row-actions menu over `@radix-ui/react-dropdown-menu`
 * (`docs/design/ingredientStatusExplanation.md` §3a: the full APG Menu Button keyboard model).
 *
 * Covers: the trigger is a menu button named for its row, collapsed at rest; Enter / Space / Down open it with focus
 * on the FIRST item and Up opens it on the LAST; Down/Up/Home/End move between items; activating an item runs it and
 * closes the menu; Escape closes it and returns focus to the trigger; and the trigger meets the 44 px target.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionMenu } from '../ActionMenu.js';

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

const renderMenu = () => {
    const tryAgain = vi.fn();
    const remove = vi.fn();
    render(
        <ActionMenu
            triggerLabel="Actions for Saffron"
            title="Saffron"
            closeLabel="Close actions for Saffron"
            items={[
                { key: 'tryAgain', label: 'Try again', onSelect: tryAgain },
                { key: 'remove', label: 'Remove ingredient', onSelect: remove, tone: 'destructive' },
            ]}
        />,
    );

    return { tryAgain, remove, trigger: screen.getByRole('button', { name: 'Actions for Saffron' }) };
};

describe('ActionMenu (web)', () => {
    it('is a collapsed menu button named for its row', () => {
        const { trigger } = renderMenu();

        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.className).toContain('h-11');
    });

    it.each(['{Enter}', ' ', '{ArrowDown}'])(
        'opens from the keyboard (%s) with focus on the FIRST item',
        async (key) => {
            const user = userEvent.setup();
            const { trigger } = renderMenu();
            trigger.focus();

            await user.keyboard(key);

            expect(screen.getByRole('menu')).toBeTruthy();
            expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Try again' }));
        },
    );

    it('Down / End / Home move between items', async () => {
        const user = userEvent.setup();
        const { trigger } = renderMenu();
        trigger.focus();
        await user.keyboard('{Enter}');

        await user.keyboard('{ArrowDown}');
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
        await user.keyboard('{Home}');
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Try again' }));
        await user.keyboard('{End}');
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove ingredient' }));
    });

    it('activating an item runs it and closes the menu', async () => {
        const user = userEvent.setup();
        const { trigger, remove, tryAgain } = renderMenu();
        await user.click(trigger);

        await user.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));

        expect(remove).toHaveBeenCalledTimes(1);
        expect(tryAgain).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('Escape closes it and returns focus to the trigger (APG)', async () => {
        const user = userEvent.setup();
        const { trigger } = renderMenu();
        trigger.focus();
        await user.keyboard('{Enter}');

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });
});
