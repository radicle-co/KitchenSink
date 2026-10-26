/**
 * @module @commise/ui/radio-list — the web design-system {@link RadioList}.
 *
 * A Radix `RadioGroup`: Tab enters the group once, the arrow keys move between rows and check the row they land on
 * (the WAI-ARIA radio group), Space checks the focused row. Each row is a whole-row radio at least 48 px tall: an 18 px
 * circle (a 2 px `lineControl` ring at rest, a 5 px `action` ring when checked) and the label that wraps; the hint under
 * it describes the radio. A visible focus ring on the row.
 *
 * Controlled with no default: `value` `undefined` is held as Radix's controlled empty value, so a click reports to
 * `onChange` and checks nothing until the host passes the new value back.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Adapter over `@radix-ui/react-radio-group` — the house option list on the library's radio group, which owns
 *     the roving focus and the keyboard
 */
import * as RadioGroup from '@radix-ui/react-radio-group';
import { useId, type FC } from 'react';

import type { RadioListLook, RadioListProps } from './props.js';

/** Each look's group and row chrome. Only the look differs, never the semantics. */
const LOOK: Readonly<Record<RadioListLook, { readonly group: string; readonly row: string; readonly label: string }>> =
    {
        rows: {
            group: 'flex flex-col divide-y divide-line-divider rounded-lg border border-line-divider bg-paper-raised',
            row: 'rounded-lg px-3 py-2',
            label: 'text-meta text-ink',
        },
        cards: {
            group: 'flex flex-col gap-3',
            row: 'rounded-lg border border-line-divider bg-paper px-4 py-3',
            label: 'text-body font-semibold text-ink',
        },
    };

/** The web design-system option list. */
export const RadioList: FC<RadioListProps> = ({ label, options, value, onChange, look }) => {
    const baseId = useId();
    const chrome = LOOK[look];

    return (
        <RadioGroup.Root
            aria-label={label}
            orientation="vertical"
            // Radix treats `undefined` as UNCONTROLLED and would check a clicked row by itself; '' matches no row.
            value={value ?? ''}
            onValueChange={onChange}
            className={chrome.group}
        >
            {options.map((option, index) => {
                const labelId = `${baseId}-${index}-label`;
                const hintId = `${baseId}-${index}-hint`;
                const checked = option.id === value;

                return (
                    <RadioGroup.Item
                        key={option.id}
                        value={option.id}
                        aria-labelledby={labelId}
                        {...(option.hint === undefined ? {} : { 'aria-describedby': hintId })}
                        className={`flex min-h-12 w-full items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${chrome.row}`}
                    >
                        <span
                            aria-hidden="true"
                            className={`size-4.5 shrink-0 self-start rounded-full mt-0.5 ${
                                checked ? 'border-[5px] border-action' : 'border-2 border-line-control'
                            }`}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span id={labelId} className={`break-words ${chrome.label}`}>
                                {option.label}
                            </span>
                            {option.hint === undefined ? null : (
                                <span id={hintId} className="break-words text-meta text-ink-muted">
                                    {option.hint}
                                </span>
                            )}
                        </span>
                    </RadioGroup.Item>
                );
            })}
        </RadioGroup.Root>
    );
};
