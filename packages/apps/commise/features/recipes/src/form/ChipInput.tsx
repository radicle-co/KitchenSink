'use client';

/**
 * @module @commise/features-recipes/form/ChipInput — the web chip input for the recipe's tags and dietary flags
 * (`docs/design/uiOverhaul/buildSpec.md` §7.4): a labelled field that adds a value on Enter or a comma, and the values
 * already added as `input` chips named "Remove {value}".
 *
 * Controlled: the added values live in the draft. Only the text being typed is local state. Each value goes through
 * the pure `addChip` (trimmed, a duplicate in any case dropped). A comma is read in the text itself, so a pasted
 * "a, b, c" adds `a` and `b` and keeps `c` being typed. Leaving the field adds what was typed, so nothing typed is
 * lost silently. The native leaf (`ChipInput.native.tsx`) shares this contract.
 */
import { Chip, ChipRow } from '@commise/ui/chip';
import { FieldLabel, Input, fieldHintId } from '@commise/ui/input';
import type { FC } from 'react';
import { useState } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { addChips, removeChipAt, splitAtCommas } from './props.js';

/** Props for {@link ChipInput}. */
export interface ChipInputProps {
    /** The field's id, unique on the page. */
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

/** The web tag and dietary-flag chip input. */
export const ChipInput: FC<ChipInputProps> = ({ id, label, hint, values, onChange, removeChipLabel }) => {
    const [draft, setDraft] = useState('');

    const commit = (tokens: readonly string[], rest: string): void => {
        const next = addChips(values, tokens);

        if (next.length !== values.length) {
            onChange(next);
        }

        setDraft(rest);
    };

    return (
        <div className="flex flex-col gap-2" onBlur={() => commit([draft], '')}>
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
        </div>
    );
};
