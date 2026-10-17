/**
 * @module Input.card — the design-system card of Input: empty with a placeholder, filled, invalid with its error,
 * and disabled, each under its label, on both platforms.
 */
import { useState } from 'react';

import type { CardUi } from '../../../../src/cards/cardComponents.js';
import { defineCard } from '../../../../src/cards/defineCard.js';

const ERROR = 'Enter at least 1 serving.';

interface FieldProps {
    readonly id: string;
    readonly label: string;
    readonly init: string;
    readonly native: boolean;
    readonly ui: CardUi<'FieldLabel' | 'Input'>;
    readonly placeholder?: string;
    readonly invalid?: boolean;
    readonly disabled?: boolean;
    readonly message?: string;
}

function Field({ id, label, init, native, ui, placeholder, invalid, disabled, message }: FieldProps) {
    const [value, setValue] = useState(init);
    const { FieldLabel, Input } = ui;

    return (
        <div>
            <FieldLabel forId={id} label={label} />
            <Input
                id={id}
                value={value}
                onChangeText={setValue}
                {...(native ? { label } : {})}
                {...(placeholder === undefined ? {} : { placeholder })}
                {...(invalid === true
                    ? { invalid, describedBy: `${id}-err`, ...(native ? { error: message } : {}) }
                    : {})}
                {...(disabled === true ? { disabled } : {})}
            />
            {message === undefined ? null : (
                <p id={`${id}-err`} style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--danger-text)' }}>
                    {message}
                </p>
            )}
        </div>
    );
}

export default defineCard({
    group: 'Forms',
    height: 400,
    platforms: 'both',
    uses: ['FieldLabel', 'Input'],
    render: (ui, { platform }) => {
        const native = platform === 'native';

        return (
            <div style={{ display: 'grid', gap: 16, maxWidth: 340 }}>
                <Field
                    id="i1"
                    label="Recipe title"
                    init=""
                    placeholder="Sunday roast chicken"
                    native={native}
                    ui={ui}
                />
                <Field id="i2" label="Main ingredient" init="Chicken thighs" native={native} ui={ui} />
                <Field id="i3" label="Servings" init="0" invalid message={ERROR} native={native} ui={ui} />
                <Field id="i4" label="Source (locked)" init="Grandma's cookbook" disabled native={native} ui={ui} />
            </div>
        );
    },
});
