import type { SurfaceEntry } from '../surfaceEntry.js';

/**
 * A surface entry for a test. A name starting `use` is a hook, as in the real registry; anything else is a component.
 *
 * @param name - The export name.
 * @param overrides - Fields to replace.
 * @returns A complete entry.
 */
export function makeSurfaceEntry(name: string, overrides: Partial<SurfaceEntry> = {}): SurfaceEntry {
    return {
        name,
        file: `/ui/${name}.tsx`,
        kind: name.startsWith('use') ? 'hook' : 'component',
        ...overrides,
    };
}
