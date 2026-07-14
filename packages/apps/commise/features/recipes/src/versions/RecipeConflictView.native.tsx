/**
 * @module @commise/features-recipes — native concurrent-edit conflict view (T070 / C-005 building block).
 *
 * The React Native leaf of {@link import('./RecipeConflictView.js').RecipeConflictView} — same controlled,
 * presentational contract: the user's in-progress version and the latest saved version side-by-side (each
 * a labelled group with a heading and the key differing fields) plus the two resolution choices.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { recipeVersionMessages } from './messages.js';
import { toConflictSideFields, type ConflictField, type RecipeConflictViewProps } from './model.js';

/** Render one side of the conflict — a labelled group with a heading, its fields, and its choice. */
const ConflictSide: FC<{
    readonly heading: string;
    readonly fields: readonly ConflictField[];
    readonly actionLabel: string;
    readonly onChoose: () => void;
}> = ({ heading, fields, actionLabel, onChoose }) => (
    <View accessibilityLabel={heading}>
        <Text accessibilityRole="header">{heading}</Text>
        {fields.map((field) => (
            <View key={field.key}>
                <Text>{field.label}</Text>
                <Text>{field.value}</Text>
            </View>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onChoose}>
            <Text>{actionLabel}</Text>
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
        <View accessibilityLabel={conflict.heading}>
            <Text accessibilityRole="header">{conflict.heading}</Text>
            <Text>{conflict.explanation}</Text>
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
