import { beforeAll, describe, expect, it } from 'vitest';

import { buttonSurfaceClass } from '@commise/ui/button';
import { roleDark } from '@commise/ui/colors';

import { bundleComponents } from '../src/bundle/bundleComponents.js';
import { EsbuildBundler } from '../src/bundle/esbuildBundler.js';
import { compileCss } from '../src/css/compileCss.js';
import { tailwindCssCompiler } from '../src/css/tailwindCssCompiler.js';
import { discoverSurface } from '../src/surface/discoverSurface.js';

/** Utilities that carry no variant, bracket or slash, so their selector is the class name behind a dot. */
function plainUtilities(classList: string): readonly string[] {
    return classList.split(/\s+/).filter((name) => name !== '' && !/[:[\]/]/.test(name));
}

describe('compileCss with the real Tailwind compiler', () => {
    let css = '';

    beforeAll(async () => {
        // The real roots the bundle reports, so this tier compiles exactly what the build compiles.
        const { sourceRoots } = await bundleComponents(discoverSurface(), new EsbuildBundler());
        css = await compileCss(tailwindCssCompiler(), sourceRoots);
    });

    it('has no prefers-color-scheme rule left: the viewer picks the theme', () => {
        expect(css).not.toMatch(/prefers-color-scheme/);
    });

    it('overrides the role variables on :root[data-theme="dark"] with the dark values from @commise/ui', () => {
        const block = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css);

        expect(block, 'the dark selector block is present').not.toBeNull();
        const body = block?.[1] ?? '';

        expect(body).toContain(`--color-canvas: ${roleDark.canvas}`);
        expect(body).toContain(`--color-ink: ${roleDark.ink}`);
        expect(body).toContain(`--color-action-text: ${roleDark.actionText}`);
    });

    it('keeps the light values on :root', () => {
        expect(css).toMatch(/--color-canvas:\s*#FAF6F0/i);
    });

    it('generates the utility classes a ui component uses (the Button surfaces)', () => {
        const names = [
            ...plainUtilities(buttonSurfaceClass('primary')),
            ...plainUtilities(buttonSurfaceClass('secondary')),
            ...plainUtilities(buttonSurfaceClass('destructive')),
        ];

        expect(names.length).toBeGreaterThan(5);

        for (const name of names) {
            expect(css, `.${name}`).toContain(`.${name.replaceAll('.', '\\.')}`);
        }
    });

    it('generates the motion utilities, whose tokens come from the ui theme', () => {
        expect(css).toContain('.animate-pending-bar-reveal');
        expect(css).toContain('@keyframes pending-bar-reveal');
    });

    it('emits each Tailwind layer once (a second theme import would double the preflight)', () => {
        expect(css.match(/^@layer base \{/gm)).toHaveLength(1);
        expect(css.match(/^@layer utilities \{/gm)).toHaveLength(1);
    });
});
