/**
 * @module surface/surfaceEntry — one name the artifact exports on `window.Commise`, and where it comes from.
 */

/** What an entry is: a component draws something, a hook only helps a preview draw it. */
export type SurfaceKind = 'component' | 'hook';

/** A component (or hook) the bundle exports. */
export interface SurfaceEntry {
    /** The export name, which is also the property on `window.Commise`. */
    readonly name: string;
    /** Absolute path to the `.tsx` / `.native.tsx` (or `.ts` for a hook) file that exports it. */
    readonly file: string;
    /** Whether the name is a component or a hook; read this, never guess it from the spelling of the name. */
    readonly kind: SurfaceKind;
}
