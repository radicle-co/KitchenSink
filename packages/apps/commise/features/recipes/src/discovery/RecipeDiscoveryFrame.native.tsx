/**
 * @module @commise/features-recipes — native discovery FRAME (presentational, T076 / US2; slice 5 of the UI overhaul).
 *
 * The React Native twin of `RecipeDiscoveryFrame`: the same chrome, pinned above the discovery suspense boundary that
 * arrives as `children`, so a pending or failed search never unmounts the field a viewer is typing in
 * (`docs/design/uiOverhaul/buildSpec.md` §3.3, §4.4, §4.5). The filters arrive in the ONE presentation the container
 * decided — a 256 pt panel beside the results on a tablet held wide, otherwise a Filters button with the sort, the
 * applied-filter chips and the sheet — and the count line is one visible element that is also the polite live region,
 * mounted empty with the frame so it outlives every body the boundary swaps in. Colour is read from the theme at render (D15).
 *
 * Back-to-browse lives HERE, rather than in the result grid's scrolling header, where it existed only while results
 * rendered: a "see all" whose list was still loading or had failed would have left no way back to the rails. It shows only
 * after a "see all", so it costs the pinned area one 44pt row only in the state that needs it.
 *
 * Like its web twin it owns one piece of local UI state — `searchFocused` — gating the recent-search panel (U7) to the
 * idle state. The heading takes the screen-reader cursor when `headingFocusSignal` advances.
 *
 * ## Compact height (`docs/design/compactHeightLayout.md` §5.4)
 *
 * Sideways, the stacked chrome left the results 16 to 76 dp, and about 0 with the keyboard open. In compact height
 * (`useCompactHeight`) the heading shares a wrapping row with the field, and the filter trigger, back to browse and the
 * sort share one wrapping row, in the same reading order. While compact AND a keyboard is open (`useFrameCollapsed`)
 * AND the frame's own field has focus, that controls row steps aside; a keyboard raised by the filter sheet's search
 * leaves it alone, because the row holds the trigger and the sheet it keeps open. ⛔ Two groups hold the chrome in EVERY
 * layout, the field the header group's last child, so the field never changes parent or index: a remounted field would
 * lose focus and its keyboard. The recent-search rows scroll in every layout, and the first tap with the keyboard up lands
 * on a query. A compact window is never wide enough for the panel (`filterPresentationOf`), so the sheet presentation is
 * the only one it sees.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { useCompactHeight, useFrameCollapsed } from '@commise/ui/layout';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { SearchField } from '@commise/ui/search-field';
import { useTheme } from '@commise/ui/theme';
import { useState } from 'react';
import type { FC, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { DiscoverySortMenu } from './DiscoverySortMenu.native.js';
import { discoveryMessages } from './messages.js';
import {
    DISCOVER_SEARCH_ID,
    DISCOVER_TITLE_ID,
    formatDiscoveryResultsSummary,
    type RecipeDiscoveryFrameProps,
} from './model.js';

export const RecipeDiscoveryFrame: FC<RecipeDiscoveryFrameProps> = ({
    searchValue,
    onSearchChange,
    searching,
    headingFocusSignal,
    resultsSummary,
    headerAction,
    recentSearches,
    filters,
    sort,
    onExitToBrowse,
    children,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const headingRef = useScreenReaderFocusOnSignal<Text>(headingFocusSignal);

    // Local UI state ONLY: whether the keyword field holds focus. The recent searches appear on focus and vanish on
    // blur, so they never sit permanently between the field and the results.
    const [searchFocused, setSearchFocused] = useState(false);
    // Gate on `!searching`, not on the query alone: a filter applied from the sheet leaves the query blank, and on a
    // phone this panel covers the middle of the screen — exactly where a swipe to scroll the results lands.
    const showRecentSearches =
        recentSearches !== undefined && recentSearches.queries.length > 0 && searchFocused && !searching;
    const compact = useCompactHeight();
    // ⛔ The keyboard must be the FIELD's: the filter sheet's own ingredient search raises one too, and stepping the
    // controls aside then would unmount the trigger and the sheet it holds open, a change of context on focus
    // (SC 3.2.1). A collapse never unmounts a slot that holds state or a modal.
    const collapsed = useFrameCollapsed() && searchFocused;
    const sheet = filters?.presentation === 'sheet' ? filters : undefined;
    const panel = filters?.presentation === 'panel' ? filters : undefined;
    const sortControl = sort === undefined ? null : <DiscoverySortMenu active={sort.active} onChange={sort.onChange} />;
    const hasControls = sheet !== undefined || onExitToBrowse !== undefined || sortControl !== null;

    const search: ReactNode = (
        <SearchField
            id={DISCOVER_SEARCH_ID}
            label={discovery.searchLabel}
            labelVisibility="hidden"
            clearLabel={discovery.clearSearch}
            placeholder={discovery.searchPlaceholder}
            value={searchValue}
            onChangeText={onSearchChange}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
        />
    );

    const backToBrowse =
        onExitToBrowse === undefined ? null : (
            <View style={styles.start}>
                <Button variant="ghost" size="sm" icon="chevronLeft" onPress={onExitToBrowse}>
                    {discovery.backToBrowse}
                </Button>
            </View>
        );

    // Mounted empty and never unmounted by a body swap: this is the live region.
    const count = (
        <LiveRegion politeness="polite" style={[styles.count, { color: colors.inkMuted }]}>
            {resultsSummary === undefined ? '' : formatDiscoveryResultsSummary(resultsSummary, discovery, locale)}
        </LiveRegion>
    );

    const body = (
        <View style={panel === undefined ? styles.fill : styles.resultsColumn}>
            {/* ONE header group in every layout, the field its last child, so the field never remounts. */}
            {panel === undefined ? (
                <View style={compact ? styles.rowGroup : styles.headerGroup}>
                    {/* The large title (slice 3, `buildSpec.md` §3.3) with the avatar; in compact height — a phone held
                        sideways — the plain heading shares its row with the field, so the results keep their room. */}
                    {compact ? (
                        <Text
                            ref={headingRef}
                            accessibilityRole="header"
                            style={[styles.heading, { color: colors.ink }]}
                        >
                            {discovery.heading}
                        </Text>
                    ) : (
                        <LargeTitleHeader
                            headingId={DISCOVER_TITLE_ID}
                            title={discovery.heading}
                            focusSignal={headingFocusSignal}
                            {...(headerAction === undefined ? {} : { action: headerAction })}
                        />
                    )}
                    <View style={compact ? styles.searchCompact : null}>{search}</View>
                </View>
            ) : (
                search
            )}
            {/* Recent searches (U7): pressing one does NOT blur the field on RN, so the panel survives the tap; it goes
                once the container sets the chosen query. */}
            {showRecentSearches && (
                <View style={[styles.recentPanel, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}>
                    <View style={styles.recentHeader}>
                        <Text accessibilityRole="header" style={[styles.overline, { color: colors.inkMuted }]}>
                            {discovery.recentSearchesLabel}
                        </Text>
                        <Button
                            variant="ghost"
                            size="sm"
                            accessibilityLabel={discovery.clearRecentSearchesLabel}
                            onPress={recentSearches.onClear}
                        >
                            {discovery.clearRecentSearches}
                        </Button>
                    </View>
                    {/* The rows scroll: under a keyboard the panel can outgrow the room left. `handled`, so the first
                        tap with the keyboard up runs the query instead of only closing the keyboard. */}
                    <ScrollView keyboardShouldPersistTaps="handled">
                        {recentSearches.queries.map((query) => (
                            <Pressable
                                key={query}
                                accessibilityRole="button"
                                accessibilityLabel={fillTemplate(discovery.recentSearchLabel, { query })}
                                onPress={() => recentSearches.onSelect(query)}
                                style={styles.recentRow}
                            >
                                <Text style={[styles.body, { color: colors.ink }]}>{query}</Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            )}
            {/* ONE controls group in every layout; while collapsed it steps aside for the keyboard. With no control to
                hold it is not drawn either, so an empty group opens no gap in the frame. */}
            {collapsed || !hasControls ? null : compact ? (
                <View style={styles.controlsRow}>
                    {sheet?.trigger}
                    {sortControl}
                    {backToBrowse}
                    {sheet?.applied}
                </View>
            ) : (
                <View style={styles.controlsColumn}>
                    {sheet === undefined ? (
                        sortControl
                    ) : (
                        <View style={styles.spread}>
                            {sheet.trigger}
                            {sortControl}
                        </View>
                    )}
                    {sheet?.applied}
                    {backToBrowse}
                </View>
            )}
            {panel === undefined ? (
                count
            ) : (
                <View style={styles.spread}>
                    {count}
                    {sortControl}
                </View>
            )}
            {children}
            {sheet?.sheet}
        </View>
    );

    return (
        <View style={[styles.container, compact && styles.containerCompact]}>
            {panel === undefined ? (
                body
            ) : (
                <>
                    {compact ? null : (
                        <LargeTitleHeader
                            headingId={DISCOVER_TITLE_ID}
                            title={discovery.heading}
                            focusSignal={headingFocusSignal}
                            {...(headerAction === undefined ? {} : { action: headerAction })}
                        />
                    )}
                    <View style={styles.panelRow}>
                        {panel.panel}
                        {body}
                    </View>
                </>
            )}
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
    fill: { flex: 1, gap: nativeTokens.spacing[4] },
    resultsColumn: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[4] },
    panelRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: nativeTokens.spacing[6] },
    headerGroup: { gap: nativeTokens.spacing[4] },
    // Compact height: the heading and the field share a row, and wrap onto two at a large text size or a narrow window.
    rowGroup: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[3] },
    searchCompact: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
    controlsColumn: { gap: nativeTokens.spacing[3] },
    controlsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    spread: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
    },
    start: { alignSelf: 'flex-start' },
    heading: { ...nativeTokens.type.largeTitle.narrow },
    count: { ...nativeTokens.type.meta, fontVariant: ['tabular-nums', 'lining-nums'] },
    overline: { ...nativeTokens.type.overline },
    body: { ...nativeTokens.type.body },
    // Recent searches (U7): a card of 44pt-tall rows under the keyword field.
    recentPanel: {
        flexShrink: 1,
        borderRadius: nativeTokens.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recentRow: { minHeight: 44, justifyContent: 'center' },
});
