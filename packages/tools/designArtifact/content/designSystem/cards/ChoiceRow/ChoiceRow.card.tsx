/**
 * @module ChoiceRow.card — the design-system card of the ChoiceRow: a list of foods for one ingredient line with its
 * quiet keep row, and the four states a row can be in: open, chosen, busy (its send in flight) and refused (a sibling's
 * send in flight).
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';
import type { CardUi } from '../../../../src/cards/cardComponents.js';

const foods = [
    { id: 'whole', label: 'Whole milk', tag: 'Default' },
    { id: 'twoPercent', label: 'Milk, 2% fat' },
    { id: 'skim', label: 'Skim milk' },
] as const;

const list = {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--line-divider)',
    borderRadius: 12,
    overflow: 'hidden',
} as const;

function Choices({ ChoiceRow, OptionLabel }: CardUi<'ChoiceRow' | 'OptionLabel'>) {
    const [chosen, setChosen] = useState<string>('whole');

    return (
        <div style={list}>
            {foods.map((food) => (
                <ChoiceRow
                    key={food.id}
                    accessibilityLabel={`${food.label}${'tag' in food ? `, ${food.tag}` : ''}${chosen === food.id ? ', chosen' : ''}`}
                    chosen={chosen === food.id}
                    busy={false}
                    refused={false}
                    onPress={() => setChosen(food.id)}
                >
                    <OptionLabel label={food.label} textSize="list" {...('tag' in food ? { tag: food.tag } : {})} />
                </ChoiceRow>
            ))}
            <ChoiceRow
                accessibilityLabel={`Keep "2 cups milk" as written${chosen === 'keep' ? ', chosen' : ''}`}
                chosen={chosen === 'keep'}
                busy={false}
                refused={false}
                onPress={() => setChosen('keep')}
            >
                <span style={{ font: '400 14px/20px var(--font-body)', color: 'var(--ink-muted)' }}>
                    Keep “2 cups milk” as written · no nutrition
                </span>
            </ChoiceRow>
        </div>
    );
}

const noop = (): void => undefined;

const states = [
    { name: 'Open', chosen: false, busy: false, refused: false },
    { name: 'Chosen', chosen: true, busy: false, refused: false },
    { name: 'Busy', chosen: false, busy: true, refused: false },
    { name: 'Refused', chosen: false, busy: false, refused: true },
] as const;

export default defineCard({
    group: 'Selection',
    height: 560,
    platforms: 'both',
    uses: ['ChoiceRow', 'OptionLabel'],
    render: ({ ChoiceRow, OptionLabel }, { stack }) => (
        <div className={stack} style={{ gap: 24 }}>
            <Choices ChoiceRow={ChoiceRow} OptionLabel={OptionLabel} />
            <div style={list}>
                {states.map((state) => (
                    <ChoiceRow
                        key={state.name}
                        accessibilityLabel={`${state.name}${state.chosen ? ', chosen' : ''}`}
                        chosen={state.chosen}
                        busy={state.busy}
                        refused={state.refused}
                        onPress={noop}
                    >
                        <OptionLabel label={state.name} textSize="list" />
                    </ChoiceRow>
                ))}
            </div>
        </div>
    ),
});
