/**
 * @module @commise/features-core/home — how one curated Home widget is drawn.
 *
 * The decision both Home hosts made by hand, now made once. The boundary around the result (an `ErrorBoundary` and a
 * `Suspense`) stays in each app: it needs `react-error-boundary`, which this package does not carry.
 *
 * @pattern Visitor — a discriminated union (`kind`) the host switches over exhaustively
 */
import type { ComponentType } from 'react';

import { isPlaceholderHomeWidget, type HomeWidgetDescriptor, type HomeWidgetId } from '../contract.js';

/**
 * One widget the host will draw. A live widget carries the bespoke component that draws it (the recipe widget, which
 * needs its data wired). A placeholder carries only its descriptor: the roadmap slot draws whatever the descriptor's
 * own loader seam resolves, so the host keeps no second id list.
 */
export type HomeWidgetSlot =
    | { readonly kind: 'bespoke'; readonly descriptor: HomeWidgetDescriptor; readonly Widget: ComponentType }
    | { readonly kind: 'placeholder'; readonly descriptor: HomeWidgetDescriptor };

/**
 * Decide how a curated descriptor is drawn.
 *
 * A bespoke renderer wins, so a feature that ships a live widget under a placeholder's id takes the slot over. A live
 * id with no renderer on this client is `undefined` — skipped, so an older client tolerates a newer personalization
 * list (graceful version skew).
 *
 * @param descriptor - The curated descriptor.
 * @param renderers - Widget id → the bespoke component that draws it.
 * @returns The slot, or `undefined` when this client cannot draw the widget. Pure.
 */
export function homeWidgetSlotOf(
    descriptor: HomeWidgetDescriptor,
    renderers: Readonly<Record<HomeWidgetId, ComponentType>>,
): HomeWidgetSlot | undefined {
    const Widget = renderers[descriptor.id];

    // `noUncheckedIndexedAccess` is off, so the index read types as defined: the guard is not dead (see CLAUDE.md).
    if (Widget !== undefined) {
        return { kind: 'bespoke', descriptor, Widget };
    }

    return isPlaceholderHomeWidget(descriptor) ? { kind: 'placeholder', descriptor } : undefined;
}
