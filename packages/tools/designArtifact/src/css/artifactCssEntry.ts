/**
 * @module css/artifactCssEntry — the Tailwind input the artifact stylesheet is compiled from.
 *
 * It imports the product's own theme (`@commise/ui/theme.css`) instead of restating it, switches Tailwind's
 * automatic source detection off, and names the source trees to scan: the ones the bundle was built from (derived by the caller from esbuild's
 * metafile, never listed here) and the authored previews.
 *
 * ⛔ It does NOT also `@import 'tailwindcss'`: `theme.css` opens with that import itself, and importing it twice
 * emitted every layer (preflight included) twice, measured at 101 KB against 98 KB with a duplicated base. The
 * `source(none)` goes on the theme import, which is where the Tailwind import now sits.
 */
import { join } from 'node:path';

import { CONTENT_DIR } from '../config.js';

/**
 * The authored previews: cards and boards write utility classes of their own, and only the stylesheet can supply
 * them, because they are not part of the component bundle the `@source` roots are derived from.
 */
export const CONTENT_SOURCE_ROOTS: readonly string[] = [
    join(CONTENT_DIR, 'designSystem/cards'),
    join(CONTENT_DIR, 'canvas/boards'),
];

/**
 * The Tailwind input for the artifact stylesheet. Pure.
 *
 * Every `@import` comes first: CSS drops an `@import` that follows another rule.
 *
 * @param sourceRoots - Absolute directories Tailwind scans for class names.
 * @returns The stylesheet source.
 * @throws Error when a root holds a quote or a line break, which would end its `@source` string early.
 */
export function artifactCssEntry(sourceRoots: readonly string[]): string {
    for (const root of sourceRoots) {
        if (/["\\\r\n]/.test(root)) {
            throw new Error(`Cannot write the source root ${JSON.stringify(root)} into an @source rule.`);
        }
    }

    return [
        "@import '@commise/ui/theme.css' source(none);",
        '',
        '@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));',
        '',
        ...sourceRoots.map((root) => `@source "${root}";`),
        '',
    ].join('\n');
}
