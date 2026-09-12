/**
 * @module home/skeletons/NutritionWidgetSkeleton — the "Today's Nutrition" roadmap placeholder (mobile).
 *
 * Mirrors the mockup's nutrition panel SHAPE — a progress ring beside a calorie block — with skeleton blocks
 * where the ring's percentage and the calorie figures would be. Every number the mockup shows ("62%",
 * "1,240", "of 2,000 cal") is deliberately absent: a hard-coded figure would read as the viewer's real
 * intake, the specific harm CR-001 forbids. Feature 007 replaces it by registering a live `nutrition` widget.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { mobileMessages } from '../../../i18n/messages.js';
import { PlaceholderWidgetCard } from './PlaceholderWidgetCard.js';

/**
 * The nutrition widget's skeleton placeholder (mobile).
 *
 * @returns The nutrition panel's shape with no data in it.
 */
export function NutritionWidgetSkeleton(): JSX.Element {
    const { home } = useMessages(mobileMessages);

    return (
        <PlaceholderWidgetCard title={home.roadmap.titles.nutrition} comingSoonLabel={home.roadmap.comingSoon}>
            {/* Pure shape, so the whole row is hidden from assistive tech. `aria-hidden` (not RN's
                `accessibilityElementsHidden`/`importantForAccessibility` pair, which RN reverse-maps from it
                anyway) because that is the only spelling react-native-web projects to the DOM — see the shell. */}
            <View aria-hidden style={styles.row}>
                {/* The 64px ring: an unfilled track, since a filled arc would assert a real percentage. */}
                <View style={styles.ring} />
                <View style={styles.textBlock}>
                    <View style={[styles.bar, styles.barOverline]} />
                    <View style={[styles.bar, styles.barFigure]} />
                    <View style={[styles.bar, styles.barCaption]} />
                </View>
            </View>
        </PlaceholderWidgetCard>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 20 },
    ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 4, borderColor: palette.pearl },
    textBlock: { flex: 1, gap: 8 },
    bar: { borderRadius: 4, backgroundColor: palette.pearl },
    barOverline: { height: 12, width: 80 },
    barFigure: { height: 28, width: 112 },
    barCaption: { height: 12, width: 96 },
});
