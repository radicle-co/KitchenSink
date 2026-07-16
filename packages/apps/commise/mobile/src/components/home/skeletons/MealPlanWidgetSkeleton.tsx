/**
 * @module home/skeletons/MealPlanWidgetSkeleton — the "This Week's Meals" roadmap placeholder (mobile).
 *
 * Mirrors the mockup's weekly strip SHAPE — seven day tiles, each a weekday label over a meal thumbnail —
 * with a skeleton block where each meal would be. The weekday labels are REAL, locale-formatted data (via the
 * shared `weekdayLabels`), so they stay exposed to assistive tech; only the MEAL is unknown, and only the
 * meal is a skeleton block. The mockup's "See all →" control is omitted — it has nowhere to go. Feature 005
 * replaces it with a live `meal-plan` widget.
 */
import { weekdayLabels } from '@commise/features-core';
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { JSX } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../../i18n/messages.js';
import { PlaceholderWidgetCard } from './PlaceholderWidgetCard.js';

/**
 * The meal-plan widget's skeleton placeholder (mobile).
 *
 * @returns The week strip's shape: real weekdays, no meals.
 */
export function MealPlanWidgetSkeleton(): JSX.Element {
    const { home } = useMessages(mobileMessages);
    const locale = useLocale();

    return (
        <PlaceholderWidgetCard title={home.roadmap.titles['meal-plan']} comingSoonLabel={home.roadmap.comingSoon}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {weekdayLabels(locale).map((day) => (
                    <View key={day} style={styles.tile}>
                        {/* The weekday name is REAL data — exposed, not hidden. */}
                        <Text style={styles.day}>{day}</Text>
                        {/* The meal thumbnail — the only unknown on this tile. */}
                        <View style={styles.meal} />
                    </View>
                ))}
            </ScrollView>
        </PlaceholderWidgetCard>
    );
}

const styles = StyleSheet.create({
    strip: { flexDirection: 'row', gap: 12, paddingBottom: 4 },
    tile: {
        width: 72,
        alignItems: 'center',
        gap: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.3)',
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        padding: 12,
    },
    day: { fontSize: 12, fontWeight: '500', color: palette.slate, letterSpacing: 1, textTransform: 'uppercase' },
    meal: { width: 48, height: 48, borderRadius: 12, backgroundColor: palette.pearl },
});
