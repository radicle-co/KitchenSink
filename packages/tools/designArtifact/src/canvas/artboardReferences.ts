/**
 * @module canvas/artboardReferences — the design-system components an artboard mounts.
 *
 * Pure. A board mounts a component with `component-from-global-scope="Commise.Button"` (web) or
 * `"Commise.Native.Button"` (native). Those attributes are the references the build can check against the surface:
 * a board that names a component the bundle does not export would render an empty box, so the parity guard fails on
 * it first. References made from a board's own script (`const C = window.Commise.Native; C.Button`) are not
 * visible to a static read and are covered by the e2e tier, which renders every board.
 */

/** A component an artboard mounts and the surface it must come from. */
export interface ArtboardReference {
    readonly platform: 'web' | 'native';
    readonly name: string;
}

// A component name is PascalCase; a lowercase name (a hook) is not something a board mounts.
const MOUNT = /component-from-global-scope=(["'])Commise\.(?:(Native)\.)?([A-Z][A-Za-z0-9]*)\1/gu;

/**
 * Every component an artboard mounts, each once, in the order of first appearance.
 *
 * @param html - The board file's text.
 * @returns The references.
 */
export function artboardReferences(html: string): readonly ArtboardReference[] {
    const seen = new Set<string>();
    const references: ArtboardReference[] = [];

    for (const match of html.matchAll(MOUNT)) {
        const platform = match[2] === undefined ? 'web' : 'native';
        const name = match[3] ?? '';
        const key = `${platform}:${name}`;

        if (name !== 'Native' && !seen.has(key)) {
            seen.add(key);
            references.push({ platform, name });
        }
    }

    return references;
}
