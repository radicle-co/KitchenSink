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
 * create button — `RecipeListResults`); this frame keeps only the heading and the field.
 *
 * Slice 4 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.3): the My recipes · Collections segments
 * replace the source tabs, the field is the design-system `SearchField`, and it hides on the first run. Slice 3: the
 * heading is the shell's `LargeTitleHeader`, with the avatar and the segments.
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { useCompactHeight } from '@commise/ui/layout';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { SearchField } from '@commise/ui/search-field';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useTheme } from '@commise/ui/theme';
import { useId, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RECIPES_SEGMENTS, RECIPES_TITLE_ID, type RecipeListFrameProps, type RecipesSegment } from './model.js';

/**
 * Whether a segment id is one of the Recipes screen's places.
 *
 * @param id - The id the segmented control reports.
 * @returns `true` for `mine` or `collections`.
 */
function isRecipesSegment(id: string): id is RecipesSegment {
    return (RECIPES_SEGMENTS as readonly string[]).includes(id);
}

export const RecipeListFrame: FC<RecipeListFrameProps> = ({
    searchValue,
    onSearchChange,
    searchVisible,
    segments,
    headingFocusSignal,
    headerAction,
    children,
}) => {
    const { list } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const headingRef = useScreenReaderFocusOnSignal<Text>(headingFocusSignal);
    const compact = useCompactHeight();
    const searchId = useId();
    const segmentControl =
        segments === undefined ? null : (
            <SegmentedControl
                form="route"
                label={list.segmentsLabel}
                current={segments.current}
                segments={RECIPES_SEGMENTS.map((segment) => ({
                    id: segment,
                    label: segment === 'mine' ? list.tabMine : list.tabCollections,
                    href: segments.href[segment],
                }))}
                onSelect={(id) => {
                    if (isRecipesSegment(id)) {
                        segments.onSelect(id);
                    }
                }}
            />
        );

    return (
        // No name on the container: the header Text inside it says it (`nativeContainerNames.md` N1).
        <View collapsable={false} style={[styles.container, compact && styles.containerCompact]}>
            {/* ONE header group in every layout, the field its last child, so the field never remounts. */}
            <View style={compact ? styles.headerGroupCompact : styles.headerGroup}>
                {/* The large title (slice 3) with the avatar and the segments; in compact height — a phone held sideways — the
                    plain heading shares its row with the field, so the list keeps its room. */}
                {compact ? (
                    <>
                        <Text
                            ref={headingRef}
                            accessibilityRole="header"
                            style={[styles.heading, { color: colors.ink }]}
                        >
                            {list.heading}
                        </Text>
                        {segmentControl}
                    </>
                ) : (
                    <LargeTitleHeader
                        headingId={RECIPES_TITLE_ID}
                        title={list.heading}
                        focusSignal={headingFocusSignal}
                        {...(headerAction === undefined ? {} : { action: headerAction })}
                        {...(segmentControl === null ? {} : { segments: segmentControl })}
                    />
                )}

                {searchVisible ? (
                    <View style={compact ? styles.searchCompact : null}>
                        <SearchField
                            id={searchId}
                            label={list.searchLabel}
                            labelVisibility="hidden"
                            clearLabel={list.clearSearch}
                            placeholder={list.searchPlaceholder}
                            value={searchValue}
                            onChangeText={onSearchChange}
                        />
                    </View>
                ) : null}
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
    headerGroupCompact: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
    },
    heading: {
        fontFamily: nativeTokens.fontFace.display.bold,
        fontSize: nativeTokens.fontSize.displayMd,
    },
    searchCompact: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
});
