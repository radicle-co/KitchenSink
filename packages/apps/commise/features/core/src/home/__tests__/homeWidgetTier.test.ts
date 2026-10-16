/**
 * The viewer's paid-feature state as a Home-widget tier (plan 2026-10-14-009 D13), once for both apps: it was
 * `toWidgetTier` in both `HomeWidgetSurface` hosts.
 */
import { describe, expect, it } from 'vitest';

import { HOME_WIDGET_TIER_ORDER } from '../../curateHomeWidgets.js';
import { homeWidgetTierOf } from '../homeWidgetTier.js';

describe('homeWidgetTierOf', () => {
    it('lets only a granted viewer reach a pro widget', () => {
        expect(homeWidgetTierOf('granted')).toBe('pro');
    });

    it.each(['upsell', 'hidden', 'loading', 'anything-else', ''])(
        'treats %j as free: a paid widget the viewer cannot use is curated out',
        (paidFeatures) => {
            expect(homeWidgetTierOf(paidFeatures)).toBe('free');
        },
    );

    it('answers tiers the curation ladder knows, so a typo here cannot fail every gate closed', () => {
        expect(HOME_WIDGET_TIER_ORDER).toContain(homeWidgetTierOf('granted'));
        expect(HOME_WIDGET_TIER_ORDER).toContain(homeWidgetTierOf('upsell'));
    });
});
