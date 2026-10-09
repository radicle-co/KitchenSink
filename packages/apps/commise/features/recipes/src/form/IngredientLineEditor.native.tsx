/**
 * @module @commise/features-recipes/form — `IngredientLineEditor` (native): the row editor's fields (build spec §7.5.2),
 * drawn inside either frame, the phone sheet or the tablet's inline panel. The React Native leaf of
 * `./IngredientLineEditor.tsx`: the food with Change, Amount (with "+ Add a range"), Unit and Preparation, then Food
 * details. The fields wrap by width: in the sheet Amount and Unit share line 1 and Preparation takes line 2.
 *
 * PLATFORM-FORK: an amount field keeps the text the cook is typing while they type it. A controlled React Native field
 * would otherwise be rewritten from the number its text parses to, so "1." would snap back to "1" and "1.5" could
 * never be typed; the web's number input keeps a partial number itself.
 *
 * Presentational: `props → JSX` over the row editor's view (`RowLineEditorView`); every edit is the view's.
 *
 * @pattern Template — one field layout, framed by `IngredientLineEditorSheet` and the row's inline panel
 */
import { Button } from '@commise/ui/button';
import { Combobox } from '@commise/ui/combobox';
import { FieldLabel, Input, fieldGeometry, fieldLabelId, fieldPaint } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { TextInput } from '@commise/ui/text-input';
import { useTheme } from '@commise/ui/theme';
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ingredientUnitNoteId } from './fieldErrorIds.js';
import type { IngredientLineEditorProps } from './IngredientLineEditor.js';

/** One bound of the amount: empty means no amount, never "0" (R40). */
const AmountField: FC<{
    readonly id: string;
    readonly value: string;
    readonly invalid: boolean;
    readonly onChange: (text: string) => void;
    readonly accessibleName?: string;
}> = ({ id, value, invalid, onChange, accessibleName }) => {
    const theme = useTheme();
    // The text the cook is typing, while they type it; the draft's number otherwise.
    const [typing, setTyping] = useState<string | undefined>(undefined);

    return (
        <TextInput
            nativeID={id}
            {...(accessibleName === undefined
                ? { 'aria-labelledby': fieldLabelId(id) }
                : { accessibilityLabel: accessibleName })}
            aria-invalid={invalid}
            inputMode="decimal"
            value={typing ?? value}
            onChangeText={(text) => {
                setTyping(text);
                onChange(text);
            }}
            onBlur={() => setTyping(undefined)}
            style={[styles.field, styles.amount, fieldPaint(theme, invalid)]}
        />
    );
};

/** The row editor's fields. */
export const IngredientLineEditor: FC<IngredientLineEditorProps> = ({ view, index, m, details }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.stack}>
            <View style={styles.foodLine}>
                <Text style={[styles.food, { color: colors.ink }]}>{view.food}</Text>
                {view.onChangeFood !== undefined && (
                    <Button variant="ghost" onPress={view.onChangeFood}>
                        {m.rowChange}
                    </Button>
                )}
            </View>
            <View style={styles.fields}>
                <View style={styles.cell}>
                    <FieldLabel forId={view.ids.amount} label={m.rowAmountLabel} />
                    <View style={styles.amounts}>
                        <AmountField
                            id={view.ids.amount}
                            value={view.amountLow}
                            invalid={view.amountInvalid}
                            onChange={view.onAmountLow}
                        />
                        {view.rangeShown && (
                            <>
                                <Text aria-hidden style={[styles.to, { color: colors.inkMuted }]}>
                                    {m.rowAmountTo}
                                </Text>
                                <AmountField
                                    id={view.ids.amountHigh}
                                    value={view.amountHigh}
                                    invalid={view.amountInvalid}
                                    onChange={view.onAmountHigh}
                                    accessibleName={m.rowAmountHighLabel}
                                />
                            </>
                        )}
                    </View>
                </View>
                <View style={[styles.cell, styles.unit]}>
                    <Text aria-hidden style={[styles.label, { color: colors.inkMuted }]}>
                        {m.rowUnitLabel}
                    </Text>
                    <Combobox
                        label={m.rowUnitLabel}
                        listLabel={m.rowUnitListLabel}
                        value={view.unit}
                        onValueChange={view.onUnit}
                        groups={[
                            { key: 'units', options: view.unitSuggestions.map((unit) => ({ key: unit, label: unit })) },
                        ]}
                        onSelect={view.onUnit}
                        countAnnouncement=""
                    />
                </View>
                <View style={[styles.cell, styles.prep]}>
                    <FieldLabel forId={view.ids.prep} label={m.rowPrepLabel} />
                    <Input id={view.ids.prep} value={view.prep} onChangeText={view.onPrep} />
                </View>
            </View>
            <View style={styles.row}>
                {view.rangeShown ? (
                    <Button variant="ghost" onPress={view.onRemoveRange}>
                        {m.rowRemoveRange}
                    </Button>
                ) : (
                    <Button variant="ghost" icon="plus" onPress={view.onAddRange}>
                        {m.rowAddRange}
                    </Button>
                )}
            </View>
            {view.unitNote !== undefined && (
                <Text nativeID={ingredientUnitNoteId(index)} style={[styles.caption, { color: colors.inkMuted }]}>
                    {view.unitNote}
                </Text>
            )}
            {view.detailsOffered && (
                <View style={styles.stack}>
                    <Pressable
                        accessibilityRole="button"
                        aria-expanded={view.detailsOpen}
                        onPress={view.onToggleDetails}
                        style={styles.disclosure}
                    >
                        <Text style={[styles.disclosureText, { color: colors.actionText }]}>{m.rowFoodDetails}</Text>
                    </Pressable>
                    {view.detailsOpen && details}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[3] },
    foodLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    food: { ...nativeTokens.type.body, flexShrink: 1, flexGrow: 1 },
    fields: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        columnGap: nativeTokens.spacing[3],
        rowGap: nativeTokens.spacing[4],
    },
    cell: { gap: nativeTokens.spacing[1] },
    amounts: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    field: fieldGeometry,
    // §7.5.2: a 64 pt number field, a 112 pt unit, and the preparation filling the rest at 160 pt or more.
    amount: { width: 64, fontVariant: ['tabular-nums'] },
    unit: { width: 112 },
    prep: { minWidth: 160, flexGrow: 1, flexBasis: 160 },
    to: { ...nativeTokens.type.body },
    label: { ...nativeTokens.type.label },
    row: { flexDirection: 'row', flexWrap: 'wrap' },
    caption: { ...nativeTokens.type.caption },
    disclosure: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
    disclosureText: { ...nativeTokens.type.label },
});
