/**
 * @module @commise/features-core — the ROADMAP widget registry (temporary scaffolding; delete as 005–009 ship).
 *
 * ## Why this module exists, and why it is the one exception to the "no central registry" rule
 *
 * The Home surface's discovery layer is deliberately decentralized: a feature owns its
 * {@link HomeWidgetDescriptor} next to its own code, so shipping a feature package makes its widget eligible
 * without anyone editing a shared list. That works precisely because the feature package exists.
 *
 * CR-001 (amending FR-046 / R6) requires Home to show a **skeleton placeholder** for widgets whose feature
 * has NOT shipped (005–009: meal-plan, grocery/shopping, nutrition, resume-cooking). Those descriptors have
 * no package to live in — there is, by construction, no `@commise/features-meal-plan` to colocate them with.
 * So they are declared here, and this module is knowingly a **central registry**: the exact thing R6's
 * decentralized design avoids. That is the honest cost of the placeholder decision, and it is bounded three
 * ways:
 *
 *  1. **It only shrinks.** Every entry is deleted when its feature package ships and registers a real
 *     descriptor under the same id. This module's end state is deletion, not growth.
 *  2. **Forgetting to delete an entry is not a user-visible bug.** Placeholder and live descriptors are
 *     mutually exclusive on the capability (see `curateHomeWidgets`), so a stale placeholder simply gates
 *     itself out forever. It becomes dead code, not a duplicate tile. The transition is pinned by
 *     `__tests__/curateHomeWidgets.test.ts` → "placeholder → live self-supersede".
 *  3. **It holds metadata only — never components.** This package is pure TS + zod with no React dependency,
 *     which is not an accident: the skeleton COMPONENTS are platform code and live in each app
 *     (`.tsx` for web, `.native.tsx` for mobile). Each app binds its platform skeletons to these ids through
 *     {@link createRoadmapPlaceholders}, whose `Record<RoadmapWidgetId, HomeWidgetLoader>` parameter makes a
 *     platform that forgets a skeleton a **compile error** — that is how FR-044 parity is enforced here
 *     rather than merely hoped for.
 *
 * The alternative — letting each app declare its own placeholder ids/capabilities/weights — was rejected: it
 * duplicates the id + capability knowledge across web and mobile, and those two copies drifting is exactly
 * the failure the widget id keystone exists to prevent.
 */

import { ROADMAP_CAPABILITIES } from './capabilities.js';
import type { HomeWidgetLoader, PlaceholderHomeWidgetDescriptor } from './contract.js';

/**
 * The recipe widget's `defaultWeight` (`RECIPE_HOME_WIDGET_DEFAULT_WEIGHT` in `@commise/features-recipes`),
 * restated here as the reference point the roadmap weights are chosen against.
 *
 * It is a literal, not an import, because the dependency runs the other way — `@commise/features-recipes`
 * depends on this package, so importing back would be a cycle. The two are pinned together by a test
 * (`ROADMAP_WIDGET_SPECS` weights must exceed it), so a drift is caught rather than silently reordering Home.
 */
export const RECIPE_WIDGET_DEFAULT_WEIGHT_REFERENCE = 1000;

/**
 * Declaration of one roadmap widget: the metadata a placeholder needs, with no platform coupling.
 */
export interface RoadmapWidgetSpec {
    /**
     * The stable widget id — the SAME id the feature package must use when it ships its real widget, which
     * is what makes the placeholder self-supersede rather than double up.
     */
    readonly id: RoadmapWidgetId;
    /**
     * The capability whose backing service the widget waits on. The placeholder shows only while this is NOT
     * in the host's `liveCapabilities`. Must match the string the real feature declares.
     */
    readonly capability: string;
    /** Ordering weight; higher sorts earlier. Chosen to reproduce the Home mockup's top-to-bottom order. */
    readonly defaultWeight: number;
}

/**
 * Every roadmap widget id. A literal union (not `string`), so each app's skeleton map must be exhaustive over
 * it — a platform missing a skeleton fails `typecheck`, not review.
 */
export type RoadmapWidgetId = 'nutrition' | 'resume-cooking' | 'meal-plan';

/**
 * The roadmap widgets, in mockup order (top to bottom): Today's Nutrition, Resume cooking, This Week's Meals.
 * All weigh MORE than {@link RECIPE_WIDGET_DEFAULT_WEIGHT_REFERENCE} so the live recipe widget trails them,
 * as it does in the mockup ("Recent Recipes" is last).
 *
 * **To retire an entry:** when its feature ships, delete its line here and its skeleton in each app. Nothing
 * else needs to change — the feature's own descriptor takes over by id.
 */
export const ROADMAP_WIDGET_SPECS: readonly RoadmapWidgetSpec[] = [
    { id: 'nutrition', capability: ROADMAP_CAPABILITIES.nutrition, defaultWeight: 1400 },
    { id: 'resume-cooking', capability: ROADMAP_CAPABILITIES.cookingSession, defaultWeight: 1300 },
    { id: 'meal-plan', capability: ROADMAP_CAPABILITIES.mealPlanning, defaultWeight: 1200 },
];

/** The roadmap ids, in spec order — the keys each app's skeleton map is keyed by. */
export const ROADMAP_WIDGET_IDS: readonly RoadmapWidgetId[] = ROADMAP_WIDGET_SPECS.map((spec) => spec.id);

/**
 * Build the placeholder descriptors for every roadmap widget, binding each id to the calling platform's
 * skeleton loader.
 *
 * @param loaders - One loader per roadmap id, resolving that platform's skeleton component module. Typed as a
 * total `Record` over {@link RoadmapWidgetId}, so an app that forgets a platform skeleton does not compile.
 * @returns One placeholder descriptor per {@link ROADMAP_WIDGET_SPECS} entry, in spec order. Pure.
 */
export function createRoadmapPlaceholders(
    loaders: Readonly<Record<RoadmapWidgetId, HomeWidgetLoader>>,
): readonly PlaceholderHomeWidgetDescriptor[] {
    return ROADMAP_WIDGET_SPECS.map((spec) => ({
        kind: 'placeholder',
        id: spec.id,
        load: loaders[spec.id],
        defaultWeight: spec.defaultWeight,
        capability: spec.capability,
    }));
}
