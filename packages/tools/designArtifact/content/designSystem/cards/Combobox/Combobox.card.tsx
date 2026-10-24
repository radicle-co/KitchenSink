/**
 * @module Combobox.card — the design-system card of Combobox: open on focus with a group of catalog matches, a
 * detail line, a busy option, a count announcement, a hint and a trailing note, on both platforms.
 */
import { useState } from 'react';

import type { ComboboxGroup } from '@commise/ui/combobox';

import { defineCard } from '../../../../src/cards/defineCard.js';
import { waitFor } from '../../../../src/cards/waitFor.js';
import type { CardUi } from '../../../../src/cards/cardComponents.js';

const noop = (): void => undefined;

const GROUPS: readonly ComboboxGroup[] = [
    {
        key: 'c',
        label: 'Catalog',
        options: [
            { key: '1', label: 'Tomato, raw', detailParts: ['Red', 'Ripe'] },
            { key: '2', label: 'Tomato paste' },
            { key: '3', label: 'Tomatillo', busy: true },
        ],
    },
];

function FoodCombobox({ Combobox }: CardUi<'Combobox'>) {
    const [value, setValue] = useState('tom');

    return (
        <div style={{ maxWidth: 360 }}>
            <Combobox
                id="food"
                label="Ingredient"
                listLabel="Matching foods"
                value={value}
                onValueChange={setValue}
                placeholder="Search foods"
                openOnFocus
                focusRequested
                onFocusRequestHandled={noop}
                countAnnouncement="3 foods"
                hint="Pick from the list."
                groups={GROUPS}
                trailingStatus={[{ kind: 'note', text: 'Showing catalog foods only.' }]}
                onSelect={noop}
            />
        </div>
    );
}

export default defineCard({
    group: 'Forms',
    height: 520,
    platforms: 'both',
    uses: ['Combobox'],
    render: ({ Combobox }) => <FoodCombobox Combobox={Combobox} />,
    afterRender: async ({ native }) => {
        const input = await waitFor(() => native?.querySelector('input'), { description: 'the native input' });

        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        await waitFor(() => native?.querySelector('input[aria-expanded="true"]'), {
            description: 'the native list of matches to open',
        });
    },
});
