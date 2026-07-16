/**
 * Unit tests for the roadmap widget registry — the temporary scaffolding that declares the Home widgets whose
 * feature packages (005–009) do not exist yet.
 *
 * Requirement map:
 *  - FR-046 / R6 (as amended by CR-001) — an unshipped feature's widget renders as a skeleton placeholder.
 *    A placeholder cannot be colocated with a package that does not exist, so its METADATA (id, capability,
 *    weight) lives here — ONE authoritative representation shared by web and mobile, so the two platforms
 *    cannot drift on which placeholders exist or where they sit.
 *  - FR-044 (platform parity) — the specs are the parity contract: each app binds a platform skeleton to
 *    every spec id, and `Record<RoadmapWidgetId, …>` makes a missing platform skeleton a compile error.
 */
import { describe, expect, it } from 'vitest';

import { RECIPE_WIDGET_DEFAULT_WEIGHT_REFERENCE, ROADMAP_WIDGET_IDS, ROADMAP_WIDGET_SPECS } from '../roadmapWidgets.js';
import { createRoadmapPlaceholders } from '../roadmapWidgets.js';
import { curateHomeWidgets } from '../curateHomeWidgets.js';
import { isPlaceholderHomeWidget } from '../contract.js';

const noopLoad = (): Promise<{ default: unknown }> => Promise.resolve({ default: null });

/** A loader map binding every roadmap id to an inert loader (stands in for an app's platform skeletons). */
const noopLoaders = Object.fromEntries(ROADMAP_WIDGET_SPECS.map((spec) => [spec.id, noopLoad])) as Record<
    (typeof ROADMAP_WIDGET_SPECS)[number]['id'],
    typeof noopLoad
>;

describe('ROADMAP_WIDGET_SPECS', () => {
    it('declares the three widgets the Home mockup shows for unshipped features (005–009)', () => {
        expect(ROADMAP_WIDGET_SPECS.map((spec) => spec.id)).toEqual(['nutrition', 'resume-cooking', 'meal-plan']);
    });

    it('gives every spec a non-empty capability — a placeholder is defined by what it waits on', () => {
        for (const spec of ROADMAP_WIDGET_SPECS) {
            expect(spec.capability.length).toBeGreaterThan(0);
        }
    });

    it('uses a unique id per spec', () => {
        expect(new Set(ROADMAP_WIDGET_SPECS.map((spec) => spec.id)).size).toBe(ROADMAP_WIDGET_SPECS.length);
    });

    it('uses a unique capability per spec', () => {
        expect(new Set(ROADMAP_WIDGET_SPECS.map((spec) => spec.capability)).size).toBe(ROADMAP_WIDGET_SPECS.length);
    });

    it('does not collide with the live recipe widget id', () => {
        expect(ROADMAP_WIDGET_SPECS.map((spec) => spec.id)).not.toContain('recipes');
    });

    it('weights every placeholder ABOVE the recipe widget, matching the mockup order', () => {
        // Mockup order top→bottom: Today's Nutrition, Resume cooking, This Week's Meals, Recent Recipes.
        for (const spec of ROADMAP_WIDGET_SPECS) {
            expect(spec.defaultWeight).toBeGreaterThan(RECIPE_WIDGET_DEFAULT_WEIGHT_REFERENCE);
        }
    });

    it('orders the specs by descending weight so the declaration reads as the mockup layout', () => {
        const weights = ROADMAP_WIDGET_SPECS.map((spec) => spec.defaultWeight);

        expect(weights).toEqual([...weights].sort((a, b) => b - a));
    });

    it('exposes ROADMAP_WIDGET_IDS as exactly the spec ids (the parity keystone apps key their skeletons by)', () => {
        expect(ROADMAP_WIDGET_IDS).toEqual(ROADMAP_WIDGET_SPECS.map((spec) => spec.id));
    });
});

describe('createRoadmapPlaceholders', () => {
    it('builds one placeholder descriptor per spec', () => {
        const placeholders = createRoadmapPlaceholders(noopLoaders);

        expect(placeholders.map((descriptor) => descriptor.id)).toEqual(ROADMAP_WIDGET_SPECS.map((spec) => spec.id));
    });

    it('marks every built descriptor as the placeholder arm', () => {
        for (const descriptor of createRoadmapPlaceholders(noopLoaders)) {
            expect(isPlaceholderHomeWidget(descriptor)).toBe(true);
        }
    });

    it('carries each spec capability and weight onto its descriptor', () => {
        const placeholders = createRoadmapPlaceholders(noopLoaders);

        for (const spec of ROADMAP_WIDGET_SPECS) {
            const descriptor = placeholders.find((candidate) => candidate.id === spec.id);

            expect(descriptor?.capability).toBe(spec.capability);
            expect(descriptor?.defaultWeight).toBe(spec.defaultWeight);
        }
    });

    it("binds each descriptor to ITS OWN id's loader (a mis-wired map would swap skeletons)", async () => {
        const loaders = Object.fromEntries(
            ROADMAP_WIDGET_SPECS.map((spec) => [spec.id, () => Promise.resolve({ default: spec.id })]),
        ) as Record<(typeof ROADMAP_WIDGET_SPECS)[number]['id'], () => Promise<{ default: unknown }>>;

        for (const descriptor of createRoadmapPlaceholders(loaders)) {
            expect((await descriptor.load()).default).toBe(descriptor.id);
        }
    });

    it('produces descriptors that all survive curation while no roadmap capability is live', () => {
        const curated = curateHomeWidgets(createRoadmapPlaceholders(noopLoaders), { liveCapabilities: ['recipes'] });

        expect(curated.map((descriptor) => descriptor.id)).toEqual(ROADMAP_WIDGET_SPECS.map((spec) => spec.id));
    });

    it('drops exactly the placeholder whose capability goes live, keeping the rest', () => {
        const [first] = ROADMAP_WIDGET_SPECS;

        if (first === undefined) {
            throw new Error('expected at least one roadmap spec');
        }

        const curated = curateHomeWidgets(createRoadmapPlaceholders(noopLoaders), {
            liveCapabilities: [first.capability],
        });

        expect(curated.map((descriptor) => descriptor.id)).toEqual(
            ROADMAP_WIDGET_SPECS.filter((spec) => spec.id !== first.id).map((spec) => spec.id),
        );
    });
});
