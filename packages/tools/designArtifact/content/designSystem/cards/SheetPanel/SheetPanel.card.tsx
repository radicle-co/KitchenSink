/**
 * @module SheetPanel.card — the design-system card of SheetPanel: the skeleton inside the web Sheet (title row,
 * toolbar, scroll region, footer), shown through an open Sheet in a framed stage. Web only.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Overlays',
    height: 500,
    platforms: 'web',
    reason: 'the native sheet builds this skeleton in BottomSheetPanel and FullScreenSheet, so SheetPanel (a Radix Dialog child) is web only.',
    staging: { portalIntoColumn: { frameHeight: 440 } },
    uses: ['Input', 'Sheet', 'SheetPanel'],
    render: ({ Input, Sheet }) => (
        <Sheet
            open
            onOpenChange={noop}
            title="Add ingredient"
            closeLabel="Close add ingredient"
            size="content"
            toolbar={{
                heading: <h3 style={{ margin: 0, font: '600 15px Inter' }}>Pantry staples</h3>,
                controls: <Input id="sp-q" value="" onChangeText={noop} placeholder="Search ingredients" />,
            }}
            footer={
                <button
                    type="button"
                    style={{
                        minHeight: 44,
                        padding: '0 16px',
                        borderRadius: 12,
                        border: 0,
                        background: 'var(--action)',
                        color: 'var(--on-action)',
                        font: '600 15px Inter',
                    }}
                >
                    Add to recipe
                </button>
            }
        >
            <div style={{ padding: '8px 24px 16px', color: 'var(--ink)' }}>
                <p style={{ margin: '0 0 8px' }}>2 cups all-purpose flour</p>
                <p style={{ margin: 0, color: 'var(--ink-muted)' }}>Sifted, then measured.</p>
            </div>
        </Sheet>
    ),
});
