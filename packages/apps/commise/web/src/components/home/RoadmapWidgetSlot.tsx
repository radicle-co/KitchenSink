'use client';

/**
 * @module home/RoadmapWidgetSlot — the host slot for a roadmap skeleton placeholder (web).
 *
 * The Home composition root renders one slot per curated widget id. Where `RecipeWidgetSlot` is the
 * bespoke slot for the live recipe widget (it wires the recipe data prop), THIS is the generic slot for a
 * `PlaceholderHomeWidgetDescriptor`: it code-splits the platform skeleton through the descriptor's own
 * loader seam (`descriptor.load`, bound to a host-owned skeleton in `roadmapFeature.ts`) via `next/dynamic`,
 * and renders it with no props — a placeholder has no data to feed.
 *
 * Rendering through the loader seam (rather than a second id→component map in the host) is what keeps the
 * placeholder ids in ONE place: the shared roadmap registry binds id → skeleton once, and the host just draws
 * whatever the descriptor resolves. Adding a roadmap widget needs no edit here.
 *
 * ⚠️ "Slot" + a loader seam + code-splitting read as registry plumbing, but this is PRESENTATIONAL: it
 * starts no request, owns no state, and decides nothing — it draws whatever a prop resolves to. Its native
 * twin says the same thing through `React.lazy` + `Suspense` rather than `next/dynamic`, and that spelling
 * difference must not put the two leaves on different layers.
 */
import type { HomeWidgetDescriptor, HomeWidgetLoader } from '@commise/features-core';
import dynamic from 'next/dynamic';
import type { ComponentType, JSX } from 'react';

/** Props for {@link RoadmapWidgetSlot}. */
export interface RoadmapWidgetSlotProps {
    /** The placeholder descriptor whose loader seam resolves this platform's skeleton component. */
    readonly descriptor: HomeWidgetDescriptor;
}

/**
 * One code-split skeleton component per loader, built OUTSIDE render.
 *
 * ⛔ Not `useMemo` inside the slot. A component type created during render is a new type whenever the memo misses
 * — a descriptor re-created by its parent, or a remount — and a new type remounts its subtree and re-imports the
 * chunk (`react-hooks/static-components`). The loader is the descriptor's stable identity, so the built component
 * is keyed on it for the life of the page, the per-descriptor equivalent of a module-scope `dynamic()`. A
 * `WeakMap` so a loader nothing references any more takes its component with it.
 */
const skeletons = new WeakMap<HomeWidgetLoader, ComponentType>();

/**
 * The skeleton component for `load`, building it on first use.
 *
 * @param load - The descriptor's loader seam.
 * @returns The same code-split component for every call with the same loader.
 * @sideEffect Records the built component in the module's loader-keyed cache on first use.
 */
function skeletonFor(load: HomeWidgetLoader): ComponentType {
    const cached = skeletons.get(load);

    if (cached !== undefined) {
        return cached;
    }

    // `ssr: false` because the whole Home surface is client-rendered (it needs the viewer's auth token), so there
    // is no server pass to hydrate.
    const built = dynamic<Record<string, never>>(
        () => load().then((module) => ({ default: module.default as ComponentType })),
        { ssr: false },
    );

    skeletons.set(load, built);

    return built;
}

/**
 * The roadmap placeholder slot: code-splits and renders the skeleton the descriptor's loader resolves.
 *
 * @param props - The placeholder `descriptor`.
 * @returns The lazily loaded skeleton placeholder.
 */
export function RoadmapWidgetSlot({ descriptor }: RoadmapWidgetSlotProps): JSX.Element {
    const Skeleton = skeletonFor(descriptor.load);

    // `static-components` cannot see through a function call, so it reads any component computed in a render as
    // built there. `skeletonFor` returns ONE component per loader for the life of the page, and
    // `__tests__/RoadmapWidgetSlot.test.tsx` pins that (one load across re-renders and a remount).
    // eslint-disable-next-line react-hooks/static-components -- stable per loader; see the note above
    return <Skeleton />;
}
