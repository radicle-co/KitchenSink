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
import { useContainerClass } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../../i18n/messages.js';
import { PlaceholderWidgetCard } from './PlaceholderWidgetCard.js';

/**
 * The meal-plan widget's skeleton placeholder (mobile): the week as seven equal tiles in one row (`buildSpec.md` §4.2).
 *
 * A phone draws the narrow name ("M") and a wider window the short one ("Mon"); each tile is announced by the full
 * weekday. Seven equal tiles fit the narrowest phone, so there is no sideways scroller to hide days behind (F16).
 *
 * @returns The week strip's shape: real weekdays, no meals.
 */
export function MealPlanWidgetSkeleton(): JSX.Element {
    const { home } = useMessages(mobileMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const shown = weekdayLabels(locale, useContainerClass() === 'narrow' ? 'narrow' : 'short');

    return (
        <PlaceholderWidgetCard title={home.roadmap.titles['meal-plan']} soonLabel={home.roadmap.soon}>
            <View style={styles.strip}>
                {weekdayLabels(locale, 'long').map((day, index) => (
                    <View
                        key={day}
                        accessible
                        accessibilityLabel={day}
                        style={[styles.tile, { borderColor: colors.lineDivider }]}
                    >
                        {/* The weekday is REAL data — announced by its full name. Only the meal is unknown. */}
                        <Text style={[styles.day, { color: colors.inkMuted }]}>{shown[index]}</Text>
                        {/* The meal thumbnail — the only unknown on this tile, so the only thing hidden. */}
                        <View aria-hidden style={[styles.meal, { backgroundColor: colors.surfaceMuted }]} />
                    </View>
                ))}
            </View>
        </PlaceholderWidgetCard>
    );
}

const styles = StyleSheet.create({
    strip: { flexDirection: 'row', gap: 2, marginHorizontal: -nativeTokens.spacing[1] },
    tile: {
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: nativeTokens.spacing[2],
        paddingHorizontal: 2,
    },
    day: { ...nativeTokens.type.caption },
    meal: { width: '100%', maxWidth: 48, aspectRatio: 1, borderRadius: nativeTokens.radius.sm },
});
