/**
 * @module home/RoadmapWidgetSlot — the host slot for a roadmap skeleton placeholder (mobile).
 *
 * The Home composition root renders one slot per curated widget id. Where `RecipeWidgetSlot` is the
 * bespoke slot for the live recipe widget, THIS is the generic slot for a placeholder descriptor: it
 * code-splits the native skeleton through the descriptor's own loader seam (`descriptor.load`, bound to a
 * host-owned `.native` skeleton in `roadmapFeature.ts`) via `React.lazy`, and renders it with no props — a
 * placeholder has no data to feed.
 *
 * Rendering through the loader seam (rather than a second id→component map in the host) keeps the placeholder
 * ids in ONE place: the shared roadmap registry binds id → skeleton once, and the host just draws whatever
 * the descriptor resolves.
 *
 * ⚠️ "Slot" + `lazy` + `Suspense` read as registry plumbing, but this is PRESENTATIONAL: it starts no
 * request, owns no state, and decides nothing — it draws whatever a prop resolves to. Its web twin says the
 * same thing through `next/dynamic`, and that spelling difference must not put the two leaves on different
 * layers.
 */
import type { HomeWidgetDescriptor } from '@commise/features-core';
import { Suspense, lazy, useMemo, type ComponentType, type JSX } from 'react';

/** Props for {@link RoadmapWidgetSlot}. */
export interface RoadmapWidgetSlotProps {
    /** The placeholder descriptor whose loader seam resolves this platform's skeleton component. */
    readonly descriptor: HomeWidgetDescriptor;
}

/**
 * The roadmap placeholder slot (mobile): code-splits and renders the skeleton the descriptor's loader
 * resolves.
 *
 * @param props - The placeholder `descriptor`.
 * @returns The lazily loaded skeleton placeholder under a `Suspense` boundary.
 */
export function RoadmapWidgetSlot({ descriptor }: RoadmapWidgetSlotProps): JSX.Element {
    // Build the lazy component once per descriptor identity — a fresh `lazy()` each render would re-import
    // and re-suspend on every parent render.
    const Skeleton = useMemo(
        () =>
            lazy<ComponentType>(() =>
                descriptor.load().then((module) => ({ default: module.default as ComponentType })),
            ),
        [descriptor],
    );

    return (
        <Suspense fallback={null}>
            <Skeleton />
        </Suspense>
    );
}
