/**
 * @module SegmentedControl.card — the design-system card of the SegmentedControl: the route form (links) and the view
 * form, with its label shown and hidden.
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';
import type { CardUi } from '../../../../src/cards/cardComponents.js';

type Ui = CardUi<'SegmentedControl'>;

function Route({ SegmentedControl }: Ui) {
    const [current, setCurrent] = useState('recipes');

    return (
        <SegmentedControl
            form="route"
            label="Library"
            segments={[
                { id: 'recipes', label: 'My recipes', href: '#recipes' },
                { id: 'collections', label: 'Collections', href: '#collections' },
            ]}
            current={current}
            onSelect={setCurrent}
        />
    );
}

function View({ SegmentedControl, hidden, initial }: Ui & { readonly hidden?: boolean; readonly initial: string }) {
    const [value, setValue] = useState(initial);

    return (
        <SegmentedControl
            form="view"
            label="Recipe layout"
            {...(hidden === true ? { labelVisibility: 'hidden' as const } : {})}
            segments={[
                { id: 'list', label: 'List', icon: 'list' },
                { id: 'grid', label: 'Grid', icon: 'layoutGrid' },
            ]}
            value={value}
            onChange={setValue}
        />
    );
}

export default defineCard({
    group: 'Selection',
    height: 230,
    platforms: 'both',
    uses: ['SegmentedControl'],
    render: ({ SegmentedControl }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 340 }}>
            <Route SegmentedControl={SegmentedControl} />
            <View SegmentedControl={SegmentedControl} initial="grid" />
            <View SegmentedControl={SegmentedControl} hidden initial="list" />
        </div>
    ),
});
