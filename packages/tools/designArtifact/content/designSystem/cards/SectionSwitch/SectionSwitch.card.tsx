/**
 * @module SectionSwitch.card — the design-system card of SectionSwitch: a switch alone, and one with a trailing
 * control, each inside a scroll host that supplies the sections, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const SECTIONS = [
    { id: 'ingredients', label: 'Ingredients' },
    { id: 'method', label: 'Method' },
    { id: 'notes', label: 'Notes' },
    { id: 'nutrition', label: 'Nutrition' },
];

const IDS = SECTIONS.map((section) => section.id);

export default defineCard({
    group: 'Navigation',
    height: 260,
    platforms: 'both',
    uses: ['ScrollHost', 'SectionSwitch', 'Chip'],
    render: ({ ScrollHost, SectionSwitch, Chip }, { platform }) => (
        <ScrollHost sections={IDS}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <SectionSwitch label="Recipe sections" sections={SECTIONS} currentId="method" />
                <SectionSwitch
                    label="Recipe sections with control"
                    sections={SECTIONS.slice(0, 3)}
                    currentId="ingredients"
                    trailing={
                        platform === 'web' ? (
                            <button
                                type="button"
                                style={{
                                    font: '600 13px Inter,system-ui',
                                    padding: '6px 12px',
                                    borderRadius: 9999,
                                    border: '1px solid var(--line-control)',
                                    background: 'var(--canvas)',
                                    color: 'var(--ink)',
                                }}
                            >
                                Screen on
                            </button>
                        ) : (
                            <Chip kind="filter" label="Screen on" selected={false} onPress={noop} />
                        )
                    }
                />
            </div>
        </ScrollHost>
    ),
});
