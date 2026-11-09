/**
 * @module @commise/features-recipes/form — `IngredientLineEditor` (native): the row editor's fields (build spec §7.5.2),
 * drawn inside either frame, the phone sheet or the tablet's inline panel. The React Native leaf of
 * `./IngredientLineEditor.tsx`: "Counted as" and the food with Change, the cook's own words and the note, Amount (with "+ Add a range"), Unit and Preparation, then Food
 * details. The fields wrap by width: in the sheet Amount and Unit share line 1 and Preparation takes line 2.
 *
 * Presentational: `props → JSX` over the row editor's view (`RowLineEditorView`); every edit is the view's.
 *
 * @pattern Template — one field layout, framed by `IngredientLineEditorSheet` and the row's inline panel
 */
import { Button } from '@commise/ui/button';
import { Combobox } from '@commise/ui/combobox';
import { FieldLabel, Input } from '@commise/ui/input';
import { PressScale } from '@commise/ui/press-scale';
import { Text as DesignText } from '@commise/ui/text';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

import { ingredientUnitNoteId } from './fieldErrorIds.js';
import type { IngredientLineEditorProps } from './IngredientLineEditor.js';

/**
 * One bound of the amount: empty means no amount, never "0" (R40). Its text is the view's (`amountLow`/`amountHigh`),
 * which keeps what the cook typed, so "1." is not rewritten to "1" on the way to "1.5".
 *
 * PLATFORM-FORK: native has no `aria-describedby` or `aria-invalid`, so the amount note is the field's accessibility
 * hint (the design-system `Input`'s `error`, which also draws the danger edge). The field holds itself in view while
 * the cook types in it.
 */
const AmountField: FC<{
    readonly id: string;
    readonly value: string;
    readonly invalid: boolean;
    readonly note: string | undefined;
    readonly onChange: (text: string) => void;
    readonly accessibleName: string;
}> = ({ id, value, invalid, note, onChange, accessibleName }) => (
    <YStack width={64}>
        <Input
            id={id}
            label={accessibleName}
            inputMode="decimal"
            value={value}
            onChangeText={onChange}
            invalid={invalid}
            {...(note === undefined ? {} : { error: note })}
        />
    </YStack>
);

/** The row editor's fields. */
export const IngredientLineEditor: FC<IngredientLineEditorProps> = ({ view, index, m, details }) => {
    // A refused amount that was not mistyped here (the form's refusal) has no note of its own, but an invalid field
    // still has to say why to a screen reader: the sentence the row shows for it.
    const amountHint = view.amountNote?.text ?? (view.amountInvalid ? m.rowAmountInvalid : undefined);

    return (
        <YStack gap="$3">
            <YStack gap="$1">
                <DesignText typeRole="caption" color="$inkMuted">
                    {m.rowCountedAsLabel}
                </DesignText>
                <XStack flexWrap="wrap" alignItems="center" gap="$2">
                    <DesignText typeRole="body" color="$ink" flexShrink={1} flexGrow={1}>
                        {view.food}
                    </DesignText>
                    {view.onChangeFood !== undefined && (
                        <Button variant="ghost" onPress={view.onChangeFood}>
                            {m.rowChange}
                        </Button>
                    )}
                </XStack>
            </YStack>
            <XStack flexWrap="wrap" alignItems="flex-end" columnGap="$3" rowGap="$4">
                <YStack gap="$1" minWidth={160} flexGrow={1} flexBasis={160}>
                    <FieldLabel forId={view.ids.displayText} label={m.rowDisplayTextLabel} />
                    <Input
                        id={view.ids.displayText}
                        label={m.rowDisplayTextLabel}
                        value={view.displayText}
                        placeholder={view.displayTextPlaceholder}
                        onChangeText={view.onDisplayText}
                    />
                </YStack>
                <YStack gap="$1" minWidth={160} flexGrow={1} flexBasis={160}>
                    <FieldLabel forId={view.ids.note} label={m.rowNoteLabel} />
                    <Input
                        id={view.ids.note}
                        label={m.rowNoteLabel}
                        value={view.note}
                        placeholder={m.rowNotePlaceholder}
                        onChangeText={view.onNote}
                    />
                </YStack>
            </XStack>
            <XStack flexWrap="wrap" alignItems="flex-end" columnGap="$3" rowGap="$4">
                <YStack gap="$1">
                    <FieldLabel forId={view.ids.amount} label={m.rowAmountLabel} />
                    <XStack alignItems="center" gap="$2">
                        <AmountField
                            id={view.ids.amount}
                            value={view.amountLow}
                            invalid={view.amountInvalid}
                            note={amountHint}
                            onChange={view.onAmountLow}
                            accessibleName={m.rowAmountLabel}
                        />
                        {view.rangeShown && (
                            <>
                                <DesignText aria-hidden typeRole="body" color="$inkMuted">
                                    {m.rowAmountTo}
                                </DesignText>
                                <AmountField
                                    id={view.ids.amountHigh}
                                    value={view.amountHigh}
                                    invalid={view.amountInvalid}
                                    note={amountHint}
                                    onChange={view.onAmountHigh}
                                    accessibleName={m.rowAmountHighLabel}
                                />
                            </>
                        )}
                    </XStack>
                </YStack>
                <YStack gap="$1" width={112}>
                    <Combobox
                        id={view.ids.unit}
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
                </YStack>
                <YStack gap="$1" minWidth={160} flexGrow={1} flexBasis={160}>
                    <FieldLabel forId={view.ids.prep} label={m.rowPrepLabel} />
                    <Input id={view.ids.prep} label={m.rowPrepLabel} value={view.prep} onChangeText={view.onPrep} />
                </YStack>
            </XStack>
            <XStack flexWrap="wrap">
                {view.rangeShown ? (
                    <Button variant="ghost" onPress={view.onRemoveRange}>
                        {m.rowRemoveRange}
                    </Button>
                ) : (
                    <Button variant="ghost" icon="plus" onPress={view.onAddRange}>
                        {m.rowAddRange}
                    </Button>
                )}
            </XStack>
            {view.amountNote !== undefined && (
                <DesignText nativeID={view.amountNote.id} typeRole="caption" color="$dangerText">
                    {view.amountNote.text}
                </DesignText>
            )}
            {view.unitNote !== undefined && (
                <DesignText nativeID={ingredientUnitNoteId(index)} typeRole="caption" color="$inkMuted">
                    {view.unitNote}
                </DesignText>
            )}
            {view.detailsOffered && (
                <YStack gap="$3">
                    <PressScale
                        accessibilityRole="button"
                        aria-expanded={view.detailsOpen}
                        onPress={view.onToggleDetails}
                    >
                        <YStack minHeight={48} justifyContent="center" alignSelf="flex-start">
                            <DesignText typeRole="label" color="$actionText">
                                {m.rowFoodDetails}
                            </DesignText>
                        </YStack>
                    </PressScale>
                    {view.detailsOpen && details}
                </YStack>
            )}
        </YStack>
    );
};
