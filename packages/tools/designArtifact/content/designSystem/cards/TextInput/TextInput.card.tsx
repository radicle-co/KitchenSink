/**
 * @module TextInput.card — the design-system card of the TextInput: a filled single line, a multiline note with a
 * hint, and a disabled field. Native only.
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';
import type { CardUi } from '../../../../src/cards/cardComponents.js';

const noop = (): void => undefined;
const field = {
    borderWidth: 1,
    borderColor: 'var(--line-control)',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    backgroundColor: 'var(--paper)',
    color: 'var(--ink)',
    fontSize: 16,
} as const;

function Fields({ FieldLabel, TextInput }: CardUi<'FieldLabel' | 'TextInput'>) {
    const [title, setTitle] = useState('Sunday roast chicken');
    const [notes, setNotes] = useState('');

    return (
        <div className="col" style={{ gap: 14 }}>
            <FieldLabel forId="ti1" label="Recipe title" />
            <TextInput
                nativeID="ti1"
                value={title}
                onChangeText={setTitle}
                placeholder="Sunday roast chicken"
                style={field}
                placeholderTextColor="var(--ink-muted)"
            />
            <FieldLabel forId="ti2" label="Notes" hint="Anything to remember next time" />
            <TextInput
                nativeID="ti2"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                placeholder="Brine overnight for juicier meat"
                style={{ ...field, minHeight: 96, paddingVertical: 12, textAlignVertical: 'top' }}
                placeholderTextColor="var(--ink-muted)"
            />
            <FieldLabel forId="ti3" label="Oven temperature" />
            <TextInput
                nativeID="ti3"
                value="200"
                editable={false}
                onChangeText={noop}
                inputMode="numeric"
                style={{ ...field, opacity: 0.5 }}
            />
        </div>
    );
}

export default defineCard({
    group: 'Forms',
    height: 470,
    platforms: 'native',
    reason: 'it is the one React Native TextInput the apps render, fixing Android’s full-screen editor off; the web uses Input and TextArea.',
    uses: ['TextInput', 'FieldLabel'],
    render: ({ TextInput, FieldLabel }) => <Fields TextInput={TextInput} FieldLabel={FieldLabel} />,
});
