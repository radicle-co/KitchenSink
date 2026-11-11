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
 * ## Reading order
 *
 * The drawn field sits in an overlay after the list, so a screen reader would reach it behind every card. The header's
 * spacer is therefore the field's accessible stand-in, a `search` role named for the search that sits where the field
 * shows (after the segments, before the chips). Pressing it advances `focusSignal` on the field. Exactly one of the two
 * is reachable: the field while it has focus, holds a query or the page has scrolled (the stand-in has left the screen
 * and the pinned field is what shows), the stand-in otherwise. Which order VoiceOver and TalkBack
 * really swipe in, and focusing a field that was hidden from accessibility, are physical-device checks.
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
import { PinnedSearchOverlay, PinnedSearchSpacer, usePinnedSearch } from '@commise/ui/pinned-search';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useTheme } from '@commise/ui/theme';
import { useId, type FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeListHeaderContext } from './recipeListHeaderContext.js';
import { FillBox, HEADER_TOP_PX, ListHeaderBox, ListHeaderGroup } from './RecipeListLayout.native.js';
import { RecipeCreateButton } from './RecipeCreateButton.native.js';
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
    onCreateRecipe,
    createEntryYields,
    segments,
    headingFocusSignal,
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
                width="adaptive"
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

    // The pinned search (`@commise/ui/pinned-search`): the field is drawn ONCE, below, above the list; the list's header holds only a
    // spacer of its size, which is also the field's stand-in for a screen reader.
    const pin = usePinnedSearch(searchValue, HEADER_TOP_PX);

    // The header is handed to the one list below (`RecipeListHeaderContext`), which draws it as its first child: it scrolls
    // away with the cards on a phone, and never unmounts when the read changes state.
    const header = (
        <ListHeaderBox compact={compact}>
            <ListHeaderGroup compact={compact}>
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
                        {...(segmentControl === null ? {} : { segments: segmentControl })}
                    />
                )}

                {searchVisible ? <PinnedSearchSpacer pin={pin} label={list.searchLabel} compact={compact} /> : null}
            </ListHeaderGroup>
        </ListHeaderBox>
    );

    return (
        // No name on the container: the header Text inside it says it (`nativeContainerNames.md` N1).
        <FillBox collapsable={false}>
            <RecipeListHeaderContext.Provider value={header}>
                <FillBox>{children}</FillBox>
            </RecipeListHeaderContext.Provider>
            {/* The ONE search field, a later sibling of the list so it draws above the cards, over the spacer the list holds
                for it. It slides with the scroll on the native side and stops at the top; its parent never changes, so the
                field never remounts and keeps focus and the keyboard. Hidden until the spacer has been measured. */}
            {searchVisible ? (
                <PinnedSearchOverlay
                    pin={pin}
                    field={{
                        id: searchId,
                        label: list.searchLabel,
                        labelVisibility: 'hidden',
                        clearLabel: list.clearSearch,
                        placeholder: list.searchPlaceholder,
                        value: searchValue,
                        onChangeText: onSearchChange,
                    }}
                />
            ) : null}
            {/* A sibling after the boundary: it floats over the screen's foot and never leaves with a pending, offline or
                failed read (§3.4). The host decides when it yields. */}
            <RecipeCreateButton onCreateRecipe={onCreateRecipe} yielded={createEntryYields} />
        </FillBox>
    );
};

const styles = StyleSheet.create({
    // The large title role at its narrow size, the face and the 28 px cap the full header draws (owner rule C1), not a
    // 700 face of its own.
    heading: nativeTokens.type.largeTitle.narrow,
});
