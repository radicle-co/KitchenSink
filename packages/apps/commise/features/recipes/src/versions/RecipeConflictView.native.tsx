/**
 * @module @commise/features-recipes — native concurrent-edit conflict view (T070 / C-005 building block).
 *
 * The React Native leaf of {@link import('./RecipeConflictView.js').RecipeConflictView} — same controlled,
 * presentational contract: the user's in-progress version and the latest saved version side-by-side (each
 * a labelled group with a heading and the key differing fields) plus the two resolution choices.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeVersionMessages } from './messages.js';
import { toConflictSideFields, type ConflictField, type RecipeConflictViewProps } from './model.js';

/** Render one side of the conflict — a labelled group with a heading, its fields, and its choice. */
const ConflictSide: FC<{
    readonly heading: string;
    readonly fields: readonly ConflictField[];
    readonly actionLabel: string;
    readonly onChoose: () => void;
}> = ({ heading, fields, actionLabel, onChoose }) => (
    <View accessibilityLabel={heading} style={styles.side}>
        <Text accessibilityRole="header" style={styles.sideHeading}>
            {heading}
        </Text>
        {fields.map((field) => (
            <View key={field.key} style={styles.field}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <Text style={styles.fieldValue}>{field.value}</Text>
            </View>
        ))}
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            onPress={onChoose}
            style={styles.chooseButton}
        >
            <Text style={styles.chooseLabel}>{actionLabel}</Text>
        </Pressable>
    </View>
);

export const RecipeConflictView: FC<RecipeConflictViewProps> = ({
    mineTitle,
    theirs,
    mine,
    onKeepMine,
    onUseTheirs,
}) => {
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();

    return (
        <View accessibilityLabel={conflict.heading} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {conflict.heading}
            </Text>
            <Text style={styles.explanation}>{conflict.explanation}</Text>
            <ConflictSide
                heading={conflict.mineHeading}
                fields={toConflictSideFields(mineTitle, mine, conflict, locale)}
                actionLabel={conflict.keepMine}
                onChoose={onKeepMine}
            />
            <ConflictSide
                heading={conflict.theirsHeading}
                fields={toConflictSideFields(theirs.title, theirs, conflict, locale)}
                actionLabel={conflict.useTheirs}
                onChoose={onUseTheirs}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
    heading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    explanation: { fontSize: 14, color: palette.slate },
    side: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 16,
        gap: 8,
    },
    sideHeading: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    field: { gap: 2 },
    fieldLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: palette.slate },
    fieldValue: { fontSize: 15, color: palette.charcoal },
    chooseButton: {
        alignSelf: 'flex-start',
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 20,
        marginTop: 4,
    },
    chooseLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
