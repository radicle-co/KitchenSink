'use client';

/**
 * @module home/RoadmapWidgetSlot — the host slot for a roadmap skeleton placeholder (web).
 *
 * The Home composition root renders one slot per curated widget id. Where {@link RecipeWidgetSlot} is the
 * bespoke slot for the live recipe widget (it wires the recipe data prop), THIS is the generic slot for a
 * {@link PlaceholderHomeWidgetDescriptor}: it code-splits the platform skeleton through the descriptor's own
 * loader seam (`descriptor.load`, bound to a host-owned skeleton in `roadmapFeature.ts`) via `next/dynamic`,
 * and renders it with no props — a placeholder has no data to feed.
 *
 * Rendering through the loader seam (rather than a second id→component map in the host) is what keeps the
 * placeholder ids in ONE place: the shared roadmap registry binds id → skeleton once, and the host just draws
 * whatever the descriptor resolves. Adding a roadmap widget needs no edit here.
 */
import type { HomeWidgetDescriptor } from '@commise/features-core';
import dynamic from 'next/dynamic';
import { useMemo, type ComponentType, type JSX } from 'react';

/** Props for {@link RoadmapWidgetSlot}. */
export interface RoadmapWidgetSlotProps {
    /** The placeholder descriptor whose loader seam resolves this platform's skeleton component. */
    readonly descriptor: HomeWidgetDescriptor;
}

/**
 * The roadmap placeholder slot: code-splits and renders the skeleton the descriptor's loader resolves.
 *
 * @param props - The placeholder `descriptor`.
 * @returns The lazily loaded skeleton placeholder.
 */
export function RoadmapWidgetSlot({ descriptor }: RoadmapWidgetSlotProps): JSX.Element {
    // Build the dynamic component once per descriptor identity — a fresh `dynamic()` each render would drop
    // the loaded chunk and re-import on every parent render. `ssr: false` because the whole Home surface is
    // client-rendered (it needs the viewer's auth token), so there is no server pass to hydrate.
    const Skeleton = useMemo(
        () =>
            dynamic<Record<string, never>>(
                () => descriptor.load().then((module) => ({ default: module.default as ComponentType })),
                { ssr: false },
            ),
        [descriptor],
    );

    return <Skeleton />;
}
