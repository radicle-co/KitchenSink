/**
 * ActionMenu (native) — the row-actions menu as a bottom sheet of `menuitem` rows (`ingredientStatusExplanation.md`
 * §3a: "Native uses a bottom sheet, which cannot obscure the row").
 *
 * Covers: the trigger is a named, collapsed button at least 48 dp square; a tap opens the sheet listing the items in
 * order as menu items; activating one runs it and closes the sheet; and Close dismisses it without running anything.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionMenu } from '../ActionMenu.native.js';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../../sheet/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));

afterEach(cleanup);

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

describe('ActionMenu (native)', () => {
    it('is a named, collapsed button at least 48 dp square', () => {
        const { trigger } = renderMenu();
        const style = getComputedStyle(trigger);

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(48);
        expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(48);
    });

    it('a tap opens a sheet listing the items, in order, as menu items', () => {
        const { trigger } = renderMenu();

        fireEvent.click(trigger);

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Try again',
            'Remove ingredient',
        ]);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('activating an item runs it and closes the sheet', () => {
        const { trigger, remove } = renderMenu();
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));

        expect(remove).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    it('Close dismisses it without running anything', () => {
        const { trigger, remove, tryAgain } = renderMenu();
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('button', { name: 'Close actions for Saffron' }));

        expect(screen.queryByRole('menuitem')).toBeNull();
        expect(remove).not.toHaveBeenCalled();
        expect(tryAgain).not.toHaveBeenCalled();
    });
});
