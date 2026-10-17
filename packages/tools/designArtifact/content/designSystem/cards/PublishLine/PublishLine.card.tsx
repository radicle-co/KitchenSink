/**
 * @module PublishLine.card — the design-system card of the editor's publish line: the ready state and the
 * fix-something state with a jump to its section, on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Editor',
    height: 200,
    platforms: 'both',
    uses: ['PublishLine'],
    render: ({ PublishLine }) => (
        <div className="col">
            <PublishLine line={{ kind: 'ready', text: 'Ready to publish.' }} onJump={noop} />
            <PublishLine
                line={{ kind: 'fix', text: 'Fix 2 things to publish', section: 'ingredients' }}
                onJump={noop}
            />
        </div>
    ),
});
