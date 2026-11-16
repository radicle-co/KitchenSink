'use client';

/**
 * @module @commise/features-recipes/layout — the web container class of `<main>`, the space every surface's cards get
 * (`docs/design/uiOverhaul/buildSpec.md` §1.2), read through the one shared observer (`useMainContentReading`, which
 * says which element is measured and why).
 *
 * A JavaScript reading is needed only where the class picks a COMPONENT, not a style: `cardVariantOf` and the library's
 * default view. It is `narrow` on the server and until `<main>` is measured, so a server render and its hydration agree.
 * It re-renders only when the class changes, not on every width change.
 *
 * @sideEffect Observes the measured `<main>` while mounted.
 */
import { containerClassOf, type ContainerClass } from '@commise/ui/container-class';

import { useMainContentReading } from './useMainContentReading.js';

/**
 * The container class of `<main>`, following it as it resizes.
 *
 * @returns `narrow`, `regular` or `wide`.
 */
export function useMainContainerClass(): ContainerClass {
    return useMainContentReading(containerClassOf, 'narrow');
}
