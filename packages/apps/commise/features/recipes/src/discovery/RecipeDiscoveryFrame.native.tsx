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
import { useCompactHeight, useFrameCollapsed } from '@commise/ui/layout';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { SearchField } from '@commise/ui/search-field';
import { useTheme } from '@commise/ui/theme';
import { useState } from 'react';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { DiscoveryControls } from './DiscoveryControls.native.js';
import { DiscoveryHeaderGroup } from './DiscoveryHeaderGroup.native.js';
import { DiscoveryRecentSearches } from './DiscoveryRecentSearches.native.js';
import { DiscoverySortMenu } from './DiscoverySortMenu.native.js';
import { DiscoveryTitle } from './DiscoveryTitle.native.js';
import { discoveryMessages } from './messages.js';
import { DISCOVER_SEARCH_ID, formatDiscoveryResultsSummary, type RecipeDiscoveryFrameProps } from './model.js';

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

    // Local UI state ONLY: whether the keyword field holds focus. The recent searches appear on focus and vanish on
    // blur, so they never sit permanently between the field and the results.
    const [searchFocused, setSearchFocused] = useState(false);
    const compact = useCompactHeight();
    // ⛔ The keyboard must be the FIELD's: the filter sheet's own ingredient search raises one too, and stepping the
    // controls aside then would unmount the trigger and the sheet it holds open, a change of context on focus
    // (SC 3.2.1). A collapse never unmounts a slot that holds state or a modal.
    const collapsed = useFrameCollapsed() && searchFocused;
    const sheet = filters?.presentation === 'sheet' ? filters : undefined;
    const panel = filters?.presentation === 'panel' ? filters : undefined;
    const sortControl = sort === undefined ? null : <DiscoverySortMenu active={sort.active} onChange={sort.onChange} />;

    const search = (
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

    // Mounted empty and never unmounted by a body swap: this is the live region.
    const count = (
        <LiveRegion politeness="polite" style={[styles.count, { color: colors.inkMuted }]}>
            {resultsSummary === undefined ? '' : formatDiscoveryResultsSummary(resultsSummary, discovery, locale)}
        </LiveRegion>
    );

    const body = (
        <View style={panel === undefined ? styles.fill : styles.resultsColumn}>
            {panel === undefined ? (
                <DiscoveryHeaderGroup
                    compact={compact}
                    headingFocusSignal={headingFocusSignal}
                    headerAction={headerAction}
                    search={search}
                />
            ) : (
                search
            )}
            <DiscoveryRecentSearches
                recentSearches={recentSearches}
                fieldFocused={searchFocused}
                searching={searching}
            />
            <DiscoveryControls
                compact={compact}
                collapsed={collapsed}
                sheet={sheet}
                sort={sortControl}
                onExitToBrowse={onExitToBrowse}
            />
            {panel === undefined ? (
                count
            ) : (
                <View style={styles.countRow}>
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
                    {compact ? null : <DiscoveryTitle focusSignal={headingFocusSignal} action={headerAction} />}
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
    countRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
    },
    count: { ...nativeTokens.type.meta, fontVariant: ['tabular-nums', 'lining-nums'] },
});
