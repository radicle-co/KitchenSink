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
import { useOptionalScrollHost } from '@commise/ui/scroll-host';
import { SearchField } from '@commise/ui/search-field';
import { SegmentedControl } from '@commise/ui/segmented-control';
import { useTheme } from '@commise/ui/theme';
import { useEffect, useId, useMemo, useState, type FC } from 'react';
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { recipeMessages } from '../messages.js';
import { RecipeListHeaderContext } from './recipeListHeaderContext.js';
import { FillBox, ListHeaderBox, ListHeaderGroup, SearchBand, SearchOverlay } from './RecipeListLayout.native.js';
import { searchPinGeometry, searchSticks } from './searchPin.js';
import { createSearchPin } from './searchPinNodes.native.js';
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

    // Where the field naturally sits in the list's content, from its spacer's layout, and how tall the field is. The field
    // is drawn ONCE, below, above the list; the list holds only a spacer of its height.
    const [spacer, setSpacer] = useState<SpacerBox | null>(null);
    const [fieldHeight, setFieldHeight] = useState(0);
    // Screen-reader exposure: exactly one of the stand-in (the spacer) and the field is reachable. The field is while it
    // has focus or holds a query (its clear control must stay reachable); otherwise the stand-in is.
    const [fieldFocused, setFieldFocused] = useState(false);
    const [focusAsks, setFocusAsks] = useState(0);
    // Scrolled away from the top the stand-in has left the screen while the field stays pinned there, so the field is the
    // one on screen and must be the reachable one (`viewportsDown` counts in quarter viewports).
    const scrolledAway = (useOptionalScrollHost()?.viewportsDown ?? 0) > 0;
    const fieldReachable = fieldFocused || searchValue !== '' || scrolledAway;
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    // The host's ONE native-driven scroll offset; with no host above (a screen not yet wrapped, a test) the field rests.
    const scrollY = useOptionalScrollHost()?.scrollY ?? NO_SCROLL;
    const pins = searchSticks(fieldHeight, windowHeight);
    const geometry = searchPinGeometry({
        naturalTop: HEADER_TOP_PX + (spacer?.y ?? 0),
        pinnedTop: PINNED_TOP_PX,
        pins,
    });
    // ONE set of nodes over the host's offset, built once. A re-measure (the spacer moves, the field grows, the window turns)
    // writes the two inputs below; it never swaps a node, because swapping one on a native-driven view left the view showing the
    // old node's value (qa-ios ScaleToCap). Nothing is drawn until the spacer has been measured, so the first geometry is unseen.
    const searchPin = useMemo(() => createSearchPin(scrollY, geometry), [scrollY]); // eslint-disable-line react-hooks/exhaustive-deps -- the first geometry only; `apply` carries every later one
    // @sideEffect Synchronises two Animated values (an external, native-driven system) with the measured geometry.
    useEffect(() => {
        searchPin.apply({ naturalTop: geometry.naturalTop, pinnedTop: geometry.pinnedTop });
    }, [searchPin, geometry.naturalTop, geometry.pinnedTop]);
    const translateY = searchPin.translateY;
    const bandOpacity = searchPin.bandOpacity;

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
                        {...(headerAction === undefined ? {} : { action: headerAction })}
                        {...(segmentControl === null ? {} : { segments: segmentControl })}
                    />
                )}

                {searchVisible ? (
                    // A plain React Native Pressable, not a Tamagui one: its `onLayout` is what places the field, and the test
                    // lane can drive only React Native's. Blank, the field's size. It is the field's STAND-IN for a screen
                    // reader: the drawn field sits after the list, so a swipe would reach it behind every card, while this
                    // sits where the field shows. A press hands the cook to the real field (`focusAsks`).
                    <Pressable
                        accessibilityRole="search"
                        aria-label={list.searchLabel}
                        aria-hidden={fieldReachable}
                        onPress={() => setFocusAsks((asks) => asks + 1)}
                        style={[compact ? styles.searchCompact : styles.spacer, { height: fieldHeight }]}
                        onLayout={(event) => {
                            // Read NOW: the renderer releases the event when this handler returns, and the updater below runs later,
                            // in render, when `event.nativeEvent` is null.
                            const { layout } = event.nativeEvent;

                            setSpacer((previous) => nextSpacerBox(previous, layout));
                        }}
                    />
                ) : null}
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
                <SearchOverlay>
                    <Animated.View
                        aria-hidden={!fieldReachable}
                        onLayout={(event) => setFieldHeight(Math.round(event.nativeEvent.layout.height))}
                        style={{
                            position: 'absolute',
                            left: spacer?.x ?? 0,
                            width: spacer?.width,
                            opacity: spacer === null ? 0 : 1,
                            transform: [{ translateY }],
                        }}
                    >
                        {/* The canvas band behind the pinned field: from the frame's top (8 above the pinned field) to
                            8 below it, the full width of the screen. It rides this box's own native translate, so it
                            never lags the field, and it takes no touches. */}
                        <Animated.View
                            pointerEvents="none"
                            style={{
                                position: 'absolute',
                                top: -PINNED_TOP_PX,
                                left: -(spacer?.x ?? 0),
                                width: windowWidth,
                                height: PINNED_TOP_PX + fieldHeight + nativeTokens.spacing[2],
                                opacity: bandOpacity,
                            }}
                        >
                            <SearchBand aria-hidden testID="searchBand" />
                        </Animated.View>
                        <SearchField
                            id={searchId}
                            label={list.searchLabel}
                            labelVisibility="hidden"
                            clearLabel={list.clearSearch}
                            placeholder={list.searchPlaceholder}
                            value={searchValue}
                            onChangeText={onSearchChange}
                            onFocus={() => setFieldFocused(true)}
                            onBlur={() => setFieldFocused(false)}
                            focusSignal={focusAsks}
                        />
                    </Animated.View>
                </SearchOverlay>
            ) : null}
            {/* A sibling after the boundary: it floats over the screen's foot and never leaves with a pending, offline or
                failed read (§3.4). The host decides when it yields. */}
            <RecipeCreateButton onCreateRecipe={onCreateRecipe} yielded={createEntryYields} />
        </FillBox>
    );
};

/** The part of the spacer's layout the overlay needs. */
interface SpacerBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
}

/**
 * The spacer's box after a layout report. Whole pixels, and the SAME object when nothing moved: React bails out of a state
 * update only for an identical value, so a fresh `{ x, y, width }` per report re-rendered the frame, the header and the whole
 * list for a report that said nothing new, and the platform repeats reports (Android re-sends one for sub-pixel float noise).
 * A layout feedback that costs a render per report is how "Maximum update depth exceeded" starts.
 *
 * @param previous - The box held now, or `null` before the first report.
 * @param layout - A layout event's `layout`.
 * @returns `previous` when the report rounds to it, else the new box. Pure.
 */
function nextSpacerBox(
    previous: SpacerBox | null,
    layout: { readonly x: number; readonly y: number; readonly width: number },
): SpacerBox {
    const x = Math.round(layout.x);
    const y = Math.round(layout.y);
    const width = Math.round(layout.width);

    return previous !== null && previous.x === x && previous.y === y && previous.width === width
        ? previous
        : { x, y, width };
}

/** With no `ScrollHost` above, the field rests at its natural place. */
const NO_SCROLL = new Animated.Value(0);

/** What the header box pads above the group (`ListHeaderBox`'s `$2`), so the spacer's y becomes a list-content offset. */
const HEADER_TOP_PX = nativeTokens.spacing[2];

/** Where the pinned field holds, px from the top of the list's frame. */
const PINNED_TOP_PX = nativeTokens.spacing[2];

const styles = StyleSheet.create({
    // The large title role at its narrow size, the face and the 28 px cap the full header draws (owner rule C1), not a
    // 700 face of its own.
    heading: nativeTokens.type.largeTitle.narrow,
    spacer: { marginHorizontal: nativeTokens.spacing[4] },
    searchCompact: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
});
