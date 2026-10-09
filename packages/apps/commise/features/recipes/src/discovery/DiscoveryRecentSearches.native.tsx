/**
 * @module @commise/features-recipes — the native recent-searches panel (U7): a card of 44 pt rows under the keyword
 * field, shown while the field holds focus and the viewer is idle.
 *
 * Gated on `!searching`, not on the query alone: a filter applied from the sheet leaves the query blank, and on a phone
 * this panel covers the middle of the screen, exactly where a swipe to scroll the results lands. Pressing a row does NOT
 * blur the field on RN, so the panel survives the tap; it goes once the container sets the chosen query.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import type { RecipeRecentSearchesControl } from './model.js';

/** Props for {@link DiscoveryRecentSearches}. */
export interface DiscoveryRecentSearchesProps {
    /** The recent searches; absent when the container offers none. */
    readonly recentSearches: RecipeRecentSearchesControl | undefined;
    /** Whether the keyword field holds focus. */
    readonly fieldFocused: boolean;
    /** Whether the viewer is searching right now (a typed term or an active filter). */
    readonly searching: boolean;
}

/** The native recent-searches panel. */
export const DiscoveryRecentSearches: FC<DiscoveryRecentSearchesProps> = ({
    recentSearches,
    fieldFocused,
    searching,
}) => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();

    if (recentSearches === undefined || recentSearches.queries.length === 0 || !fieldFocused || searching) {
        return null;
    }

    return (
        <View style={[styles.panel, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}>
            <View style={styles.header}>
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
            {/* The rows scroll: under a keyboard the panel can outgrow the room left. `handled`, so the first tap with
                the keyboard up runs the query instead of only closing the keyboard. */}
            <ScrollView keyboardShouldPersistTaps="handled">
                {recentSearches.queries.map((query) => (
                    <Pressable
                        key={query}
                        accessibilityRole="button"
                        accessibilityLabel={fillTemplate(discovery.recentSearchLabel, { query })}
                        onPress={() => recentSearches.onSelect(query)}
                        style={styles.row}
                    >
                        <Text style={[styles.body, { color: colors.ink }]}>{query}</Text>
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    overline: { ...nativeTokens.type.overline },
    body: { ...nativeTokens.type.body },
    panel: {
        flexShrink: 1,
        borderRadius: nativeTokens.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    row: { minHeight: 44, justifyContent: 'center' },
});
