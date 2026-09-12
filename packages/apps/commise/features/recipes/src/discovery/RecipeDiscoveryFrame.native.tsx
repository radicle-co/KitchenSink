/**
 * @module @commise/features-recipes — native discovery FRAME (presentational, T076 / US2).
 *
 * The React Native twin of `RecipeDiscoveryFrame`: the same chrome, pinned above the discovery suspense boundary that
 * arrives as `children`, so a pending or failed search never unmounts the field a viewer is typing in.
 *
 * Back-to-browse lives HERE, pinned under the filters, rather than in the result grid's scrolling header where it used
 * to sit: in the grid it existed only while results rendered, so a "see all" whose list was still loading or had
 * failed left no way back to the rails. It shows only after a "see all", so it costs the pinned area one 44pt row only
 * in the state that needs it.
 *
 * The settled-results announcement is a polite, visually hidden `LiveRegion`, mounted empty with the frame so it
 * outlives every body the boundary swaps in.
 *
 * Like its web twin it owns one piece of local UI state — `searchFocused` — gating the recent-search panel (U7) to the
 * idle state. The heading takes the screen-reader cursor when `headingFocusSignal` advances.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useState } from 'react';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { RecipeSourceTabs } from '../list/RecipeSourceTabs.native.js';
import { discoveryMessages } from './messages.js';
import {
    DISCOVERY_SORTS,
    discoverySortLabel,
    formatDiscoveryResultsSummary,
    type RecipeDiscoveryFrameProps,
} from './model.js';

export const RecipeDiscoveryFrame: FC<RecipeDiscoveryFrameProps> = ({
    searchValue,
    onSearchChange,
    searching,
    headingFocusSignal,
    resultsSummary,
    tab,
    recentSearches,
    filterSlot,
    sort,
    onExitToBrowse,
    children,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();
    const headingRef = useScreenReaderFocusOnSignal<Text>(headingFocusSignal);

    // Local UI state ONLY: whether the keyword field holds focus. The recent searches appear on focus and vanish on
    // blur, so they never sit permanently between the field and the results.
    const [searchFocused, setSearchFocused] = useState(false);
    // Gate on `!searching`, not on the query alone: a filter applied from the sheet leaves the query blank, and on a
    // phone this panel covers the middle of the screen — exactly where a swipe to scroll the results lands.
    const showRecentSearches =
        recentSearches !== undefined && recentSearches.queries.length > 0 && searchFocused && !searching;

    return (
        <View accessibilityLabel={discovery.heading} style={styles.container}>
            <Text ref={headingRef} accessibilityRole="header" style={styles.heading}>
                {discovery.heading}
            </Text>
            {/* L5 — the source switcher; mobile's recipe shell owns its own, so the app passes no `tab`. */}
            {tab !== undefined && <RecipeSourceTabs tab={tab} />}
            <TextInput
                accessibilityLabel={discovery.searchLabel}
                placeholder={discovery.searchPlaceholder}
                // Placeholder text is TEXT, so it takes `slate`, never the `mist` hairline tone — see the palette JSDoc
                // in `@commise/ui`'s `tokens/colors.ts`.
                placeholderTextColor={palette.slate}
                value={searchValue}
                onChangeText={onSearchChange}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={styles.search}
            />
            {/* Recent searches (U7): pressing one does NOT blur the field on RN, so the panel survives the tap; it goes
                once the container sets the chosen query. */}
            {showRecentSearches && (
                <View accessibilityLabel={discovery.recentSearchesLabel} style={styles.recentPanel}>
                    <View style={styles.recentHeader}>
                        <Text style={styles.recentTitle}>{discovery.recentSearchesLabel}</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={discovery.clearRecentSearchesLabel}
                            onPress={recentSearches.onClear}
                            style={styles.recentClear}
                        >
                            <Text style={styles.recentClearLabel}>{discovery.clearRecentSearches}</Text>
                        </Pressable>
                    </View>
                    {recentSearches.queries.map((query) => (
                        <Pressable
                            key={query}
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(discovery.recentSearchLabel, { query })}
                            onPress={() => recentSearches.onSelect(query)}
                            style={styles.recentRow}
                        >
                            <Text style={styles.recentRowLabel}>{query}</Text>
                        </Pressable>
                    ))}
                </View>
            )}
            {filterSlot}
            {onExitToBrowse !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={discovery.backToBrowse}
                    onPress={onExitToBrowse}
                    style={styles.backToBrowse}
                >
                    <Text style={styles.backToBrowseText}>{discovery.backToBrowse}</Text>
                </Pressable>
            )}
            {sort !== undefined && (
                <View accessibilityRole="radiogroup" accessibilityLabel={discovery.sortLabel} style={styles.sortRow}>
                    {DISCOVERY_SORTS.map((option) => {
                        const checked = sort.active === option;

                        return (
                            <Pressable
                                key={option}
                                accessibilityRole="radio"
                                // Both state forms are load-bearing (#123). `accessibilityState.checked` is the DEVICE
                                // trait; `aria-checked` is the only one react-native-web forwards to the DOM, so without
                                // it the web build announced four stateless radios. RN reverse-maps `aria-checked` into
                                // `accessibilityState.checked`, so dropping the object form silences the device.
                                accessibilityState={{ checked }}
                                aria-checked={checked}
                                onPress={() => sort.onChange(option)}
                                style={[styles.sortChip, checked && styles.sortChipActive]}
                            >
                                <Text style={checked ? styles.sortLabelActive : styles.sortLabelText}>
                                    {discoverySortLabel(option, discovery)}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            )}
            <LiveRegion politeness="polite" visuallyHidden>
                {resultsSummary === undefined ? '' : formatDiscoveryResultsSummary(resultsSummary, discovery, locale)}
            </LiveRegion>
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
    heading: { fontSize: nativeTokens.fontSize.displayMd, fontWeight: '700', color: palette.charcoal },
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
    sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    sortChip: {
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: 6,
        minHeight: 44,
        justifyContent: 'center',
        backgroundColor: palette.pearl,
    },
    sortChipActive: { backgroundColor: palette.charcoal },
    sortLabelText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.slate },
    sortLabelActive: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.white },
    // Recent searches (U7): a card of 44pt-tall rows under the keyword field.
    recentPanel: {
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recentTitle: { fontSize: nativeTokens.fontSize.caption, fontWeight: '600', color: palette.slate },
    recentClear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[1] },
    recentClearLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
    recentRow: { minHeight: 44, justifyContent: 'center' },
    recentRowLabel: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.charcoal },
    backToBrowse: {
        alignSelf: 'flex-start',
        paddingVertical: 6,
        paddingHorizontal: nativeTokens.spacing[1],
        minHeight: 44,
        justifyContent: 'center',
    },
    backToBrowseText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
});
