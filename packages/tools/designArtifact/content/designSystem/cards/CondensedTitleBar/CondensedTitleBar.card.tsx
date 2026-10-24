/**
 * @module CondensedTitleBar.card — the design-system card of the CondensedTitleBar: the bar at the top of a page (Back
 * only, no surface or title), a short title, and a long title that truncates beside a menu control. The native bar is
 * absolutely placed, so its column seats it in a slot.
 */
import type { ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;
const back = { label: 'Back to Collections', parent: 'Collections', onPress: noop };
const slot = {
    position: 'relative',
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    background: 'var(--paper)',
} as const;

/** The bar is placed over a screen in the apps; on this page it sits in the flow, so the card can show it. */
const BAR_IN_FLOW =
    '[data-condensed]{position:relative!important;display:flex!important;inset:auto!important;border-radius:12px;overflow:hidden}';

export default defineCard({
    group: 'Navigation',
    height: 330,
    platforms: 'both',
    uses: ['CondensedTitleBar', 'Icon'],
    render: ({ CondensedTitleBar, Icon }, { platform }) => {
        const seat = (bar: ReactNode): ReactNode => (platform === 'web' ? bar : <div style={slot}>{bar}</div>);

        return (
            <div style={{ display: 'grid', gap: 12 }}>
                <style>{BAR_IN_FLOW}</style>
                {seat(
                    <CondensedTitleBar title="Weeknight pasta" back={back} surfaceShown={false} titleShown={false} />,
                )}
                {seat(<CondensedTitleBar title="Weeknight pasta" back={back} surfaceShown titleShown />)}
                {seat(
                    <CondensedTitleBar
                        title="Sunday sourdough and other long bakes for the whole family"
                        back={back}
                        menu={
                            <div
                                role="button"
                                aria-label="More actions"
                                style={{
                                    width: 44,
                                    height: 44,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flex: 'none',
                                }}
                            >
                                <Icon name="ellipsis" size={24} tone="ink" />
                            </div>
                        }
                        surfaceShown
                        titleShown
                    />,
                )}
            </div>
        );
    },
});
