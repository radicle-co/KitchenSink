/**
 * @module RouteAction.card — the design-system card of RouteAction: the same pill styled as a link (with an href)
 * and as a button (without one).
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const PILL_CSS =
    '.a{display:inline-flex;align-items:center;gap:8px;font:600 14px Inter,system-ui;padding:10px 16px;border-radius:9999px;border:1px solid var(--line-control);background:var(--paper);color:var(--ink);text-decoration:none;cursor:pointer}';

export default defineCard({
    group: 'Navigation',
    height: 110,
    platforms: 'web',
    reason: 'native has no URLs to link to, so its controls are plain presses.',
    uses: ['RouteAction'],
    render: ({ RouteAction }, { stack }) => (
        <div className={stack} style={{ gap: 16 }}>
            <style>{PILL_CSS}</style>
            <RouteAction label="Open Weeknight pad thai" href="#recipe-pad-thai" onPress={noop} className="a">
                Weeknight pad thai (link)
            </RouteAction>
            <RouteAction label="Back to collections" onPress={noop} className="a">
                Back to collections (button)
            </RouteAction>
        </div>
    ),
});
