/**
 * @module SearchField.card — the design-system card of the SearchField: empty with a visible label and a hint, filled,
 * and empty with a hidden label, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Forms',
    height: 330,
    platforms: 'both',
    uses: ['SearchField'],
    render: ({ SearchField }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420 }}>
            <SearchField
                clearLabel="Clear search"
                onChangeText={noop}
                id="s1"
                label="Search recipes"
                labelVisibility="visible"
                value=""
                placeholder="Try “weeknight pasta”"
            />
            <SearchField
                clearLabel="Clear search"
                onChangeText={noop}
                id="s2"
                label="Search ingredients"
                labelVisibility="visible"
                value="cherry tomatoes"
            />
            <SearchField
                clearLabel="Clear search"
                onChangeText={noop}
                id="s3"
                label="Search collections"
                labelVisibility="hidden"
                value=""
                placeholder="Search collections"
            />
        </div>
    ),
});
