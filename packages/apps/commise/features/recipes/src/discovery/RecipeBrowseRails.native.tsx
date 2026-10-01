/**
 * @module @commise/features-recipes — native curated browse-rails block (presentational, U7).
 *
 * The React Native twin of `RecipeBrowseRails`: the same three fixed-sort rails, each a heading with a "see all" over
 * the body its own read boundary renders, then the cuisine shortcuts and ONE refresh notice for the block — rendered
 * with RN primitives and `nativeTokens`. Same contract as the web leaf so the two cannot drift.
 *
 * It owns its scroll container: browse is three rails plus the cuisine shortcuts, far taller than a phone, and rendered
 * bare inside the screen's `flex: 1` container nothing scrolled (Maestro `discoverBrowse` swiped up 13 times without the
 * surface moving). Its pull-to-refresh refreshes THE RAILS — it used to live on the results leaf, bound to the main
 * search, which is not what is on screen while browsing.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { EnterTransition } from '@commise/ui/motion';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { GradientSurface } from '@commise/ui/surface';
import type { FC, Ref } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from './model.js';

/**
 * A browse section heading: the display title over a short brand-gradient accent bar (U8). The accent is a
 * decorative, unlabelled {@link GradientSurface} (no accessibilityLabel ⇒ not in the accessibility tree).
 */
const SectionHeading: FC<{ readonly title: string; readonly headingRef?: Ref<Text> }> = ({ title, headingRef }) => (
    <View style={styles.headingGroup}>
        <Text ref={headingRef} accessibilityRole="header" style={styles.railTitle}>
            {title}
        </Text>
        <GradientSurface gradient="brand" style={styles.railAccent} />
    </View>
);

/**
 * Milliseconds each successive browse section is held back, so the surface assembles itself rather than
 * flashing four sections in at once (U8 motion pass). Applied by {@link EnterTransition}, which owns the
 * reduce-motion gate. Single-sourced with the web leaf's identical constant.
 */
const SECTION_STAGGER_MS = 80;

/** Visible title for each rail (S). */
const railTitle = (id: RecipeBrowseRailId, m: DiscoveryMessages): string => {
    switch (id) {
        case 'trending':
            return m.railTrending;
        case 'new':
            return m.railNew;
        case 'quick':
            return m.railQuick;
    }
};

/** One curated rail: its heading and "see all" over its body. */
const Rail: FC<{
    readonly rail: RecipeBrowseRailView;
    /**
     * The block's own recoveries this rail's heading also answers to: the FIRST rail's heading is where the cursor lands
     * after a recovered block refresh, and every other rail passes 0. Added to the rail's own signal — both are counters
     * that only grow, so their sum changes whenever either does.
     */
    readonly blockRecoveries: number;
}> = ({ rail, blockRecoveries }) => {
    const discovery = useMessages(discoveryMessages);
    const title = railTitle(rail.id, discovery);
    const headingRef = useScreenReaderFocusOnSignal<Text>(rail.headingFocusSignal + blockRecoveries);

    return (
        <View style={styles.rail}>
            <View style={styles.railHeader}>
                <SectionHeading title={title} headingRef={headingRef} />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(discovery.seeAllLabel, { rail: title })}
                    onPress={rail.onSeeAll}
                    style={styles.seeAll}
                >
                    <Text style={styles.seeAllText}>{discovery.seeAll}</Text>
                </Pressable>
            </View>
            {rail.body}
        </View>
    );
};

/**
 * The curated browse rails + cuisine shortcuts (native).
 *
 * @param props - The rails with their bodies, the cuisine shortcuts, and the block's refresh notice.
 */
export const RecipeBrowseRails: FC<RecipeBrowseRailsProps> = ({ rails, cuisines, refreshNotice, refresh }) => {
    const discovery = useMessages(discoveryMessages);
    // A retry from the refresh notice that succeeds removes the button the viewer pressed, so the screen-reader cursor
    // goes to the first rail's heading.
    const recoveries = refreshNotice?.recoveries ?? 0;

    return (
        <ScrollView
            aria-label={discovery.browseLabel}
            style={styles.scroll}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            refreshControl={
                refresh === undefined ? undefined : (
                    <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />
                )
            }
        >
            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: discovery.railsRefreshError, retry: discovery.retry }}
                />
            )}
            {/* U8 motion pass: each section rises + fades in, staggered, via the DS `EnterTransition` — which
                owns the reduce-motion gate, so a reduce-motion viewer simply gets the settled surface. */}
            {rails.map((rail, index) => (
                <EnterTransition key={rail.id} delayMs={index * SECTION_STAGGER_MS}>
                    <Rail rail={rail} blockRecoveries={index === 0 ? recoveries : 0} />
                </EnterTransition>
            ))}
            {cuisines.length > 0 && (
                <EnterTransition delayMs={rails.length * SECTION_STAGGER_MS}>
                    <View style={styles.rail}>
                        <SectionHeading title={discovery.cuisinesTitle} />
                        <View style={styles.cuisineRow}>
                            {cuisines.map((cuisine) => (
                                <Pressable
                                    key={cuisine.value}
                                    accessibilityRole="button"
                                    accessibilityLabel={fillTemplate(discovery.cuisineShortcutLabel, {
                                        cuisine: cuisine.value,
                                    })}
                                    onPress={cuisine.onSelect}
                                    style={styles.cuisineChip}
                                >
                                    <Text style={styles.cuisineText}>{cuisine.value}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                </EnterTransition>
            )}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    scroll: { flex: 1 },
    container: { gap: nativeTokens.spacing[7], paddingBottom: nativeTokens.spacing[5] },
    rail: { gap: nativeTokens.spacing[3] },
    railHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    // U8: the section title stacked over its short brand-gradient accent bar.
    headingGroup: { gap: 6 },
    railTitle: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    railAccent: { height: 4, width: 40, borderRadius: nativeTokens.radius.full },
    seeAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[2] },
    seeAllText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
    cuisineRow: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    cuisineChip: {
        minHeight: 44,
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.pearl,
        paddingHorizontal: nativeTokens.spacing[4],
    },
    cuisineText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.charcoal },
});
