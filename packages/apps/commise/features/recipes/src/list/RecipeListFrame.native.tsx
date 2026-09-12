/**
 * @module @commise/features-recipes — native recipe-list FRAME (presentational).
 *
 * The React Native leaf of `RecipeListFrame`: the gradient title band, the source switcher and the search field,
 * pinned above whatever the list's suspense boundary renders as `children`, so a pending or failed read never
 * unmounts them. It fetches nothing.
 *
 * When `headingFocusSignal` advances — a retry from the refresh notice inside the boundary succeeded and removed the
 * button the viewer pressed — the screen-reader cursor moves to the heading.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { GradientSurface } from '@commise/ui/surface';
import type { FC } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

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

    return (
        <View accessibilityLabel={list.heading} style={styles.container}>
            {/* U8: the heading rides a beach-glow gradient title band (mockup recipe-list). */}
            <GradientSurface gradient="hero" style={styles.titleBand}>
                <View style={styles.headerRow}>
                    <Text ref={headingRef} accessibilityRole="header" style={styles.heading}>
                        {list.heading}
                    </Text>
                </View>
            </GradientSurface>

            {/* The source switcher (L5) is the ONE shared `RecipeSourceTabs`, shared with the community surface —
                the same composition the web frame uses, so the platforms cannot drift on it. */}
            {tab !== undefined && <RecipeSourceTabs tab={tab} />}

            <TextInput
                accessibilityLabel={list.searchLabel}
                placeholder={list.searchPlaceholder}
                placeholderTextColor={palette.slate}
                value={searchValue}
                onChangeText={onSearchChange}
                style={styles.search}
            />

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
    titleBand: { borderRadius: nativeTokens.radius.lg, padding: nativeTokens.spacing[4] },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: {
        fontFamily: nativeTokens.fontFace.display.bold,
        fontSize: nativeTokens.fontSize.displayMd,
        fontWeight: '700',
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
});
