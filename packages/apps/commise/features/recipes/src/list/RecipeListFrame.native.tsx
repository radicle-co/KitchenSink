/**
 * @module @commise/features-recipes — native recipe-list FRAME (presentational).
 *
 * The React Native leaf of `RecipeListFrame`: the title, the source switcher and the search field,
 * pinned above whatever the list's suspense boundary renders as `children`, so a pending or failed read never
 * unmounts them. It fetches nothing.
 *
 * When `headingFocusSignal` advances — a retry from the refresh notice inside the boundary succeeded and removed the
 * button the viewer pressed — the screen-reader cursor moves to the heading.
 *
 * ## Compact height (`docs/design/compactHeightLayout.md` §5)
 *
 * On a phone held sideways the stacked header (title, then the field) took too much of 369 dp before one recipe. In
 * compact height (`useCompactHeight`) the heading shares one wrapping row with the field, and the gaps tighten. ⛔ The field is ALWAYS the last child of one header group, whatever the layout, so it never changes
 * parent or index: a remounted field would lose focus and its keyboard, which changes the layout back. While the
 * window is compact AND a keyboard is open the screen's other chrome steps aside (the tab bar, the quick filters, the
 * create dial — `RecipesScreen` and `RecipeListResults`); this frame keeps only the heading and the field.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useCompactHeight } from '@commise/ui/layout';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { TextInput } from '@commise/ui/text-input';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeSourceTabs } from './RecipeSourceTabs.native.js';
import type { RecipeListFrameProps } from './model.js';

export const RecipeListFrame: FC<RecipeListFrameProps> = ({
    searchValue,
    onSearchChange,
    tab,
    headingFocusSignal,
    children,
}) => {
    const { list } = useMessages(recipeMessages);
    const headingRef = useScreenReaderFocusOnSignal<Text>(headingFocusSignal);
    const compact = useCompactHeight();
    const heading = (
        <Text ref={headingRef} accessibilityRole="header" style={styles.heading}>
            {list.heading}
        </Text>
    );

    return (
        <View
            collapsable={false}
            accessibilityLabel={list.heading}
            style={[styles.container, compact && styles.containerCompact]}
        >
            {/* ONE header group in every layout, the field its last child, so the field never remounts. */}
            <View style={compact ? styles.headerGroupCompact : styles.headerGroup}>
                {/* The heading sits on the app canvas, which already carries the beach-glow wash: a second gradient
                    band around it was a box in a box (`docs/design/uiOverhaul/buildSpec.md` §1.6). */}
                {heading}

                {/* The source switcher (L5) is the ONE shared `RecipeSourceTabs`, shared with the community surface —
                    the same composition the web frame uses, so the platforms cannot drift on it. */}
                {tab !== undefined && <RecipeSourceTabs tab={tab} />}

                <TextInput
                    accessibilityLabel={list.searchLabel}
                    placeholder={list.searchPlaceholder}
                    placeholderTextColor={palette.slate}
                    value={searchValue}
                    onChangeText={onSearchChange}
                    style={[styles.search, compact && styles.searchCompact]}
                />
            </View>

            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[2],
    },
    containerCompact: { gap: nativeTokens.spacing[2] },
    headerGroup: { gap: nativeTokens.spacing[4] },
    // Compact height: the heading and the field share a row, and wrap onto two at a large text size or a narrow window.
    headerGroupCompact: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
    },
    heading: {
        fontFamily: nativeTokens.fontFace.display.bold,
        fontSize: nativeTokens.fontSize.displayMd,
        color: palette.charcoal,
    },
    search: {
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.full,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        paddingVertical: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        fontSize: nativeTokens.fontSize.bodyMd,
        color: palette.charcoal,
    },
    searchCompact: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
});
