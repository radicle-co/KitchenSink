/**
 * @module @commise/features-core/home — the viewer's paid-feature state as a Home-widget tier.
 */

/**
 * Map the viewer's paid-feature state (identity's `account.paidFeatures`, plan 2026-10-14-009 D13) onto the Home-widget
 * tier ladder ({@link HOME_WIDGET_TIER_ORDER}): only `granted` reaches a `pro` widget. A paid widget a viewer cannot use
 * is curated out, and its upsell is the nudge, which is offered only under `upsell`.
 *
 * Takes the state as a string because `@commise/features-account` owns its type and this package cannot depend on it;
 * anything that is not `granted` (including a state still loading) is `free`, which fails every paid gate closed.
 *
 * @param paidFeatures - The viewer's paid-feature state (`@commise/features-account`'s `PaidFeatureState`).
 * @returns The tier curation gates on. Pure.
 */
export function homeWidgetTierOf(paidFeatures: string): 'free' | 'pro' {
    return paidFeatures === 'granted' ? 'pro' : 'free';
}
