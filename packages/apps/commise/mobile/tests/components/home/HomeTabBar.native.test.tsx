/**
 * The native bottom tab bar (`buildSpec.md` §3.2; D6, D14): the three reachable destinations and no "Soon" tab, each a
 * `tab` named by its label; the active one `selected`, its label in the `label` role (weight 600) in `ink` with the
 * here-bar, the rest in the `caption` role (weight 500) in `inkMuted`; on the floating layer's material; padded by the
 * bottom inset; and every press reported — the active tab's too, which is its second tap.
 *
 * The labels are the design-system Text (ADR-0080 §8), so their colour is a Tamagui theme variable: the colour test
 * reads it through `resolvedColour` in each scheme, where it used to read jsdom's computed colour of a React Native
 * style. The here-bar is still painted from `useTheme()`, which follows the device scheme, so it is asserted in light.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import type { HomeNavItemId } from '@commise/features-core';
import { homeMessages } from '@commise/features-core/home';
import { role } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { render, renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

import { HomeTabBar, type HomeTabBarProps } from '../../../src/components/home/chrome/HomeTabBar.js';

afterEach(cleanup);

const chrome = homeMessages.en.chrome;

const barProps = (
    activeId: HomeNavItemId,
    onPress: HomeTabBarProps['onPress'],
    live: readonly string[],
    over: { compact?: boolean; leftInset?: number; rightInset?: number },
): HomeTabBarProps => ({
    chrome,
    liveCapabilities: live,
    activeId,
    onPress,
    bottomInset: 34,
    compact: over.compact ?? false,
    leftInset: over.leftInset ?? 0,
    rightInset: over.rightInset ?? 0,
});

const renderBar = (
    activeId: HomeNavItemId = 'home',
    onPress = vi.fn(),
    live = [RECIPE_HOME_WIDGET_CAPABILITY],
    over: { compact?: boolean; leftInset?: number; rightInset?: number } = {},
) => render(<HomeTabBar {...barProps(activeId, onPress, live, over)} />);

/** The bar in one scheme and at one system text scale, whatever the device reports. */
const renderBarIn = (scheme: 'light' | 'dark', activeId: HomeNavItemId, textScale = 1) =>
    renderWithTamagui(
        <HomeTabBar {...barProps(activeId, vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY], {})} />,
        scheme,
        textScale,
    );

describe('HomeTabBar (native)', () => {
    it('shows exactly Home, Recipes and Discover as tabs, and no "Soon" tab', () => {
        renderBar();

        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Home', 'Recipes', 'Discover']);
        expect(screen.getByRole('tablist', { name: chrome.tabNavLabel }).textContent).not.toMatch(/soon/i);
    });

    it('shows Plan once its capability goes live', () => {
        renderBar('home', vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY, 'meal-planning']);

        expect(screen.getByRole('tab', { name: 'Plan' })).toBeTruthy();
    });

    it('marks the active tab selected, with the here-bar; the rest unselected and without it', () => {
        renderBar('recipes');

        const active = screen.getByRole('tab', { name: 'Recipes' });
        const inactive = screen.getByRole('tab', { name: 'Home' });

        expect(active.getAttribute('aria-selected')).toBe('true');
        expect(inactive.getAttribute('aria-selected')).toBe('false');
        expect(getComputedStyle(active.firstElementChild as Element).backgroundColor).toBe(rgb(role.hereBar));
        expect(getComputedStyle(inactive.firstElementChild as Element).backgroundColor).not.toBe(rgb(role.hereBar));
    });

    // The active label differs in colour AND weight, and keeps the here-bar, so weight is never the only signal.
    it.each(['light', 'dark'] as const)(
        'paints the active label ink and the rest inkMuted in the %s scheme',
        (scheme) => {
            renderBarIn(scheme, 'recipes');

            expect(resolvedColour(screen.getByText('Recipes'), 'color')).toBe(rgb(rolesFor(scheme).ink));
            expect(resolvedColour(screen.getByText('Home'), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
            expect(resolvedColour(screen.getByText('Discover'), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
        },
    );

    it('sets the active label in the label role (weight 600) and the rest in the caption role (weight 500)', () => {
        const { label, caption } = nativeTokens.type;
        renderBarIn('light', 'recipes');

        const active = getComputedStyle(screen.getByText('Recipes'));
        const inactive = getComputedStyle(screen.getByText('Home'));

        expect(active.fontFamily).toContain(label.fontFamily);
        expect(active.fontSize).toBe(`${String(label.fontSize)}px`);
        expect(active.lineHeight).toBe(`${String(label.lineHeight)}px`);
        expect(inactive.fontFamily).toContain(caption.fontFamily);
        expect(inactive.fontSize).toBe(`${String(caption.fontSize)}px`);
        expect(inactive.lineHeight).toBe(`${String(caption.lineHeight)}px`);
    });

    // Designer ruling 2026-11-01 (ADR-0080 §8): a tab label is navigation chrome, so above the system scale it grows to
    // 1.5× and stops there, where the rest of the screen grows to 2×.
    it('grows each label with the system scale to the 1.5× chrome cap, not to 2×', () => {
        const { label, caption } = nativeTokens.type;
        renderBarIn('light', 'recipes', 3.1);

        const active = getComputedStyle(screen.getByText('Recipes'));
        const inactive = getComputedStyle(screen.getByText('Home'));

        expect(active.fontSize).toBe(`${String(label.fontSize * 1.5)}px`);
        expect(active.lineHeight).toBe(`${String(label.lineHeight * 1.5)}px`);
        expect(inactive.fontSize).toBe(`${String(caption.fontSize * 1.5)}px`);
        expect(inactive.lineHeight).toBe(`${String(caption.lineHeight * 1.5)}px`);
    });

    it('grows each label with the system scale below the cap', () => {
        const { caption } = nativeTokens.type;
        renderBarIn('light', 'recipes', 1.25);

        expect(getComputedStyle(screen.getByText('Home')).fontSize).toBe(`${String(caption.fontSize * 1.25)}px`);
    });

    it('reports every press, the active tab’s too (its second tap)', () => {
        const onPress = vi.fn();
        renderBar('home', onPress);

        fireEvent.click(screen.getByRole('tab', { name: 'Discover' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Home' }));

        expect(onPress.mock.calls).toEqual([['discover'], ['home']]);
    });

    it('pads its foot by the bottom safe-area inset, and gives each tab at least a 48 dp target', () => {
        renderBar();

        expect(getComputedStyle(screen.getByRole('tablist')).paddingBottom).toBe('34px');
        expect(getComputedStyle(screen.getByRole('tab', { name: 'Home' })).minHeight).toBe('64px');
    });
});

/**
 * Design review 2026-11-01 (`deviceShots2.md` M-2): at the largest text size "Recipes" and "Discover" wrapped to two
 * lines and "Home" did not, and each tab centred its content in the row's shared height, so the Home glyph sat lower
 * than the other two. The glyph row is one fixed row at the top of every tab, whatever its label does: each column
 * starts at the top, 8 dp down (the row's 1x look: 8 + 24 glyph + 4 + 20 label in 64), glyph first, label under it.
 *
 * ⚠️ jsdom lays nothing out, so these read the column's alignment, not a glyph's position. Only a device proves the row
 * lines up.
 */
describe('HomeTabBar (native) — one glyph row, whatever the labels do', () => {
    const longLabels = { ...chrome, destinations: { ...chrome.destinations, recipes: 'Recipes '.repeat(6).trim() } };

    it('starts every tab’s column at the top, 8 dp down, centred across, when one label is far longer', () => {
        render(<HomeTabBar {...barProps('home', vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY], {})} chrome={longLabels} />);

        for (const tab of screen.getAllByRole('tab')) {
            const style = getComputedStyle(tab);

            expect(style.flexDirection).toBe('column');
            expect(style.justifyContent).toBe('flex-start');
            expect(style.paddingTop).toBe(`${String(nativeTokens.spacing[2])}px`);
            expect(style.alignItems).toBe('center');
        }
    });

    it('draws each tab’s glyph before its label', () => {
        renderBar();

        for (const tab of screen.getAllByRole('tab')) {
            const glyph = tab.querySelector('[data-icon-name]');
            const label = within(tab).getByText(tab.getAttribute('aria-label') ?? '');

            expect(glyph).not.toBeNull();
            expect(glyph!.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });

    it('keeps the compact row centred: there the label sits beside the glyph, not under it', () => {
        renderBar('home', vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY], { compact: true });

        expect(getComputedStyle(screen.getByRole('tab', { name: 'Home' })).justifyContent).toBe('center');
    });
});

/**
 * Owner 2026-10-13: a phone held sideways (the window under 480 dp tall) gets a compact bar — the label beside the glyph,
 * 48 dp tall (44 pt on iOS) — that clears a side cutout or the 3-button navigation bar. The labels stay the accessible
 * names, so nothing a screen reader hears changes.
 */
describe('HomeTabBar (native) — compact height', () => {
    it('puts the label beside the glyph and drops the bar to 48 dp', () => {
        renderBar('home', vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY], { compact: true });

        const tab = screen.getByRole('tab', { name: 'Home' });

        expect(getComputedStyle(tab).flexDirection).toBe('row');
        expect(getComputedStyle(tab).minHeight).toBe('48px');
    });

    it('keeps every label as its tab’s accessible name', () => {
        renderBar('home', vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY], { compact: true });

        expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual([
            'Home',
            'Recipes',
            'Discover',
        ]);
    });

    it('stacks the label under the glyph at 64 dp when the window is not compact', () => {
        renderBar();

        expect(getComputedStyle(screen.getByRole('tab', { name: 'Home' })).flexDirection).toBe('column');
    });

    it('pads each side by its inset so a cutout or a 3-button bar never covers a tab (an uneven pair too)', () => {
        renderBar('home', vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY], { compact: true, leftInset: 48, rightInset: 0 });

        const style = getComputedStyle(screen.getByRole('tablist'));

        // The bar's own 4 dp side padding, plus the inset.
        expect(style.paddingLeft).toBe('52px');
        expect(style.paddingRight).toBe('4px');
    });

    it('pads the insets when it is not compact either: an upright tablet can have a side inset', () => {
        renderBar('home', vi.fn(), [RECIPE_HOME_WIDGET_CAPABILITY], { leftInset: 0, rightInset: 20 });

        expect(getComputedStyle(screen.getByRole('tablist')).paddingRight).toBe('24px');
    });
});
