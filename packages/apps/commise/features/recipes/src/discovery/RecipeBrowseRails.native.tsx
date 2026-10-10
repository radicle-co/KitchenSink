/**
 * @module @commise/features-recipes — native curated browse-rails block (presentational, U7; slice 5 of the UI overhaul).
 *
 * The React Native twin of `RecipeBrowseRails`: the same three fixed-sort rails, each a heading with "See all" over the
 * body its own read boundary renders, then "Browse by cuisine" as a scrolling row of chips and ONE refresh notice for the
 * block (`docs/design/uiOverhaul/buildSpec.md` §4.4). There is no Previous and Next: a touch screen swipes, and the next
 * card peeks at the edge.
 *
 * It owns its scroll container: browse is three rails plus the cuisine row, far taller than a phone, and rendered bare
 * inside the screen's `flex: 1` container nothing scrolled (Maestro `discoverBrowse` swiped up 13 times without the
 * surface moving). Its pull-to-refresh refreshes THE RAILS — it used to live on the results leaf, bound to the main
 * search, which is not what is on screen while browsing. Colour is read from the theme at render (D15).
 *
 * @pattern Provider — each rail carries its title to the track its body renders
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { EnterTransition } from '@commise/ui/motion';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from './model.js';
import { RailContext } from './railContext.js';

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
    const { colors } = useTheme();
    const title = railTitle(rail.id, discovery);
    const headingRef = useScreenReaderFocusOnSignal<Text>(rail.headingFocusSignal + blockRecoveries);

    return (
        <View style={styles.rail}>
            <View style={styles.railHeader}>
                <Text ref={headingRef} accessibilityRole="header" style={[styles.railTitle, { color: colors.ink }]}>
                    {title}
                </Text>
                <Button
                    variant="ghost"
                    size="sm"
                    accessibilityLabel={fillTemplate(discovery.seeAllLabel, { rail: title })}
                    onPress={rail.onSeeAll}
                >
                    {discovery.seeAll}
                </Button>
            </View>
            <RailContext value={{ title }}>{rail.body}</RailContext>
        </View>
    );
};

/**
 * The curated browse rails + cuisine row (native).
 *
 * @param props - The rails with their bodies, the cuisine shortcuts, and the block's refresh notice.
 */
export const RecipeBrowseRails: FC<RecipeBrowseRailsProps> = ({
    rails,
    cuisines,
    refreshNotice,
    refresh,
    scrollBind,
}) => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();
    // A retry from the refresh notice that succeeds removes the button the viewer pressed, so the screen-reader cursor
    // goes to the first rail's heading.
    const recoveries = refreshNotice?.recoveries ?? 0;

    return (
        <ScrollView
            {...scrollBind}
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
                        <Text accessibilityRole="header" style={[styles.railTitle, { color: colors.ink }]}>
                            {discovery.cuisinesTitle}
                        </Text>
                        <ChipRow mode="filter" label={discovery.cuisinesTitle} overflow="scroll">
                            {cuisines.map((cuisine) => (
                                <Chip
                                    key={cuisine.value}
                                    kind="filter"
                                    label={cuisine.value}
                                    selected={false}
                                    onPress={cuisine.onSelect}
                                />
                            ))}
                        </ChipRow>
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
    railTitle: { ...nativeTokens.type.sectionTitle },
});
