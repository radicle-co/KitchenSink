/**
 * @module PendingBar.card — the design-system card of the PendingBar: the bar over a result card while a search is
 * in flight and earlier results stay usable, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

export default defineCard({
    group: 'Feedback',
    height: 230,
    platforms: 'both',
    uses: ['PendingBar'],
    render: ({ PendingBar }) => (
        <div style={{ display: 'grid', gap: 24 }}>
            <div className="muted">Searching "lemon tart" — earlier results stay usable</div>
            <div style={{ position: 'relative' }}>
                <PendingBar pending />
                <div
                    style={{
                        background: 'var(--paper)',
                        border: '1px solid var(--line)',
                        borderRadius: 12,
                        padding: 12,
                    }}
                >
                    Lemon curd tart
                </div>
            </div>
        </div>
    ),
});
