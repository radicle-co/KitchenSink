/**
 * @module @commise/features-core/home — the widgets Home draws: discovery, curation and one slot decision each.
 */
import type { Container } from 'ditox';
import { useMemo, type ComponentType } from 'react';

import { resolveHomeWidgets } from '../appShell.js';
import type { HomeWidgetCurationContext, HomeWidgetId } from '../contract.js';
import { curateHomeWidgets, splitComingSoon } from '../curateHomeWidgets.js';
import { homeWidgetSlotOf, type HomeWidgetSlot } from './homeWidgetSlot.js';
import { homeWidgetTierOf } from './homeWidgetTier.js';

/** What {@link useHomeWidgets} reads. */
export interface UseHomeWidgetsInput {
    /** The appShell container the widget descriptors are discovered in. */
    readonly container: Container;
    /** Widget id → the bespoke component that draws it. Pass a stable value: it keys the memo. */
    readonly renderers: Readonly<Record<HomeWidgetId, ComponentType>>;
    /** The capabilities whose backing service is live (`LIVE_CAPABILITIES`). Pass a stable value. */
    readonly liveCapabilities: readonly string[];
    /** The viewer's paid-feature state (`@commise/features-account`'s `PaidFeatureState`). */
    readonly paidFeatures: string;
}

/** The slots Home draws, in order. */
export interface HomeWidgetSlots {
    /** The live widgets, in their curated order. */
    readonly live: readonly HomeWidgetSlot[];
    /** The roadmap placeholders, drawn together after the live widgets under one "Coming soon" heading. */
    readonly comingSoon: readonly HomeWidgetSlot[];
}

/**
 * The widgets Home draws: every descriptor the container holds, gated by live capability and the viewer's tier,
 * split into live widgets and the Coming-soon group, and reduced to the ones this client can draw.
 *
 * Order/hidden personalization lives in the identity profile preferences (002) and is absent in v1, so widgets keep
 * their `defaultWeight` order.
 *
 * @param input - The container, renderers, live capabilities and the viewer's paid-feature state.
 * @returns The live slots and the Coming-soon slots. Memoized on its inputs.
 */
export function useHomeWidgets({
    container,
    renderers,
    liveCapabilities,
    paidFeatures,
}: UseHomeWidgetsInput): HomeWidgetSlots {
    const tier = homeWidgetTierOf(paidFeatures);

    return useMemo(() => {
        const context: HomeWidgetCurationContext = { liveCapabilities: [...liveCapabilities], tier };
        const groups = splitComingSoon(curateHomeWidgets(resolveHomeWidgets(container), context));
        const slotsOf = (descriptors: typeof groups.live): readonly HomeWidgetSlot[] =>
            descriptors.flatMap((descriptor) => homeWidgetSlotOf(descriptor, renderers) ?? []);

        return { live: slotsOf(groups.live), comingSoon: slotsOf(groups.comingSoon) };
    }, [container, renderers, liveCapabilities, tier]);
}
