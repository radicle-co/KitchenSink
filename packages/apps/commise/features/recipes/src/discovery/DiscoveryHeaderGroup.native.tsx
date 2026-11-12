/**
 * @module @commise/features-recipes — the native discovery header group: the heading and the keyword field.
 *
 * ONE group in every layout, the field its LAST child, so the field never changes parent or index and a remount never
 * costs it focus and its keyboard. Stacked, the large title sits over the field; in compact height (a phone held
 * sideways) the plain heading shares a wrapping row with it, so the results keep their room.
 *
 * Presentational: props → JSX. The one effect it owns is the screen-reader cursor on the compact heading, which takes it
 * when `headingFocusSignal` advances.
 *
 * `compact` selects the heading's presentation INSIDE this one group rather than choosing between two components in the
 * frame: two component types would remount the field on a rotation, and a remounted field loses its focus and keyboard.
 * `drawsHeading` is false when the filter panel is shown: the frame then draws the title once above the panel row, and
 * this group holds the field alone, still at the same index under the same parent, unpadded because that row pads.
 *
 * @pattern Strategy — compact height swaps the heading's presentation within one stable group, so the keyword field
 *     keeps its parent and index; with the filter panel the heading is drawn above the panel row instead, and the field
 *     keeps its place here
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DiscoveryTitle } from './DiscoveryTitle.native.js';
import { discoveryMessages } from './messages.js';

/** Props for {@link DiscoveryHeaderGroup}. */
export interface DiscoveryHeaderGroupProps {
    /** Whether the window is compact in height. */
    readonly compact: boolean;
    /** Advances when a refresh retry succeeds. */
    readonly headingFocusSignal: number;
    /** The keyword field. */
    readonly search: ReactNode;
    /** Whether the heading is drawn here; `false` while the filter panel is shown and the frame draws it above the row. */
    readonly drawsHeading: boolean;
}

/** The native header group. */
export const DiscoveryHeaderGroup: FC<DiscoveryHeaderGroupProps> = ({
    compact,
    headingFocusSignal,
    search,
    drawsHeading,
}) => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();
    const headingRef = useScreenReaderFocusOnSignal<Text>(headingFocusSignal);

    return (
        <View style={drawsHeading && compact ? [styles.rowGroup, styles.inset] : styles.headerGroup}>
            {/* The large title (slice 3, `buildSpec.md` §3.3) with the avatar; in compact height the plain heading
                shares its row with the field. */}
            {!drawsHeading ? null : compact ? (
                <Text ref={headingRef} accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
                    {discovery.heading}
                </Text>
            ) : (
                <DiscoveryTitle focusSignal={headingFocusSignal} />
            )}
            <View style={!drawsHeading ? undefined : compact ? styles.searchCompact : styles.inset}>{search}</View>
        </View>
    );
};

const styles = StyleSheet.create({
    headerGroup: { gap: nativeTokens.spacing[4] },
    // Compact height: the heading and the field share a row, and wrap onto two at a large text size or a narrow window.
    rowGroup: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[3] },
    searchCompact: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
    // The large title insets its own sides, so the field and the compact row pad themselves.
    inset: { paddingHorizontal: nativeTokens.spacing[4] },
    heading: { ...nativeTokens.type.largeTitle.narrow },
});
