/**
 * @module Chip.card — the design-system card of the Chip: a selected and an unselected filter chip with counts, and
 * two removable input chips, one with a label long enough to wrap.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Selection',
    height: 190,
    platforms: 'both',
    uses: ['Chip'],
    render: ({ Chip }) => (
        <div className="row">
            <Chip kind="filter" label="Vegetarian" selected count={42} onPress={noop} />
            <Chip kind="filter" label="Under 30 minutes" selected={false} count={18} onPress={noop} />
            <Chip kind="input" label="Vegan" removeLabel="Remove Vegan" onRemove={noop} />
            <Chip
                kind="input"
                label="Gluten-free sourdough starter feeding schedule"
                removeLabel="Remove Gluten-free sourdough starter feeding schedule"
                onRemove={noop}
            />
        </div>
    ),
});
