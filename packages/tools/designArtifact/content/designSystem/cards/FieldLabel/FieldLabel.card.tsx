/**
 * @module FieldLabel.card — the design-system card of FieldLabel: a plain label and one with a hint, each over the
 * input it names, on both platforms.
 */
import { useState } from 'react';

import type { CardUi } from '../../../../src/cards/cardComponents.js';
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

function LabelledInputs({ FieldLabel, Input }: CardUi<'FieldLabel' | 'Input'>) {
    const [title, setTitle] = useState('');

    return (
        <div style={{ maxWidth: 320 }}>
            <FieldLabel forId="fl1" label="Recipe title" />
            <Input id="fl1" value={title} onChangeText={setTitle} placeholder="Sunday roast chicken" />
            <div style={{ height: 20 }} />
            <FieldLabel forId="fl2" label="Oven temperature" hint="In degrees Celsius" />
            <Input id="fl2" value="200" onChangeText={noop} describedBy="fl2-hint" inputMode="numeric" />
        </div>
    );
}

export default defineCard({
    group: 'Forms',
    height: 260,
    platforms: 'both',
    uses: ['FieldLabel', 'Input'],
    render: ({ FieldLabel, Input }) => <LabelledInputs FieldLabel={FieldLabel} Input={Input} />,
});
