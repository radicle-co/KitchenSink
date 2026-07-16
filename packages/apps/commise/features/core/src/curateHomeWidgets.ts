/**
 * @module @commise/features-core — pure Home-widget composition (L2).
 */

import { isPlaceholderHomeWidget, type CurateHomeWidgets, type HomeWidgetDescriptor } from './contract.js';

/**
 * Ascending subscription-tier ladder (least → most privileged). Index 0 is the
 * default/free tier that a viewer with no explicit tier is treated as. The v1
 * ladder mirrors the spec's two test users (`free`, `pro`); a widget's `minTier`
 * gates it out for any viewer whose tier ranks below it. Extend this array (never
 * reorder existing entries) when new tiers ship.
 */
export const HOME_WIDGET_TIER_ORDER: readonly string[] = ['free', 'pro'];

/**
 * Rank of a viewer tier in {@link HOME_WIDGET_TIER_ORDER}. An absent tier is
 * treated as the default (rank 0); an unrecognized tier string ranks -1 so it
 * fails every non-trivial `minTier` gate rather than silently passing.
 */
const tierRank = (tier: string | undefined): number => {
    if (tier === undefined) {
        return 0;
    }

    return HOME_WIDGET_TIER_ORDER.indexOf(tier);
};

/**
 * Whether a viewer of `viewerTier` meets a widget's `minTier` requirement. A
 * widget with no `minTier` is always tier-eligible; a widget whose `minTier` is
 * not a recognized tier is treated as ineligible (fail closed).
 */
const meetsTier = (viewerTier: string | undefined, minTier: string | undefined): boolean => {
    if (minTier === undefined) {
        return true;
    }

    const required = HOME_WIDGET_TIER_ORDER.indexOf(minTier);

    if (required < 0) {
        return false;
    }

    return tierRank(viewerTier) >= required;
};

/**
 * Whether a widget's **capability** gate admits it, given the live capabilities.
 * The two arms are gated inversely — see {@link CurateHomeWidgets} — which is what
 * makes a roadmap placeholder and its eventual real widget mutually exclusive
 * under the same id.
 *
 * @param widget - The descriptor to gate.
 * @param liveCapabilities - Capabilities whose backing service is live.
 * @returns True when this arm's capability rule admits the widget.
 */
const meetsCapability = (widget: HomeWidgetDescriptor, liveCapabilities: readonly string[]): boolean => {
    if (isPlaceholderHomeWidget(widget)) {
        // A placeholder stands in ONLY while the real thing is missing. Once the service is live, the
        // feature's own live descriptor (same id) renders instead — so the placeholder must yield.
        return !liveCapabilities.includes(widget.capability);
    }

    // A live widget with no declared capability has no backing service to wait on.
    return widget.capability === undefined || liveCapabilities.includes(widget.capability);
};

/**
 * Pure implementation of {@link CurateHomeWidgets}. Drops any widget that is
 * `hidden`, whose `minTier` exceeds the viewer's tier, or whose capability gate
 * rejects it ({@link meetsCapability} — inverse for placeholders); orders
 * survivors by the viewer's `order` (widgets named there come first, in that
 * order) and then by descending `defaultWeight`. Neither the input array nor the
 * context is mutated.
 */
export const curateHomeWidgets: CurateHomeWidgets = (widgets, ctx) => {
    const hidden = ctx.hidden ?? [];
    const order = ctx.order ?? [];

    const eligible = widgets.filter((widget) => {
        if (hidden.includes(widget.id)) {
            return false;
        }

        if (!meetsCapability(widget, ctx.liveCapabilities)) {
            return false;
        }

        return meetsTier(ctx.tier, widget.minTier);
    });

    return eligible.sort((a, b) => {
        const aIndex = order.indexOf(a.id);
        const bIndex = order.indexOf(b.id);
        const aRanked = aIndex >= 0;
        const bRanked = bIndex >= 0;

        if (aRanked && bRanked) {
            return aIndex - bIndex;
        }

        if (aRanked) {
            return -1;
        }

        if (bRanked) {
            return 1;
        }

        return b.defaultWeight - a.defaultWeight;
    });
};
