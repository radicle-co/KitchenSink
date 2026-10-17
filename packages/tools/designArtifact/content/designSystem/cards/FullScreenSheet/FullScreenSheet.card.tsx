/**
 * @module FullScreenSheet.card — the design-system card of the FullScreenSheet, open in the native column's stage.
 * Native only.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Overlays',
    height: 570,
    platforms: 'native',
    reason: 'a full-screen React Native Modal sheet that adds the device insets; web uses Sheet.',
    uses: ['FullScreenSheet', 'Button'],
    staging: { portalIntoColumn: { frameHeight: 440 } },
    render: ({ FullScreenSheet, Button }) => (
        <FullScreenSheet label="Pull updates from source collection" onRequestClose={noop}>
            <h2 style={{ margin: 0, font: '700 22px Inter, system-ui', color: 'var(--ink)' }}>
                Pull updates from source collection
            </h2>
            <p style={{ margin: 0, font: '16px/1.4 Inter, system-ui', color: 'var(--ink)' }}>
                3 recipes changed in Sunday dinners. Review them, then pull the ones you want into your copy.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 'auto' }}>
                <Button variant="secondary" icon="x">
                    Cancel
                </Button>
                <Button variant="primary" icon="check">
                    Pull 3 updates
                </Button>
            </div>
        </FullScreenSheet>
    ),
});
