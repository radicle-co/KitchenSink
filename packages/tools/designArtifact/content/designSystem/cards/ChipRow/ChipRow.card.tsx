/**
 * @module ChipRow.card — the design-system card of the ChipRow: a choice row (clearable, wrapping), a choice row with more
 * options than one line holds (wrapping), a filter row (scrolling, with counts) and an input row (removable chips), on
 * both platforms.
 */
import { useState } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

/** More choices than one line holds, so the row has to wrap. */
const BROWSE = ['Trending', 'New', 'Quick', 'Italian', 'Indian', 'Mexican', 'Thai', 'Japanese', 'Greek', 'American'];

export default defineCard({
    group: 'Selection',
    height: 400,
    platforms: 'both',
    uses: ['ChipRow', 'Chip'],
    render: ({ ChipRow, Chip }) => {
        function Rows() {
            const [difficulty, setDifficulty] = useState<string | null>('easy');

            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <ChipRow
                        mode="choice"
                        label="Difficulty"
                        overflow="wrap"
                        clearable
                        value={difficulty}
                        onChange={setDifficulty}
                        options={[
                            { value: 'easy', label: 'Easy' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'hard', label: 'Hard' },
                        ]}
                    />
                    <ChipRow
                        mode="choice"
                        label="Browse recipes"
                        overflow="wrap"
                        value="trending"
                        onChange={noop}
                        options={BROWSE.map((label) => ({ value: label.toLowerCase(), label }))}
                    />
                    <ChipRow mode="filter" label="Cuisine" overflow="scroll">
                        <Chip kind="filter" label="Italian" selected count={24} onPress={noop} />
                        <Chip kind="filter" label="Thai" selected={false} count={9} onPress={noop} />
                        <Chip kind="filter" label="Mexican" selected={false} count={15} onPress={noop} />
                        <Chip kind="filter" label="Japanese" selected={false} count={11} onPress={noop} />
                    </ChipRow>
                    <ChipRow mode="input" label="Dietary tags" overflow="wrap">
                        <Chip kind="input" label="Vegan" removeLabel="Remove Vegan" onRemove={noop} />
                        <Chip kind="input" label="Nut-free" removeLabel="Remove Nut-free" onRemove={noop} />
                    </ChipRow>
                </div>
            );
        }

        return <Rows />;
    },
});
