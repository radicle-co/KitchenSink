/**
 * @module TextArea.card — the design-system card of TextArea: empty with a placeholder and three minimum rows,
 * filled and capped at four rows, and invalid with its error, on both platforms.
 */
import { useState } from 'react';

import type { CardUi } from '../../../../src/cards/cardComponents.js';
import { defineCard } from '../../../../src/cards/defineCard.js';

const NOTES = [
    'Roast at 200C for 45 minutes.',
    'Rest 10 minutes before carving.',
    'Save the juices for gravy.',
    'Taste and adjust the salt.',
    'Serve with roast potatoes.',
].join('\n');

interface FieldProps {
    readonly id: string;
    readonly label: string;
    readonly init: string;
    readonly native: boolean;
    readonly ui: CardUi<'FieldLabel' | 'TextArea'>;
    readonly minRows: number;
    readonly maxRows?: number;
    readonly placeholder?: string;
    readonly message?: string;
}

function Field({ id, label, init, native, ui, minRows, maxRows, placeholder, message }: FieldProps) {
    const [value, setValue] = useState(init);
    const { FieldLabel, TextArea } = ui;

    return (
        <div>
            <FieldLabel forId={id} label={label} />
            <TextArea
                id={id}
                value={value}
                onChangeText={setValue}
                minRows={minRows}
                {...(native ? { label } : {})}
                {...(maxRows === undefined ? {} : { maxRows })}
                {...(placeholder === undefined ? {} : { placeholder })}
                {...(message === undefined
                    ? {}
                    : { invalid: true, describedBy: `${id}-err`, ...(native ? { error: message } : {}) })}
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
    height: 490,
    platforms: 'both',
    uses: ['FieldLabel', 'TextArea'],
    render: (ui, { platform }) => {
        const native = platform === 'native';

        return (
            <div style={{ display: 'grid', gap: 16, maxWidth: 340 }}>
                <Field
                    id="t1"
                    label="Method"
                    init=""
                    minRows={3}
                    placeholder="Salt the chicken and rest it for an hour."
                    native={native}
                    ui={ui}
                />
                <Field id="t2" label="Notes" init={NOTES} minRows={2} maxRows={4} native={native} ui={ui} />
                <Field
                    id="t3"
                    label="Description"
                    init=""
                    minRows={2}
                    message="Add a short description."
                    native={native}
                    ui={ui}
                />
            </div>
        );
    },
});
