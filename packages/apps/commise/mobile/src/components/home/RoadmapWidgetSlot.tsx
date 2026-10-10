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
import type { HomeWidgetDescriptor, HomeWidgetLoader } from '@commise/features-core';
import { Suspense, lazy, type ComponentType, type JSX } from 'react';

/** Props for {@link RoadmapWidgetSlot}. */
export interface RoadmapWidgetSlotProps {
    /** The placeholder descriptor whose loader seam resolves this platform's skeleton component. */
    readonly descriptor: HomeWidgetDescriptor;
}

/**
 * One `lazy()` skeleton component per loader, built OUTSIDE render — see the web twin for why not `useMemo`: a
 * component type created during render remounts its subtree and re-imports the chunk whenever the memo misses.
 */
const skeletons = new WeakMap<HomeWidgetLoader, ComponentType>();

/**
 * The skeleton component for `load`, building it on first use.
 *
 * @param load - The descriptor's loader seam.
 * @returns The same lazy component for every call with the same loader.
 * @sideEffect Records the built component in the module's loader-keyed cache on first use.
 */
function skeletonFor(load: HomeWidgetLoader): ComponentType {
    const cached = skeletons.get(load);

    if (cached !== undefined) {
        return cached;
    }

    const built = lazy<ComponentType>(() => load().then((module) => ({ default: module.default as ComponentType })));

    skeletons.set(load, built);

    return built;
}

/**
 * The roadmap placeholder slot (mobile): code-splits and renders the skeleton the descriptor's loader
 * resolves.
 *
 * @param props - The placeholder `descriptor`.
 * @returns The lazily loaded skeleton placeholder under a `Suspense` boundary.
 */
export function RoadmapWidgetSlot({ descriptor }: RoadmapWidgetSlotProps): JSX.Element {
    const Skeleton = skeletonFor(descriptor.load);

    // `static-components` cannot see through a function call, so it reads any component computed in a render as
    // built there. `skeletonFor` returns ONE component per loader for the life of the app, and
    // `RoadmapWidgetSlot.native.test.tsx` pins that (one load across re-renders and a remount).
    return (
        <Suspense fallback={null}>
            {/* eslint-disable-next-line react-hooks/static-components -- stable per loader; see the note above */}
            <Skeleton />
        </Suspense>
    );
}
