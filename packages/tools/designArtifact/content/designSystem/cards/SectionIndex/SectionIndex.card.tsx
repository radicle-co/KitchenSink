/**
 * @module SectionIndex.card — the design-system card of SectionIndex: the index over a four-section editor
 * (complete, attention, fix, muted), inside the scroll host that tracks the current section, on both platforms at
 * phone width.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const items = [
    { id: 'basics', label: 'Basics', tone: 'complete', spokenStatus: 'Done' },
    { id: 'ingredients', label: 'Ingredients', tone: 'attention', reason: '2 need a match', count: 2 },
    { id: 'method', label: 'Method', tone: 'fix', reason: 'Fix 1 thing', count: 1 },
    { id: 'photos', label: 'Photos & publish', shortLabel: 'Photos', tone: 'muted', reason: 'Optional' },
] as const;

const ids = items.map((item) => item.id);

const sectionBoxStyle = {
    minHeight: 44,
    background: 'var(--paper)',
    border: '1px solid var(--line-divider)',
    borderRadius: 12,
    padding: '12px 16px',
    marginTop: 12,
} as const;

const headingStyle = { margin: 0, font: '600 18px Inter,system-ui' } as const;

export default defineCard({
    group: 'Navigation',
    height: 360,
    platforms: 'both',
    staging: { phoneViewport: true },
    uses: ['ScrollHost', 'SectionIndex'],
    render: ({ ScrollHost, SectionIndex }, { platform }) => {
        const web = platform === 'web';
        const index = (
            <SectionIndex
                label="Recipe sections"
                sheetTitle="Sections"
                sheetCloseLabel="Close sections"
                items={items}
                currentId="ingredients"
                barName="Sections. Current: Ingredients. 3 need attention. 1 of 4 done."
                barSuffix=" · 1 of 4 done"
                barCount="⚠ 3"
            />
        );
        const sections = items.map((item) => (
            <div key={item.id} style={sectionBoxStyle}>
                {web ? (
                    <h2 id={item.id} tabIndex={-1} style={headingStyle}>
                        {item.label}
                    </h2>
                ) : (
                    <h2 style={headingStyle}>{item.label}</h2>
                )}
            </div>
        ));

        return (
            <ScrollHost sections={ids}>
                <div
                    style={
                        web
                            ? { containerType: 'inline-size', containerName: 'main' }
                            : { display: 'flex', flexDirection: 'column' }
                    }
                >
                    {index}
                    {sections}
                </div>
            </ScrollHost>
        );
    },
});
