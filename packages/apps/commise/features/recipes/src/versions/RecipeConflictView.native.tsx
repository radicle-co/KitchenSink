/**
 * @module @commise/features-recipes — native concurrent-edit conflict view (T070 / C-005 building block).
 *
 * The React Native leaf of {@link import('./RecipeConflictView.js').RecipeConflictView} — same controlled,
 * presentational contract for FR-007c: the user's in-progress version and the latest saved version
 * side-by-side, plus all three resolutions — keep mine, use theirs, or MERGE field-by-field. The merge panel
 * is a per-field chooser (a radio group per editable field, defaulting to the user's draft) that composes a
 * new draft and delegates it upward via `onMerge`; nothing is auto-merged.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { useState } from 'react';
import type { FC } from 'react';
import { palette } from '@commise/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeVersionMessages } from './messages.js';
import {
    buildRecipeMergeFields,
    composeMergedRecipe,
    fillTemplate,
    toConflictSideFields,
    type ConflictField,
    type MergeSide,
    type RecipeConflictViewProps,
} from './model.js';

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

/** One radio option in a field's merge chooser. */
const MergeOption: FC<{
    readonly label: string;
    readonly checked: boolean;
    readonly onSelect: () => void;
}> = ({ label, checked, onSelect }) => (
    <Pressable
        accessibilityRole="radio"
        accessibilityLabel={label}
        aria-checked={checked}
        onPress={onSelect}
        style={styles.option}
    >
        <View style={[styles.radioDot, checked && styles.radioDotChecked]} />
        <Text style={styles.optionLabel}>{label}</Text>
    </Pressable>
);

export const RecipeConflictView: FC<RecipeConflictViewProps> = ({
    mineTitle,
    theirs,
    mine,
    mineValues,
    theirsValues,
    onKeepMine,
    onUseTheirs,
    onMerge,
}) => {
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    const [merging, setMerging] = useState(false);
    // Sparse per-field resolution — an absent field defaults to the user's own draft ("mine").
    const [selections, setSelections] = useState<Record<string, MergeSide>>({});

    const optionLabel = (side: string, value: string): string =>
        fillTemplate(conflict.mergeOptionLabel, { side, value });

    if (merging) {
        const fields = buildRecipeMergeFields(mineValues, theirsValues, conflict, locale);
        const sideOf = (key: string): MergeSide => selections[key] ?? 'mine';
        const choose = (key: string, side: MergeSide): void =>
            setSelections((current) => ({ ...current, [key]: side }));

        return (
            <View accessibilityLabel={conflict.mergeHeading} style={styles.container}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {conflict.mergeHeading}
                </Text>
                <Text style={styles.explanation}>{conflict.mergeExplanation}</Text>
                {fields.map((field) => (
                    <View
                        key={field.key}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={field.label}
                        style={styles.group}
                    >
                        <Text style={styles.fieldLabel}>{field.label}</Text>
                        <MergeOption
                            label={optionLabel(conflict.mineHeading, field.mineValue)}
                            checked={sideOf(field.key) === 'mine'}
                            onSelect={() => choose(field.key, 'mine')}
                        />
                        <MergeOption
                            label={optionLabel(conflict.theirsHeading, field.theirsValue)}
                            checked={sideOf(field.key) === 'theirs'}
                            onSelect={() => choose(field.key, 'theirs')}
                        />
                    </View>
                ))}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={conflict.mergeSubmit}
                    onPress={() => onMerge(composeMergedRecipe(mineValues, theirsValues, selections))}
                    style={styles.chooseButton}
                >
                    <Text style={styles.chooseLabel}>{conflict.mergeSubmit}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={conflict.mergeBack}
                    onPress={() => {
                        setSelections({});
                        setMerging(false);
                    }}
                    style={styles.secondaryButton}
                >
                    <Text style={styles.secondaryLabel}>{conflict.mergeBack}</Text>
                </Pressable>
            </View>
        );
    }

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
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={conflict.mergeAction}
                onPress={() => setMerging(true)}
                style={styles.secondaryButton}
            >
                <Text style={styles.secondaryLabel}>{conflict.mergeAction}</Text>
            </Pressable>
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
    group: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 16,
        gap: 8,
    },
    option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    radioDot: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: palette.slate,
    },
    radioDotChecked: { borderColor: palette.seafoam, backgroundColor: palette.seafoam },
    optionLabel: { fontSize: 15, color: palette.charcoal, flexShrink: 1 },
    chooseButton: {
        alignSelf: 'flex-start',
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 20,
        marginTop: 4,
    },
    chooseLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    secondaryButton: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.5)',
        paddingVertical: 10,
        paddingHorizontal: 20,
        marginTop: 4,
    },
    secondaryLabel: { color: palette.charcoal, fontWeight: '600', fontSize: 14 },
});
