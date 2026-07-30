import { describe, it, expect } from 'vitest';

import type {
    HomeWidgetCurationContext,
    HomeWidgetDescriptor,
    LiveHomeWidgetDescriptor,
    PlaceholderHomeWidgetDescriptor,
} from '../contract.js';
import { curateHomeWidgets } from '../curateHomeWidgets.js';

/**
 * A no-op loader seam; the descriptor's data fields carry the meaningful
 * curation constraints, so every fixture shares the same inert loader.
 */
const noopLoad = (): Promise<{ default: unknown }> => Promise.resolve({ default: null });

const makeWidget = (
    overrides: Partial<LiveHomeWidgetDescriptor> & Pick<LiveHomeWidgetDescriptor, 'id'>,
): LiveHomeWidgetDescriptor => ({
    load: noopLoad,
    defaultWeight: 0,
    ...overrides,
});

/** A placeholder fixture: `kind` + `capability` are what define the arm, so both are required here. */
const makePlaceholder = (
    overrides: Partial<PlaceholderHomeWidgetDescriptor> & Pick<PlaceholderHomeWidgetDescriptor, 'id' | 'capability'>,
): PlaceholderHomeWidgetDescriptor => ({
    kind: 'placeholder',
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

    describe('placeholder gating (FR-046 / R6 as amended by CR-001)', () => {
        it('KEEPS a placeholder whose capability is NOT live — the feature has not shipped, so it stands in', () => {
            const widgets = [makePlaceholder({ id: 'meal-plan', capability: 'meal-planning' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: ['recipes'] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['meal-plan']);
        });

        it('DROPS a placeholder whose capability IS live — the real widget has taken over', () => {
            const widgets = [makePlaceholder({ id: 'meal-plan', capability: 'meal-planning' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: ['meal-planning'] };

            expect(curateHomeWidgets(widgets, ctx)).toEqual([]);
        });

        it('applies the hidden gate to a placeholder exactly as it does to a live widget', () => {
            const widgets = [makePlaceholder({ id: 'meal-plan', capability: 'meal-planning' })];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: [], hidden: ['meal-plan'] };

            expect(curateHomeWidgets(widgets, ctx)).toEqual([]);
        });

        it('applies the minTier gate to a placeholder exactly as it does to a live widget', () => {
            const widgets = [makePlaceholder({ id: 'pro-soon', capability: 'nutrition', minTier: 'pro' })];

            expect(curateHomeWidgets(widgets, { liveCapabilities: [], tier: 'free' })).toEqual([]);
            expect(ids(curateHomeWidgets(widgets, { liveCapabilities: [], tier: 'pro' }))).toEqual(['pro-soon']);
        });

        it('orders placeholders among live widgets by defaultWeight like any other descriptor', () => {
            const widgets = [
                makeWidget({ id: 'recipes', capability: 'recipes', defaultWeight: 1000 }),
                makePlaceholder({ id: 'nutrition', capability: 'nutrition', defaultWeight: 1400 }),
                makePlaceholder({ id: 'meal-plan', capability: 'meal-planning', defaultWeight: 1200 }),
            ];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: ['recipes'] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['nutrition', 'meal-plan', 'recipes']);
        });

        it('lets the viewer order re-rank a placeholder against live widgets', () => {
            const widgets = [
                makeWidget({ id: 'recipes', capability: 'recipes', defaultWeight: 1000 }),
                makePlaceholder({ id: 'nutrition', capability: 'nutrition', defaultWeight: 1400 }),
            ];
            const ctx: HomeWidgetCurationContext = { liveCapabilities: ['recipes'], order: ['recipes'] };

            expect(ids(curateHomeWidgets(widgets, ctx))).toEqual(['recipes', 'nutrition']);
        });
    });

    describe('placeholder → live self-supersede (the transition pin)', () => {
        // The invariant that lets a roadmap placeholder be registered alongside the real feature's descriptor
        // under the SAME id: the two arms are mutually exclusive on the same capability, so exactly one of
        // them is ever eligible. This is what makes the placeholder safe to leave registered when 005 ships.
        const bothArms = (): readonly HomeWidgetDescriptor[] => [
            makePlaceholder({ id: 'meal-plan', capability: 'meal-planning', defaultWeight: 1200 }),
            makeWidget({ id: 'meal-plan', capability: 'meal-planning', defaultWeight: 1200 }),
        ];

        it('shows ONLY the placeholder while the capability is not live', () => {
            const curated = curateHomeWidgets(bothArms(), { liveCapabilities: [] });

            expect(curated).toHaveLength(1);
            expect(curated[0]?.kind).toBe('placeholder');
        });

        it('shows ONLY the live widget once the capability goes live — no duplicate tile', () => {
            const curated = curateHomeWidgets(bothArms(), { liveCapabilities: ['meal-planning'] });

            expect(curated).toHaveLength(1);
            expect(curated[0]?.kind).toBeUndefined();
        });

        it('never yields both arms for the same id, for either capability state', () => {
            for (const liveCapabilities of [[], ['meal-planning']]) {
                const curated = curateHomeWidgets(bothArms(), { liveCapabilities });

                expect(curated.filter((widget) => widget.id === 'meal-plan')).toHaveLength(1);
            }
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
