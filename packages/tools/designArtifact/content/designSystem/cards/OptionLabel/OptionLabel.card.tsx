/**
 * @module OptionLabel.card — the design-system card of the OptionLabel: a plain name, a name with the quiet Default tag,
 * a name with a variant's parts under it, and all three together, at the list size and at the combobox size.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const labels = [
    { label: 'Whole milk' },
    { label: 'Whole milk', tag: 'Default' },
    { label: 'Milk', detailParts: ['2% fat', 'with added vitamin D'] as const },
    { label: 'Milk', tag: 'Default', detailParts: ['whole', '3.25% fat'] as const },
] as const;

export default defineCard({
    group: 'Selection',
    height: 460,
    platforms: 'both',
    uses: ['OptionLabel'],
    render: ({ OptionLabel }, { stack }) => (
        <div className={stack} style={{ gap: 24 }}>
            {(['list', 'bodyMd'] as const).map((textSize) => (
                <div key={textSize} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {labels.map((spec, index) => (
                        <OptionLabel
                            key={`${textSize}${String(index)}`}
                            label={spec.label}
                            textSize={textSize}
                            {...('tag' in spec ? { tag: spec.tag } : {})}
                            {...('detailParts' in spec ? { detailParts: spec.detailParts } : {})}
                        />
                    ))}
                </div>
            ))}
        </div>
    ),
});
