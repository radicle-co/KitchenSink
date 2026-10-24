/**
 * @module BackToTop.card — the design-system card of BackToTop: inside a scroll host, scrolled far down and then a
 * little back up, which is what reveals it.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';
import { nextFrame, waitFor } from '../../../../src/cards/waitFor.js';

const noop = (): void => undefined;

export default defineCard({
    group: 'Navigation',
    height: 200,
    platforms: 'web',
    staging: { scrollsDocument: true },
    reason: 'this is the web design-system leaf only (the source declares no .native.tsx).',
    uses: ['BackToTop', 'ScrollHost'],
    render: ({ BackToTop, ScrollHost }) => (
        <ScrollHost>
            <div>
                <p className="muted">Back to top appears after a long scroll, once the reader scrolls up.</p>
                <div style={{ height: 2500 }} />
                <BackToTop label="Back to top" onReturn={noop} />
            </div>
        </ScrollHost>
    ),
    afterRender: async ({ web }) => {
        // Down, then back up a little: the page reports each move on a frame, and "scrolling up" is the reveal.
        for (const top of [2200, 2150, 2100]) {
            window.scrollTo(0, top);
            await waitFor(() => Math.abs(window.scrollY - top) < 1, {
                description: `the page to reach ${String(top)}`,
            });
            await nextFrame();
            await nextFrame();
        }

        await waitFor(() => web?.querySelector('button'), { description: 'the Back to top button' });
    },
});
