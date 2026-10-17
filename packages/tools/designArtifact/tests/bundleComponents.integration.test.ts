import { beforeAll, describe, expect, it } from 'vitest';

import { statSync } from 'node:fs';
import { join } from 'node:path';

import { bundleComponents } from '../src/bundle/bundleComponents.js';
import { EsbuildBundler } from '../src/bundle/esbuildBundler.js';
import { COMMISE_ROOT, UI_SRC } from '../src/config.js';
import { REACT18_BRIDGE_SOURCE } from '../src/runtime/react18Bridge.js';
import { discoverSurface } from '../src/surface/discoverSurface.js';

describe('bundleComponents with the real esbuild bundler over the real sources', () => {
    const surface = discoverSurface();
    let script = '';
    let sourceRoots: readonly string[] = [];

    beforeAll(async () => {
        ({ script, sourceRoots } = await bundleComponents(surface, new EsbuildBundler()));
    });

    it('reports the real directories its inputs came from, dependencies excluded', () => {
        expect(sourceRoots).toContain(join(UI_SRC, 'button'));
        expect(sourceRoots.some((root) => root.startsWith(join(COMMISE_ROOT, 'features')))).toBe(true);
        expect(sourceRoots.every((root) => statSync(root).isDirectory())).toBe(true);
        expect(sourceRoots.filter((root) => root.includes('/node_modules/'))).toEqual([]);
    });

    it('opens with a header listing every web component and no hook', () => {
        const header = JSON.parse(/^\/\* @ds-bundle: (.*) \*\/\n/u.exec(script)?.[1] ?? 'null') as {
            format: number;
            components: { name: string }[];
        };
        const listed = header.components.map((c) => c.name);

        expect(header.format).toBe(4);
        expect(listed).toEqual(expect.arrayContaining(['Button', 'RecipeCard', 'HomeSidebar']));
        expect(listed).not.toContain('useSnackbar');
        expect(listed).toHaveLength(surface.web.length - 1);
    });

    it('defines the bridge, both bundles and the single Commise global, in that order', () => {
        const order = [
            REACT18_BRIDGE_SOURCE.trim(),
            'var __CommiseWeb =',
            'var __CommiseNative =',
            'window.Commise =',
        ].map((marker) => script.indexOf(marker));

        expect(order.every((index) => index > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('is safe to inline in a script element', () => {
        expect(script).not.toMatch(/<\/script/iu);
        expect(script).not.toContain('<!--');
    });

    it('contains no copy of React and no runtime fake process', () => {
        expect(script).not.toContain('react.production');
        expect(script).not.toMatch(/window\.process\s*=/u);
    });
});
