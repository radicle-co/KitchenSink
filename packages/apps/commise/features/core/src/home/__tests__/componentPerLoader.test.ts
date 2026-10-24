/**
 * One built component per loader, for the life of the page. A component TYPE created during render is a new type
 * whenever a memo misses (a descriptor re-created by its parent, a remount), and a new type remounts its subtree and
 * re-imports the chunk — so the build is keyed on the loader's identity instead. Web (`next/dynamic`) and mobile
 * (`React.lazy`) kept identical WeakMap caches around their one differing line; the cache is this module's, the build
 * is the app's.
 */
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { HomeWidgetLoader } from '../../contract.js';
import { componentPerLoader } from '../componentPerLoader.js';

const loader = (): HomeWidgetLoader => () => Promise.resolve({ default: null });
const componentOf = (): ComponentType => () => null;

describe('componentPerLoader', () => {
    it('builds once per loader and answers the same component on every later call', () => {
        const build = vi.fn(componentOf);
        const componentFor = componentPerLoader(build);
        const load = loader();

        const first = componentFor(load);

        expect(componentFor(load)).toBe(first);
        expect(componentFor(load)).toBe(first);
        expect(build).toHaveBeenCalledTimes(1);
        expect(build).toHaveBeenCalledWith(load);
    });

    it('builds a distinct component for a distinct loader', () => {
        const componentFor = componentPerLoader(componentOf);

        expect(componentFor(loader())).not.toBe(componentFor(loader()));
    });

    it('keeps one cache per factory, so two builds never share a loader’s component', () => {
        const load = loader();

        expect(componentPerLoader(componentOf)(load)).not.toBe(componentPerLoader(componentOf)(load));
    });
});
