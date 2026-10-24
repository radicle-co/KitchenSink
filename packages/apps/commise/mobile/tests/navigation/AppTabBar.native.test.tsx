/**
 * The Adapter from React Navigation's tab state to our bar (A6): it emits `tabPress` with `canPreventDefault` exactly
 * as the library's default bar does, navigates to another tab unless a listener prevented it, and never navigates on
 * the active tab (the library's listeners give that second tap its meaning).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { AppTabBar } from '../../src/navigation/AppTabBar.js';

const layout = vi.hoisted(() => ({ compact: false, collapsed: false }));

vi.mock('@commise/ui/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/layout')>()),
    useCompactHeight: () => layout.compact,
    useFrameCollapsed: () => layout.collapsed,
}));

afterEach(() => {
    cleanup();
    layout.compact = false;
    layout.collapsed = false;
});

function renderAdapter(prevent = false, index = 0, insets = { top: 0, bottom: 20, left: 0, right: 0 }) {
    const emit = vi.fn(() => ({ defaultPrevented: prevent }));
    const navigate = vi.fn();
    const routes = [
        { key: 'home-1', name: 'home', params: undefined },
        { key: 'recipes-1', name: 'recipes', params: undefined },
        { key: 'discover-1', name: 'discover', params: undefined },
    ];
    const props = {
        state: { index, routes },
        navigation: { emit, navigate },
        insets,
        descriptors: {},
    } as unknown as BottomTabBarProps;

    render(<AppTabBar {...props} />);

    return { emit, navigate };
}

describe('AppTabBar', () => {
    it('emits a preventable tabPress for the pressed tab, then navigates to it', () => {
        const { emit, navigate } = renderAdapter();

        fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));

        expect(emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'recipes-1', canPreventDefault: true });
        expect(navigate).toHaveBeenCalledWith('recipes', undefined);
    });

    it('does not navigate when a listener prevented the press', () => {
        const { navigate } = renderAdapter(true);

        fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));

        expect(navigate).not.toHaveBeenCalled();
    });

    it('emits but does not navigate on the ACTIVE tab: the library pops it to root or scrolls it to the top', () => {
        const { emit, navigate } = renderAdapter(false, 1);

        fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));

        expect(emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'recipes-1', canPreventDefault: true });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('marks the navigator’s active tab selected', () => {
        renderAdapter(false, 2);

        expect(screen.getByRole('tab', { name: 'Discover' }).getAttribute('aria-selected')).toBe('true');
    });

    // Owner 2026-10-13: the bar goes compact in a window under 480 dp tall, and steps aside while the keyboard is open
    // there (`isFrameCollapsed`), so a sideways phone keeps its field and its keyboard.
    it('draws the compact bar, with the window insets, when the window is compact in height', () => {
        layout.compact = true;
        renderAdapter(false, 0, { top: 0, bottom: 0, left: 48, right: 0 });

        expect(getComputedStyle(screen.getByRole('tab', { name: 'Home' })).flexDirection).toBe('row');
        expect(getComputedStyle(screen.getByRole('tablist')).paddingLeft).toBe('52px');
    });

    it('draws the stacked bar when the window is not compact', () => {
        renderAdapter();

        expect(getComputedStyle(screen.getByRole('tab', { name: 'Home' })).flexDirection).toBe('column');
    });

    it('draws NO bar while compact and the keyboard is open, and brings it back when it closes', () => {
        layout.compact = true;
        layout.collapsed = true;
        renderAdapter();

        expect(screen.queryByRole('tablist')).toBeNull();
        cleanup();

        layout.collapsed = false;
        renderAdapter();

        expect(screen.getByRole('tablist')).toBeTruthy();
    });
});
