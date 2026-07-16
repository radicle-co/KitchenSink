/**
 * @module @commise/features-core — the Home capability vocabulary.
 *
 * A **capability** names a backing service that may or may not be deployed. It is the single fact from which
 * the whole "this feature hasn't shipped yet" behaviour is derived:
 *  - `roadmapWidgets.ts` uses it to decide which Home widget renders as a skeleton placeholder;
 *  - `homeNavigation.ts` uses it to decide which nav destinations are non-interactive "coming soon";
 *  - each app seeds its `liveCapabilities` with the capabilities it has actually deployed.
 *
 * The strings live HERE, once, because they are a cross-module contract: a capability spelled `'meal-plan'`
 * in the nav and `'meal-planning'` in the roadmap would type-check perfectly and silently ship a Home where
 * the widget lights up but the nav link stays dead. Naming them in one place makes that mismatch impossible
 * to express.
 *
 * A capability that a live feature declares (e.g. `RECIPE_HOME_WIDGET_CAPABILITY` in
 * `@commise/features-recipes`) is deliberately NOT listed here: a shipped feature owns its own capability
 * name next to its code, and this module would be a back-dependency. This vocabulary covers only the
 * not-yet-shipped cohort (005–009) that no package can own yet — and it shrinks as they ship.
 */

/**
 * Capabilities of the unshipped 005–009 cohort. Each must match, exactly, the capability string the real
 * feature declares when it ships — that string is the handshake that retires the placeholder.
 */
export const ROADMAP_CAPABILITIES = {
    /** Feature 005 — meal planning ("This Week's Meals"). */
    mealPlanning: 'meal-planning',
    /** Feature 006 — grocery / shopping lists. Nav destination only; no Home widget in the mockup. */
    shopping: 'shopping',
    /** Feature 007 — nutrition tracking ("Today's Nutrition"). */
    nutrition: 'nutrition',
    /** Feature 009 — an in-progress cooking session ("Resume cooking"). */
    cookingSession: 'cooking-session',
} as const;

/** A capability from the roadmap vocabulary. */
export type RoadmapCapability = (typeof ROADMAP_CAPABILITIES)[keyof typeof ROADMAP_CAPABILITIES];

/** Every roadmap capability, for exhaustiveness checks in tests and dictionaries. */
export const ROADMAP_CAPABILITY_VALUES: readonly RoadmapCapability[] = Object.values(ROADMAP_CAPABILITIES);
