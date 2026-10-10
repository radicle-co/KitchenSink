/**
 * @module @commise/features-recipes/form/ChipInput — the native chip input for the recipe's tags and dietary flags
 * (`docs/design/uiOverhaul/buildSpec.md` §7.4): the React Native leaf of `ChipInput`, on the same contract and the
 * same pure transitions ({@link addChips}, {@link splitAtCommas}, {@link removeChipAt}).
 *
 * A value is added on the return key, on a comma, or with the Add control: a touch keyboard's return key says "done"
 * and is easy to miss, so the control is the visible way. There is no add-on-blur here: no design-system field reports
 * its blur on native, so what is typed stays in the field until it is added.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { FieldLabel, Input, fieldHintId } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeFormMessages } from './messages.js';
import { addChips, removeChipAt, splitAtCommas } from './props.js';

/** Props for {@link ChipInput}. */
export interface ChipInputProps {
    /** The field's id, unique on the screen. */
    readonly id: string;
    /** The field's visible label, which also names its chips' group (e.g. "Tags"). */
    readonly label: string;
    /** How to add a value, shown under the label and linked to the field. */
    readonly hint: string;
    /** The added values (from the draft). */
    readonly values: readonly string[];
    /** Called with the next values on every add or remove. */
    readonly onChange: (next: string[]) => void;
    /** A chip's accessible name template (contains `{value}`). */
    readonly removeChipLabel: string;
}

/** The native tag and dietary-flag chip input. */
export const ChipInput: FC<ChipInputProps> = ({ id, label, hint, values, onChange, removeChipLabel }) => {
    const m = useMessages(recipeFormMessages);
    const [draft, setDraft] = useState('');

    const commit = (tokens: readonly string[], rest: string): void => {
        const next = addChips(values, tokens);

        if (next.length !== values.length) {
            onChange(next);
        }

        setDraft(rest);
    };

    return (
        <View style={styles.field}>
            <FieldLabel forId={id} label={label} hint={hint} />
            {values.length === 0 ? null : (
                <ChipRow mode="input" label={label} overflow="wrap">
                    {values.map((value, index) => (
                        <Chip
                            key={value}
                            kind="input"
                            label={value}
                            removeLabel={fillTemplate(removeChipLabel, { value })}
                            onRemove={() => onChange(removeChipAt(values, index))}
                        />
                    ))}
                </ChipRow>
            )}
            <Input
                id={id}
                value={draft}
                describedBy={fieldHintId(id)}
                enterKeyHint="done"
                onChangeText={(text) => {
                    const { finished, rest } = splitAtCommas(text);

                    if (finished.length === 0) {
                        setDraft(text);
                    } else {
                        commit(finished, rest);
                    }
                }}
                onSubmit={() => commit([draft], '')}
            />
            {/* Under the field, not beside it: at 320 pt a label beside the field would wrap or squeeze it. */}
            <View style={styles.add}>
                <Button variant="ghost" icon="plus" onPress={() => commit([draft], '')}>
                    {fillTemplate(m.addChipLabel, { field: label })}
                </Button>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    field: { gap: nativeTokens.spacing[2] },
    add: { alignSelf: 'flex-start' },
});
