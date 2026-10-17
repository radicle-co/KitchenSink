/**
 * @module FabFace.card — the design-system card of FabFace: the extended face (icon and label) and the icon-only
 * face with the label hidden, each on the action-coloured pill the button supplies, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const pillRules =
    '.fabPill{display:inline-flex;align-items:center;background:var(--action);color:var(--on-action);border-radius:9999px;position:relative}' +
    '.fabExt{height:56px;gap:8px;padding:0 24px 0 16px}.fabIco{width:56px;height:56px;justify-content:center}';

const noop = (): void => undefined;

export default defineCard({
    group: 'Actions',
    height: 140,
    platforms: 'both',
    uses: ['FabFace'],
    render: ({ FabFace }) => {
        const face = (caption: string, presentation: 'extended' | 'icon', className: string) => (
            <div>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 4px' }}>{caption}</p>
                <span className={`fabPill ${className}`}>
                    <FabFace label="New recipe" icon="plus" presentation={presentation} onLabelWidth={noop} />
                </span>
            </div>
        );

        return (
            <div className="row">
                <style>{pillRules}</style>
                {face('extended', 'extended', 'fabExt')}
                {face('icon (label hidden)', 'icon', 'fabIco')}
            </div>
        );
    },
});
