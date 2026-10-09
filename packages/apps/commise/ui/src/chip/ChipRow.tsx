'use client';

/**
 * @module @commise/ui/chip — the web design-system {@link ChipRow}.
 *
 * In `filter` and `input` mode the row is a named `group` around the chips the screen places. In `choice` mode the row
 * owns its options and their group semantics:
 *
 *  - a choice that stays made is a Radix `RadioGroup`: a `radiogroup` of `radio`s, roving focus, and the arrow keys
 *    move the choice;
 *  - a CLEARABLE choice (difficulty) is a Radix `ToggleGroup` of `type="single"`, which renders a named `group` of
 *    `radio`s with `aria-checked` — a radio that can be cleared by pressing it again. ⚠️ The blueprint wrote
 *    `aria-pressed` for this case; Radix's single ToggleGroup emits `role="radio"` + `aria-checked` instead, and that is
 *    asserted rather than overridden (overriding a library's roles is how ARIA goes wrong).
 *
 * Each option is drawn as a chip (`chipClass`), with the check while chosen.
 *
 * `'use client'`: Radix's roving focus is an effect.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Composite — the row owns the group semantics its chips cannot state alone
 * @pattern Adapter over `@radix-ui/react-radio-group` and `@radix-ui/react-toggle-group`
 * @pattern Strategy — `clearable` (the blueprint's contract) selects which Radix adapter carries the choice: one that
 *     stays made, or one that clears; the two differ in behaviour, so the row picks, never a screen
 */
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { chipClass, chipRowClass } from './chipClass.js';
import { visibleChipLabel } from './chipLabel.js';
import type { ChipOption, ChipRowProps, ChoiceRowProps } from './props.js';

/** An option's face: the check while chosen, then its label. */
const OptionFace: FC<{ readonly option: ChipOption; readonly chosen: boolean }> = ({ option, chosen }) => (
    <>
        {chosen ? <Icon name="check" size={16} /> : null}
        <span>{visibleChipLabel(option.label)}</span>
    </>
);

/** A choice row: radios that stay chosen, or — clearable — radios that clear when pressed again. */
const ChoiceRow: FC<ChoiceRowProps> = ({ label, overflow, options, value, onChange, clearable = false }) =>
    clearable ? (
        <ToggleGroup.Root
            type="single"
            aria-label={label}
            value={value ?? ''}
            onValueChange={(next) => onChange(next === '' ? null : next)}
            className={chipRowClass(overflow)}
        >
            {options.map((option) => (
                <ToggleGroup.Item
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                    className={chipClass(option.value === value)}
                >
                    <OptionFace option={option} chosen={option.value === value} />
                </ToggleGroup.Item>
            ))}
        </ToggleGroup.Root>
    ) : (
        <RadioGroup.Root
            aria-label={label}
            orientation="horizontal"
            value={value ?? ''}
            onValueChange={onChange}
            className={chipRowClass(overflow)}
        >
            {options.map((option) => (
                <RadioGroup.Item
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                    className={chipClass(option.value === value)}
                >
                    <OptionFace option={option} chosen={option.value === value} />
                </RadioGroup.Item>
            ))}
        </RadioGroup.Root>
    );

/** The web design-system chip row. */
export const ChipRow: FC<ChipRowProps> = (props) =>
    props.mode === 'choice' ? (
        <ChoiceRow {...props} />
    ) : (
        <div role="group" aria-label={props.label} className={chipRowClass(props.overflow)}>
            {props.children}
        </div>
    );
