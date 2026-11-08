/**
 * @module @commise/features-recipes — the native shell of Home's "Recent recipes" block: a header row with "See all" at
 * its end (`docs/design/uiOverhaul/buildSpec.md` §4.2) that wraps "See all" under the title when the two do not fit on
 * one line (`deviceShots2.md`), then the content, on the canvas with no surface of its own (§1.6
 * "No box in a box"; the old white card around the block is gone). Colours come from the theme at render.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeWidgetCardProps } from './props.js';

export const RecipeWidgetCard: FC<RecipeWidgetCardProps> = ({ title, seeAll, children }) => {
    const { home } = useMessages(recipeMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.block}>
            <View style={styles.headingRow}>
                <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
                    {title}
                </Text>
                {seeAll === undefined ? null : (
                    <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={home.seeAllLabel}
                        onPress={seeAll.onPress}
                        style={styles.seeAll}
                    >
                        <Text style={[styles.seeAllLabel, { color: colors.actionText }]}>{home.seeAll}</Text>
                    </Pressable>
                )}
            </View>
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    block: { gap: nativeTokens.spacing[4] },
    // The row WRAPS rather than squeezing: when the title and "See all" do not fit on one line, "See all" drops under
    // the title, at the start, and the title keeps the width (`deviceShots2.md`).
    headingRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
    },
    title: { ...nativeTokens.type.sectionTitle, flexShrink: 1 },
    // Padding at the END only (designer ruling 2026-11-01): wrapped under the title, the link's text starts at the
    // title's edge; beside it, `space-between` pins the box to the end, so the text does not move. `paddingEnd` mirrors
    // in a right-to-left layout.
    seeAll: { minHeight: 48, justifyContent: 'center', paddingEnd: nativeTokens.spacing[3] },
    seeAllLabel: { ...nativeTokens.type.label },
});
