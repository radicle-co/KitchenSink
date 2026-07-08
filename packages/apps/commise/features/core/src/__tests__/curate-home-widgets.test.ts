import { describe, it, expect } from 'vitest';

import type { HomeWidgetCurationContext, HomeWidgetDescriptor } from '../contract.js';
import { curateHomeWidgets } from '../curate-home-widgets.js';

/**
 * A no-op loader seam; the descriptor's data fields carry the meaningful
 * curation constraints, so every fixture shares the same inert loader.
 */
const noopLoad = (): Promise<{ default: unknown }> => Promise.resolve({ default: null });

const makeWidget = (
    overrides: Partial<HomeWidgetDescriptor> & Pick<HomeWidgetDescriptor, 'id'>,
): HomeWidgetDescriptor => ({
    load: noopLoad,
    defaultWeight: 0,
    ...overrides,
});

const ids = (widgets: readonly HomeWidgetDescriptor[]): string[] => widgets.map((widget) => widget.id);

describe('curateHomeWidgets', () => {
    describe('hidden gating', () => {
        it('drops widgets whose id is in the viewer hidden list', () => {
            const widgets = [makeWidget({ id: 'recipes' }), makeWidget({ id: 'meal-plan' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], hidden: ['meal-plan'] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['recipes']);
        });

        it('keeps every widget when the hidden list is absent', () => {
            const widgets = [makeWidget({ id: 'a' }), makeWidget({ id: 'b' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['a', 'b']);
        });
    });

    describe('capability gating', () => {
        it('drops a widget whose capability is not in liveCapabilities', () => {
            const widgets = [makeWidget({ id: 'gated', capability: 'meal-planning' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: ['recipes'] };

            expect(curateHomeWidgets(widgets, ctx)).toEqual([]);
        });

        it('keeps a widget whose capability is present in liveCapabilities', () => {
            const widgets = [makeWidget({ id: 'gated', capability: 'meal-planning' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: ['meal-planning'] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['gated']);
        });

        it('keeps a widget that declares no capability regardless of liveCapabilities', () => {
            const widgets = [makeWidget({ id: 'always' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['always']);
        });
    });

    describe('tier gating', () => {
        it('drops a widget whose minTier ranks above the viewer tier', () => {
            const widgets = [makeWidget({ id: 'pro-only', minTier: 'pro' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], tier: 'free' };

            expect(curateHomeWidgets(widgets, ctx)).toEqual([]);
        });

        it('keeps a widget whose minTier equals the viewer tier', () => {
            const widgets = [makeWidget({ id: 'pro-only', minTier: 'pro' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], tier: 'pro' };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['pro-only']);
        });

        it('keeps a widget whose minTier ranks below the viewer tier', () => {
            const widgets = [makeWidget({ id: 'free-ok', minTier: 'free' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], tier: 'pro' };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['free-ok']);
        });

        it('treats an absent viewer tier as the default (rank 0) tier', () => {
            const widgets = [
                makeWidget({ id: 'free-ok', minTier: 'free' }),
                makeWidget({ id: 'pro-only', minTier: 'pro' }),
            ];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [] };

            // Default tier meets 'free' (rank 0) but not 'pro' (rank 1).
            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['free-ok']);
        });

        it('keeps a widget with no minTier for any viewer tier', () => {
            const widgets = [makeWidget({ id: 'ungated' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], tier: 'free' };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['ungated']);
        });
    });

    describe('fail-closed on unrecognized tiers', () => {
        it('drops a widget whose minTier is not a recognized tier', () => {
            const widgets = [makeWidget({ id: 'mystery', minTier: 'platinum' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], tier: 'pro' };

            expect(curateHomeWidgets(widgets, ctx)).toEqual([]);
        });

        it('drops a tier-gated widget when the viewer tier is unrecognized (ranks below every requirement)', () => {
            const widgets = [makeWidget({ id: 'pro-only', minTier: 'pro' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], tier: 'enterprise' };

            expect(curateHomeWidgets(widgets, ctx)).toEqual([]);
        });

        it('still keeps a no-minTier widget for an unrecognized viewer tier', () => {
            const widgets = [makeWidget({ id: 'ungated' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], tier: 'enterprise' };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['ungated']);
        });
    });

    describe('ordering', () => {
        it('orders un-ranked survivors by descending defaultWeight', () => {
            const widgets = [
                makeWidget({ id: 'low', defaultWeight: 1 }),
                makeWidget({ id: 'high', defaultWeight: 10 }),
                makeWidget({ id: 'mid', defaultWeight: 5 }),
            ];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['high', 'mid', 'low']);
        });

        it('places widgets named in the viewer order first, in that order, ahead of un-ranked ones', () => {
            const widgets = [
                makeWidget({ id: 'a', defaultWeight: 100 }),
                makeWidget({ id: 'b', defaultWeight: 1 }),
                makeWidget({ id: 'c', defaultWeight: 50 }),
            ];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], order: ['b', 'a'] };

            // 'b' then 'a' come first (viewer order); 'c' (un-ranked) trails despite its weight.
            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['b', 'a', 'c']);
        });

        it('breaks ties among un-ranked widgets by descending defaultWeight after the ordered ones', () => {
            const widgets = [
                makeWidget({ id: 'ordered', defaultWeight: 0 }),
                makeWidget({ id: 'weak', defaultWeight: 2 }),
                makeWidget({ id: 'strong', defaultWeight: 9 }),
            ];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], order: ['ordered'] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['ordered', 'strong', 'weak']);
        });
    });

    describe('purity', () => {
        it('does not mutate the input widgets array or its elements', () => {
            const widgets = [makeWidget({ id: 'a', defaultWeight: 1 }), makeWidget({ id: 'b', defaultWeight: 9 })];
            const snapshot = widgets.map((widget) => ({ ...widget }));

            const result = curateHomeWidgets(widgets, { liveCapabilities: [] });

            // A new array is returned, and the original order/contents are untouched.
            expect(result).not.toBe(widgets);
            expect(ids(widgets)).toEqual(['a', 'b']);
            widgets.forEach((widget, index) => {
                expect(widget).toEqual(snapshot[index]);
            });
        });

        it('does not mutate the curation context arrays', () => {
            const order = ['b'];
            const hidden = ['c'];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: ['x'], order, hidden };

            curateHomeWidgets([makeWidget({ id: 'a' }), makeWidget({ id: 'b' })], ctx);

            expect(order).toEqual(['b']);
            expect(hidden).toEqual(['c']);
            expect(ctx.liveCapabilities).toEqual(['x']);
        });
    });

    it('applies hidden, capability, and tier gates together', () => {
        const widgets = [
            makeWidget({ id: 'recipes', defaultWeight: 10 }),
            makeWidget({ id: 'hidden-one', defaultWeight: 8 }),
            makeWidget({ id: 'no-cap', capability: 'meal-planning', defaultWeight: 6 }),
            makeWidget({ id: 'too-pro', minTier: 'pro', defaultWeight: 4 }),
            makeWidget({ id: 'ok-gated', capability: 'shopping', minTier: 'free', defaultWeight: 2 }),
        ];
        const ctx: HomeWidgetCurationContext = {
            liveCapabilities: ['shopping'],
            tier: 'free',
            hidden: ['hidden-one'],
        };

        expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['recipes', 'ok-gated']);
    });
});
