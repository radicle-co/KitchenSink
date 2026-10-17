/**
 * @module css/compileCss — the stylesheet pipeline: artifact entry, then the compiler, then the dark-theme rewrite.
 *
 * @pattern Pipes and Filters — entry → {@link CssCompiler} → {@link darkThemeSelector}
 */
import { join } from 'node:path';

import postcss from 'postcss';

import { PACKAGE_ROOT } from '../config.js';

import { CONTENT_SOURCE_ROOTS, artifactCssEntry } from './artifactCssEntry.js';
import type { CssCompiler } from './cssCompiler.js';
import { darkThemeSelector } from './darkThemeSelector.js';

/**
 * The file the entry stands in for. It sits in this package so `tailwindcss` resolves from this package's
 * dependencies, whatever the working directory is.
 */
const ENTRY_FROM = join(PACKAGE_ROOT, 'src/css/artifact.css');

/**
 * Compile the artifact stylesheet.
 *
 * @param compiler - The CSS compiler to run the entry through.
 * @param sourceRoots - Directories of the bundled product sources (`bundleComponents` derives them from the
 *     bundle's real inputs). The authored cards and boards are added here.
 * @returns The stylesheet, with its dark overrides on `:root[data-theme="dark"]`.
 * @sideEffect Whatever the compiler does: the Tailwind adapter reads the source trees from disk.
 */
export async function compileCss(compiler: CssCompiler, sourceRoots: readonly string[]): Promise<string> {
    const css = artifactCssEntry([...sourceRoots, ...CONTENT_SOURCE_ROOTS]);
    const compiled = await compiler.compile({ css, from: ENTRY_FROM });
    const rewritten = await postcss([darkThemeSelector()]).process(compiled, { from: undefined });

    return rewritten.css;
}
