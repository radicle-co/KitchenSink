/**
 * Unit tests for the shared Home navigation model.
 *
 * Requirement map:
 *  - FR-044 (platform parity) — the desktop sidebar, the web mobile tab bar, and the native tab bar are three
 *    renderings of ONE destination list. The model is shared so the platforms cannot drift on which
 *    destinations exist, their order, or which are reachable.
 *  - FR-046 / R6 (CR-001) — a destination for an unshipped feature is NOT a dead link to a 404: it is
 *    non-interactive with a "coming soon" affordance. Reachability derives from the SAME `liveCapabilities`
 *    that gates the widget placeholders, so the nav and the widget surface can never disagree.
 */
import { describe, expect, it } from 'vitest';

import { ROADMAP_CAPABILITY_VALUES } from '../capabilities.js';
import { HOME_NAV_ITEMS, isNavItemReachable, resolveHomeNav } from '../homeNavigation.js';
import { ROADMAP_WIDGET_SPECS } from '../roadmapWidgets.js';

describe('HOME_NAV_ITEMS', () => {
    it('lists the six destinations of the mockup, in order', () => {
        expect(HOME_NAV_ITEMS.map((item) => item.id)).toEqual([
            'home',
            'recipes',
            'meal-plan',
            'grocery',
            'nutrition',
            'profile',
        ]);
    });

    it('uses a unique id per destination', () => {
        expect(new Set(HOME_NAV_ITEMS.map((item) => item.id)).size).toBe(HOME_NAV_ITEMS.length);
    });

    it('leaves the always-available destinations (home, recipes, profile) ungated', () => {
        for (const id of ['home', 'recipes', 'profile']) {
            expect(HOME_NAV_ITEMS.find((item) => item.id === id)?.capability).toBeUndefined();
        }
    });

    it('gates meal-plan, grocery and nutrition on a capability', () => {
        for (const id of ['meal-plan', 'grocery', 'nutrition']) {
            expect(HOME_NAV_ITEMS.find((item) => item.id === id)?.capability).toBeTypeOf('string');
        }
    });

    it('draws every gated capability from the shared vocabulary rather than inventing a parallel one', () => {
        // If the nav spelled a capability its own way ('meal-plan' vs the roadmap's 'meal-planning'), both
        // would type-check and Home would ship with the widget lighting up while the nav link stayed dead.
        const vocabulary = new Set<string>(ROADMAP_CAPABILITY_VALUES);

        for (const item of HOME_NAV_ITEMS.filter((candidate) => candidate.capability !== undefined)) {
            expect(vocabulary.has(item.capability as string)).toBe(true);
        }
    });

    it('shares each roadmap WIDGET capability with the nav destination of the same feature', () => {
        // The pairing that makes the two surfaces move together: nutrition and meal-plan each have both a
        // widget placeholder and a nav entry, and they must wait on the identical capability string.
        for (const id of ['nutrition', 'meal-plan']) {
            const navCapability = HOME_NAV_ITEMS.find((item) => item.id === id)?.capability;
            const widgetCapability = ROADMAP_WIDGET_SPECS.find((spec) => spec.id === id)?.capability;

            expect(navCapability).toBe(widgetCapability);
        }
    });
});

describe('isNavItemReachable', () => {
    it('is true for an ungated destination regardless of live capabilities', () => {
        expect(isNavItemReachable({ id: 'recipes' }, [])).toBe(true);
    });

    it('is false for a gated destination whose capability is not live', () => {
        expect(isNavItemReachable({ id: 'nutrition', capability: 'nutrition' }, ['recipes'])).toBe(false);
    });

    it('is true for a gated destination once its capability is live', () => {
        expect(isNavItemReachable({ id: 'nutrition', capability: 'nutrition' }, ['nutrition'])).toBe(true);
    });
});

describe('resolveHomeNav', () => {
    it('resolves every destination, marking the unshipped ones unreachable', () => {
        const resolved = resolveHomeNav(['recipes']);

        expect(resolved.map((item) => [item.id, item.reachable])).toEqual([
            ['home', true],
            ['recipes', true],
            ['meal-plan', false],
            ['grocery', false],
            ['nutrition', false],
            ['profile', true],
        ]);
    });

    it('flips a destination to reachable the moment its capability goes live — no nav edit needed', () => {
        const resolved = resolveHomeNav(['recipes', 'meal-planning']);

        expect(resolved.find((item) => item.id === 'meal-plan')?.reachable).toBe(true);
        expect(resolved.find((item) => item.id === 'grocery')?.reachable).toBe(false);
    });

    it('never drops a destination — an unreachable one is shown as coming soon, not hidden', () => {
        expect(resolveHomeNav([])).toHaveLength(HOME_NAV_ITEMS.length);
    });

    it('does not mutate the shared nav model', () => {
        const before = HOME_NAV_ITEMS.map((item) => ({ ...item }));

        resolveHomeNav(['recipes']);

        expect(HOME_NAV_ITEMS.map((item) => ({ ...item }))).toEqual(before);
    });
});
