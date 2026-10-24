import { describe, expect, it } from 'vitest';

import { PACKAGE_ROOT } from '../../config.js';
import { CONTENT_SOURCE_ROOTS, artifactCssEntry } from '../artifactCssEntry.js';
import { compileCss } from '../compileCss.js';
import type { CssCompiler } from '../cssCompiler.js';

/** A compiler that records what it was given and answers a fixed stylesheet. */
function fakeCompiler(output: string): CssCompiler & { readonly calls: { css: string; from: string }[] } {
    const calls: { css: string; from: string }[] = [];

    return {
        calls,
        compile(input) {
            calls.push(input);

            return Promise.resolve(output);
        },
    };
}

describe('compileCss', () => {
    it('feeds the compiler the artifact entry, anchored inside this package', async () => {
        const compiler = fakeCompiler('.a{}');

        await compileCss(compiler, ['/r/ui/src']);

        expect(compiler.calls).toHaveLength(1);
        expect(compiler.calls[0]?.css).toBe(artifactCssEntry(['/r/ui/src', ...CONTENT_SOURCE_ROOTS]));
        expect(compiler.calls[0]?.from.startsWith(PACKAGE_ROOT)).toBe(true);
    });

    it('moves the dark media block onto the data-theme selector after compiling', async () => {
        const css = await compileCss(fakeCompiler(':root{--a:0}@media (prefers-color-scheme: dark){:root{--a:1}}'), []);

        expect(css).toContain(':root[data-theme="dark"]');
        expect(css).not.toContain('prefers-color-scheme');
    });

    it('passes a compiler failure through', async () => {
        const failing: CssCompiler = { compile: () => Promise.reject(new Error('boom')) };

        await expect(compileCss(failing, [])).rejects.toThrow('boom');
    });
});
