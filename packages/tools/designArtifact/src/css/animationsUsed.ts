/**
 * @module css/animationsUsed — which custom `animate-*` utilities a source tree uses, and whether the artifact
 * stylesheet defines them.
 *
 * A custom animation is two pieces: the class in a component, and a `--animate-*` token plus `@keyframes` in a
 * stylesheet. The artifact does not load the web app's `globals.css`, so a class whose token is missing renders
 * as no animation at all and nothing fails. The set that must be defined is therefore derived from the sources,
 * not listed.
 */

/** Tailwind ships these; they need no token. */
const BUILT_IN = new Set(['none', 'spin', 'ping', 'pulse', 'bounce']);

/** `animate-<name>` at the start of a class: not inside a longer word, and after a variant colon is fine. */
const ANIMATE_CLASS = /(?<![\w-])animate-([a-z][a-z0-9-]*)/gu;

/**
 * @param source - Source text (TypeScript, JSX or HTML).
 * @returns The custom animation names it uses, once each, in first-use order.
 */
export function animationsUsed(source: string): readonly string[] {
    const names = new Set<string>();

    for (const match of source.matchAll(ANIMATE_CLASS)) {
        const name = match[1];

        if (name !== undefined && !BUILT_IN.has(name)) {
            names.add(name);
        }
    }

    return [...names];
}

/**
 * @param used - Animation names the sources use.
 * @param css - The stylesheet that must define them.
 * @returns The names for which `css` declares no `--animate-<name>` token.
 */
export function undefinedAnimations(used: readonly string[], css: string): readonly string[] {
    return used.filter((name) => !new RegExp(`--animate-${name}\\s*:`, 'u').test(css));
}
