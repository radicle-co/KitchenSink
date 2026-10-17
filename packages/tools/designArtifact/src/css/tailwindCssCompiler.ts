/**
 * @module css/tailwindCssCompiler — the {@link CssCompiler} adapter over PostCSS and `@tailwindcss/postcss`.
 *
 * @pattern Adapter over postcss + @tailwindcss/postcss
 */
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';

import type { CssCompiler } from './cssCompiler.js';

/**
 * Build the Tailwind v4 compiler.
 *
 * @returns A compiler that runs the source through PostCSS with the Tailwind plugin.
 */
export function tailwindCssCompiler(): CssCompiler {
    return {
        /** @sideEffect Reads the files the stylesheet imports and every `@source` tree from disk. */
        async compile({ css, from }) {
            const result = await postcss([tailwindcss()]).process(css, { from });

            return result.css;
        },
    };
}
