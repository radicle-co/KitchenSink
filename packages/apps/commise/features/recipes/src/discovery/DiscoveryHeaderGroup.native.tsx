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
 *
 * @pattern Strategy — compact height swaps the heading's presentation within one stable group, so the keyword field
 *     keeps its parent and index
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DiscoveryTitle } from './DiscoveryTitle.native.js';
import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryFrameProps } from './model.js';

/** Props for {@link DiscoveryHeaderGroup}. */
export interface DiscoveryHeaderGroupProps {
    /** Whether the window is compact in height. */
    readonly compact: boolean;
    /** Advances when a refresh retry succeeds. */
    readonly headingFocusSignal: number;
    /** The large title's action. */
    readonly headerAction: RecipeDiscoveryFrameProps['headerAction'];
    /** The keyword field. */
    readonly search: ReactNode;
}

/** The native header group. */
export const DiscoveryHeaderGroup: FC<DiscoveryHeaderGroupProps> = ({
    compact,
    headingFocusSignal,
    headerAction,
    search,
}) => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();
    const headingRef = useScreenReaderFocusOnSignal<Text>(headingFocusSignal);

    return (
        <View style={compact ? styles.rowGroup : styles.headerGroup}>
            {/* The large title (slice 3, `buildSpec.md` §3.3) with the avatar; in compact height the plain heading
                shares its row with the field. */}
            {compact ? (
                <Text ref={headingRef} accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
                    {discovery.heading}
                </Text>
            ) : (
                <DiscoveryTitle focusSignal={headingFocusSignal} action={headerAction} />
            )}
            <View style={compact ? styles.searchCompact : null}>{search}</View>
        </View>
    );
};

const styles = StyleSheet.create({
    headerGroup: { gap: nativeTokens.spacing[4] },
    // Compact height: the heading and the field share a row, and wrap onto two at a large text size or a narrow window.
    rowGroup: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[3] },
    searchCompact: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
    heading: { ...nativeTokens.type.largeTitle.narrow },
});
