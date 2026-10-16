/**
 * @module @commise/features-core/home — the per-loader component cache both apps' roadmap slots build their lazy
 * skeletons with.
 *
 * @pattern Memoize — a `WeakMap` keyed on the descriptor's loader, with the app's own code-splitting call (`next/dynamic`
 * on web, `React.lazy` on mobile) passed in as the build.
 */
import type { ComponentType } from 'react';

import type { HomeWidgetLoader } from '../contract.js';

/**
 * Make a lookup that builds a descriptor's component ONCE per loader and answers the same one after.
 *
 * ⛔ Not a `useMemo` inside the slot. A component type created during render is a new type whenever the memo misses — a
 * descriptor re-created by its parent, or a remount — and a new type remounts its subtree and re-imports the chunk
 * (`react-hooks/static-components`). The loader is the descriptor's stable identity, so the built component is keyed on
 * it for the life of the page. A `WeakMap`, so a loader nothing references any more takes its component with it.
 *
 * @param build - Builds the code-split component for a loader (called at most once per loader).
 * @returns The lookup. Each call to this factory owns its own cache.
 */
export function componentPerLoader(
    build: (load: HomeWidgetLoader) => ComponentType,
): (load: HomeWidgetLoader) => ComponentType {
    const built = new WeakMap<HomeWidgetLoader, ComponentType>();

    /**
     * @param load - The descriptor's loader seam.
     * @returns The same component for every call with the same loader.
     * @sideEffect Records the built component in this factory's loader-keyed cache on first use.
     */
    return (load) => {
        const cached = built.get(load);

        if (cached !== undefined) {
            return cached;
        }

        const component = build(load);

        built.set(load, component);

        return component;
    };
}
