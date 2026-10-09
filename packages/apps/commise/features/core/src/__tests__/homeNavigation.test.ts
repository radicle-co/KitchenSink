/**
 * Unit tests for the shared Home navigation model.
 *
 * Requirement map:
 *  - FR-044 (platform parity) — the web sidebar, the web tab bar and the native tab bar are three renderings of ONE
 *    destination list, so the platforms cannot drift on which destinations exist or their order.
 *  - Owner ruling (`docs/design/uiOverhaul/ownerDecisions.md`, "Adopted from the joint recommendations"): the tabs are
 *    Home, Recipes and Discover; Meal Plan and Shopping become tabs 4 and 5 when they ship; navigation shows NO
 *    "Soon" item. So an unshipped destination is DROPPED, not rendered as "coming soon" — this REVERSES the CR-001
 *    "never drops" rule these tests used to pin (rewritten for the overhaul's slice 3, not edited to compile).
 *    Reachability still derives from the SAME `liveCapabilities` that gates the widget placeholders, so the nav and
 *    the widget surface move together.
 */
import { describe, expect, it } from 'vitest';

import { ROADMAP_CAPABILITY_VALUES } from '../capabilities.js';
import { HOME_NAV_ITEMS, isNavItemReachable, resolveHomeNav, NAV_ITEM_GLYPH } from '../homeNavigation.js';
import { ROADMAP_WIDGET_SPECS } from '../roadmapWidgets.js';

describe('HOME_NAV_ITEMS', () => {
    it('lists the three tabs, then the two roadmap tabs, in order (buildSpec §3.1)', () => {
        expect(HOME_NAV_ITEMS.map((item) => item.id)).toEqual(['home', 'recipes', 'discover', 'meal-plan', 'grocery']);
    });

    it('uses a unique id per destination', () => {
        expect(new Set(HOME_NAV_ITEMS.map((item) => item.id)).size).toBe(HOME_NAV_ITEMS.length);
    });

    it('leaves the three shipped tabs ungated', () => {
        for (const id of ['home', 'recipes', 'discover']) {
            expect(HOME_NAV_ITEMS.find((item) => item.id === id)?.capability).toBeUndefined();
        }
    });

    it('gates meal-plan on meal planning and grocery on shopping', () => {
        expect(HOME_NAV_ITEMS.find((item) => item.id === 'meal-plan')?.capability).toBe('meal-planning');
        expect(HOME_NAV_ITEMS.find((item) => item.id === 'grocery')?.capability).toBe('shopping');
    });

    it('draws every gated capability from the shared vocabulary rather than inventing a parallel one', () => {
        // If the nav spelled a capability its own way ('meal-plan' vs the roadmap's 'meal-planning'), both
        // would type-check and Home would ship with the widget lighting up while the nav entry stayed hidden.
        const vocabulary = new Set<string>(ROADMAP_CAPABILITY_VALUES);

        for (const item of HOME_NAV_ITEMS.filter((candidate) => candidate.capability !== undefined)) {
            expect(vocabulary.has(item.capability as string)).toBe(true);
        }
    });

    it('shares the meal-plan WIDGET capability with the meal-plan nav destination', () => {
        const navCapability = HOME_NAV_ITEMS.find((item) => item.id === 'meal-plan')?.capability;
        const widgetCapability = ROADMAP_WIDGET_SPECS.find((spec) => spec.id === 'meal-plan')?.capability;

        expect(navCapability).toBe(widgetCapability);
    });

    it('has no profile or nutrition destination: Profile is the avatar and nutrition sits inside Plan', () => {
        const ids: readonly string[] = HOME_NAV_ITEMS.map((item) => item.id);

        expect(ids).not.toContain('profile');
        expect(ids).not.toContain('nutrition');
    });
});

describe('isNavItemReachable', () => {
    it('is true for an ungated destination regardless of live capabilities', () => {
        expect(isNavItemReachable({ id: 'recipes' }, [])).toBe(true);
    });

    it('is false for a gated destination whose capability is not live', () => {
        expect(isNavItemReachable({ id: 'grocery', capability: 'shopping' }, ['recipes'])).toBe(false);
    });

    it('is true for a gated destination once its capability is live', () => {
        expect(isNavItemReachable({ id: 'grocery', capability: 'shopping' }, ['shopping'])).toBe(true);
    });
});

describe('resolveHomeNav', () => {
    it('drops every unshipped destination: navigation shows no "Soon" item (owner ruling)', () => {
        expect(resolveHomeNav(['recipes']).map((item) => item.id)).toEqual(['home', 'recipes', 'discover']);
    });

    it('adds a destination the moment its capability goes live, in declared order — no nav edit needed', () => {
        expect(resolveHomeNav(['recipes', 'shopping']).map((item) => item.id)).toEqual([
            'home',
            'recipes',
            'discover',
            'grocery',
        ]);
        expect(resolveHomeNav(['shopping', 'meal-planning']).map((item) => item.id)).toEqual([
            'home',
            'recipes',
            'discover',
            'meal-plan',
            'grocery',
        ]);
    });

    it('does not mutate the shared nav model', () => {
        const before = HOME_NAV_ITEMS.map((item) => ({ ...item }));

        resolveHomeNav(['recipes']);

        expect(HOME_NAV_ITEMS.map((item) => ({ ...item }))).toEqual(before);
    });
});

/** The meaning each destination draws, ONCE for both apps' chrome (blueprint slice 3's `NAV_ITEM_GLYPH`). */
describe('NAV_ITEM_GLYPH', () => {
    it('gives every destination its glyph', () => {
        expect(NAV_ITEM_GLYPH).toStrictEqual({
            home: 'house',
            recipes: 'bookOpen',
            discover: 'compass',
            'meal-plan': 'calendar',
            grocery: 'shoppingCart',
        });
    });

    it('covers exactly the nav model’s destinations', () => {
        expect(Object.keys(NAV_ITEM_GLYPH).sort()).toStrictEqual(HOME_NAV_ITEMS.map((item) => item.id).sort());
    });
});
