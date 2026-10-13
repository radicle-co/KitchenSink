/**
 * @module home/chrome/HomeTabBar — the native bottom tab bar (`docs/design/uiOverhaul/buildSpec.md` §3.2; ownerDecisions
 * D6, D14). The reachable destinations of the shared nav model (`resolveHomeNav` — Home, Recipes, Discover today), each a
 * 24 pt glyph over a `caption` label, on every phone and tablet, iPad included in both orientations.
 *
 * It is our own bar, with real Liquid Glass BEHIND it on iOS 26 and a solid `paperRaised` surface elsewhere
 * (`@commise/ui/chrome-surface`); native system tabs wait until React Navigation marks them stable (D14).
 *
 * - The active tab: `ink` glyph and label at weight 600, a 32 × 3 pt `hereBar` above the glyph, and
 *   `accessibilityState.selected`. Inactive: `inkMuted`. (No filled glyph: Lucide has none, and a filled compass hides
 *   its needle — the blueprint's Q6, awaiting `staff-ux-engineer`.)
 * - Targets: at least 48 dp tall on Android, 44 pt on iOS. The bar pads its foot by the bottom safe-area inset.
 * - Compact height (owner 2026-10-13; the window under 480 dp, which is every phone held sideways): the label sits
 *   BESIDE the glyph and the bar is 48 dp (44 pt on iOS). Both sides pad their safe-area inset, so a cutout or the
 *   3-button navigation bar never covers a tab. The label stays the tab's accessible name.
 *
 * Presentational: props → JSX. `AppTabBar` adapts React Navigation's tab state to it.
 */
import { NAV_ITEM_GLYPH, resolveHomeNav, type HomeNavItemId } from '@commise/features-core';
import { ChromeSurface } from '@commise/ui/chrome-surface';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { JSX } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MobileMessages } from '../../../i18n/messages.js';

/** Props for {@link HomeTabBar}. */
export interface HomeTabBarProps {
    /** The chrome copy, resolved for the active locale. */
    readonly chrome: MobileMessages['home']['chrome'];
    /** Capabilities whose backing service is live — which destinations show. */
    readonly liveCapabilities: readonly string[];
    /** The active destination. */
    readonly activeId: HomeNavItemId;
    /** A tab was pressed — the active one too (its second tap goes to the root, then the top). */
    readonly onPress: (id: HomeNavItemId) => void;
    /** A tab was long-pressed (React Navigation's `tabLongPress`). */
    readonly onLongPress?: (id: HomeNavItemId) => void;
    /** The bottom safe-area inset, so the bar clears the home indicator. */
    readonly bottomInset: number;
    /** The window is compact in height (under 480 dp): the label sits beside the glyph and the bar is shorter. */
    readonly compact: boolean;
    /** The left safe-area inset (a cutout, or the 3-button navigation bar held sideways). */
    readonly leftInset: number;
    /** The right safe-area inset. */
    readonly rightInset: number;
}

/**
 * The native bottom tab bar.
 *
 * @param props - The copy, live capabilities, active destination, press handlers and bottom inset.
 * @returns The tab bar.
 */
export function HomeTabBar({
    chrome,
    liveCapabilities,
    activeId,
    onPress,
    onLongPress,
    bottomInset,
    compact,
    leftInset,
    rightInset,
}: HomeTabBarProps): JSX.Element {
    const { colors } = useTheme();

    return (
        <View
            collapsable={false}
            accessibilityRole="tablist"
            accessibilityLabel={chrome.tabNavLabel}
            style={[
                styles.bar,
                {
                    paddingBottom: bottomInset,
                    paddingLeft: SIDE_PADDING + leftInset,
                    paddingRight: SIDE_PADDING + rightInset,
                },
            ]}
        >
            <ChromeSurface edge="top" />
            {resolveHomeNav(liveCapabilities).map((item) => {
                const selected = item.id === activeId;
                const label = chrome.destinations[item.id];

                return (
                    <Pressable
                        key={item.id}
                        accessibilityRole="tab"
                        accessibilityLabel={label}
                        accessibilityState={{ selected }}
                        aria-selected={selected}
                        onPress={() => onPress(item.id)}
                        onLongPress={onLongPress === undefined ? undefined : () => onLongPress(item.id)}
                        style={compact ? styles.tabCompact : styles.tab}
                    >
                        <View style={[styles.hereBar, selected ? { backgroundColor: colors.hereBar } : null]} />
                        <Icon name={NAV_ITEM_GLYPH[item.id]} size={24} tone={selected ? 'ink' : 'inkMuted'} />
                        <Text
                            style={[
                                nativeTokens.type.caption,
                                selected ? styles.labelActive : null,
                                { color: selected ? colors.ink : colors.inkMuted },
                            ]}
                        >
                            {label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

/** The bar's own side padding; the safe-area inset is added to it. */
const SIDE_PADDING = nativeTokens.spacing[1];

const styles = StyleSheet.create({
    bar: { flexDirection: 'row', justifyContent: 'space-around' },
    // 48 dp covers Android's floor and iOS's 44 pt; 64 tall with the label, like the web bar.
    tab: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: nativeTokens.spacing[1] },
    // Compact height: the label beside the glyph. 48 dp on Android, 44 pt on iOS (each platform's own floor).
    tabCompact: {
        flex: 1,
        flexDirection: 'row',
        minHeight: Platform.select({ ios: 44, default: 48 }),
        alignItems: 'center',
        justifyContent: 'center',
        gap: nativeTokens.spacing[2],
    },
    hereBar: {
        position: 'absolute',
        top: 0,
        width: 32,
        height: 3,
        borderBottomLeftRadius: 2,
        borderBottomRightRadius: 2,
    },
    labelActive: { fontFamily: nativeTokens.fontFace.body.semibold },
});
