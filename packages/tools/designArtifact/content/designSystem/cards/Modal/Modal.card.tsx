/**
 * @module Modal.card — the design-system card of Modal: one open, transparent modal holding a discard prompt,
 * shown in a framed stage. Native only.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Overlays',
    height: 550,
    platforms: 'native',
    reason: 'React Native’s Modal opens a window of its own; this adapter opens every orientation and makes Android Back close the keyboard first.',
    staging: { portalIntoColumn: { frameHeight: 400 } },
    uses: ['Modal'],
    render: ({ Modal }) => (
        <Modal visible transparent animationType="none" onRequestClose={noop}>
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,.4)',
                }}
            >
                <div
                    style={{
                        width: 300,
                        background: 'var(--paper)',
                        border: '1px solid var(--line)',
                        borderRadius: 12,
                        padding: 12,
                        boxShadow: '0 8px 24px rgba(0,0,0,.25)',
                    }}
                >
                    <strong>Discard changes?</strong>
                    <p style={{ margin: '8px 0 0' }}>Your edits to Lemon tart are not saved.</p>
                </div>
            </div>
        </Modal>
    ),
});
