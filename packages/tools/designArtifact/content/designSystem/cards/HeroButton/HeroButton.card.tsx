/**
 * @module HeroButton.card — the design-system card of HeroButton: a back control, a closed and an open menu
 * trigger, and a disabled control, over a photo, on both platforms.
 *
 * The native HeroButton takes `ref` as a plain prop (the web one does not), so the native column is drawn by
 * `renderNative`: its back control hands a callback ref in, and the card fails if the node never arrives. That makes
 * this card the run-time proof that the bundle keeps `ref` alive under the React 18 the host ships.
 */
import type { NativeCardUi } from '../../../../src/cards/cardComponents.js';
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;
const PHOTO = 'linear-gradient(135deg,#c98b4b,#7a4a24 60%,#3e2a1a)';

/** The node the native back control handed to its `ref`; `null` until React attaches it. */
let backControl: unknown = null;

export default defineCard({
    group: 'Actions',
    height: 150,
    platforms: 'both',
    uses: ['HeroButton'],
    render: ({ HeroButton }) => (
        <div className="row" style={{ gap: 16, padding: 20, borderRadius: 12, background: PHOTO }}>
            <HeroButton icon="chevronLeft" label="Back to Sunday roasts" onPress={noop} />
            <HeroButton icon="ellipsis" label="More actions for Roast chicken" expanded={false} onPress={noop} />
            <HeroButton icon="ellipsis" label="More actions for Roast chicken" expanded onPress={noop} />
            <HeroButton icon="ellipsis" label="More actions (unavailable)" disabled onPress={noop} />
        </div>
    ),
    renderNative: ({ HeroButton }: NativeCardUi<'HeroButton'>) => (
        <div className="row" style={{ gap: 16, padding: 20, borderRadius: 12, background: PHOTO }}>
            <HeroButton
                icon="chevronLeft"
                label="Back to Sunday roasts"
                onPress={noop}
                ref={(node: unknown) => {
                    backControl = node;
                }}
            />
            <HeroButton icon="ellipsis" label="More actions for Roast chicken" expanded={false} onPress={noop} />
            <HeroButton icon="ellipsis" label="More actions for Roast chicken" expanded onPress={noop} />
            <HeroButton icon="ellipsis" label="More actions (unavailable)" disabled onPress={noop} />
        </div>
    ),
    afterRender: () => {
        if (backControl === null) {
            return Promise.reject(new Error('The native HeroButton never received its ref.'));
        }

        return Promise.resolve();
    },
});
