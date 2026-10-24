import { describe, expect, it } from 'vitest';

import { REACT18_BRIDGE_SOURCE } from '../../runtime/react18Bridge.js';
import type { Surface } from '../../surface/discoverSurface.js';
import type { BundleRequest, BundleResult, Bundler } from '../bundler.js';
import { bundleComponents } from '../bundleComponents.js';
import { makeSurfaceEntry } from '../../surface/__fixtures__/makeSurfaceEntry.js';

class FakeBundler implements Bundler {
    readonly requests: BundleRequest[] = [];

    constructor(
        private readonly outputs: Readonly<Record<string, string>>,
        private readonly inputs: Readonly<Record<string, readonly string[]>> = {},
    ) {}

    bundle(request: BundleRequest): Promise<BundleResult> {
        this.requests.push(request);

        return Promise.resolve({
            script: this.outputs[request.platform] ?? '',
            inputs: this.inputs[request.platform] ?? [],
        });
    }
}

const surface: Surface = {
    web: [
        makeSurfaceEntry('Button', { file: '/ui/Button.tsx' }),
        makeSurfaceEntry('Chip', { file: '/ui/Chip.tsx' }),
        makeSurfaceEntry('useSnackbar', { file: '/ui/useSnackbar.ts' }),
    ],
    native: [makeSurfaceEntry('Button', { file: '/ui/Button.native.tsx' })],
};

describe('bundleComponents', () => {
    const outputs = { web: 'var __CommiseWeb = {Button:1};', native: 'var __CommiseNative = {Button:2};' };

    it('asks the bundler for one web and one native bundle, each from its own entry module', async () => {
        const bundler = new FakeBundler(outputs);

        await bundleComponents(surface, bundler);

        expect(bundler.requests.map((r) => [r.platform, r.globalName])).toEqual([
            ['web', '__CommiseWeb'],
            ['native', '__CommiseNative'],
        ]);
        expect(bundler.requests[0]?.entrySource).toContain('export { Button } from "/ui/Button.js";');
        expect(bundler.requests[1]?.entrySource).toContain('export { Button } from "/ui/Button.native.js";');
        expect(bundler.requests[0]?.resolveDir).toMatch(/\/web$/u);
        expect(bundler.requests[1]?.resolveDir).toMatch(/\/mobile$/u);
    });

    it('assembles header, bridge, web, native, then the window.Commise assignment', async () => {
        const { script: text } = await bundleComponents(surface, new FakeBundler(outputs));

        const positions = [
            text.indexOf('/* @ds-bundle:'),
            text.indexOf(REACT18_BRIDGE_SOURCE.trim()),
            text.indexOf(outputs.web),
            text.indexOf(outputs.native),
            text.indexOf('window.Commise = Object.assign({}, __CommiseWeb, { Native: __CommiseNative });'),
        ];

        expect(positions.every((p) => p >= 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(text.startsWith('/* @ds-bundle:')).toBe(true);
    });

    it('lists only components in the header, not hooks', async () => {
        const { script: text } = await bundleComponents(surface, new FakeBundler(outputs));
        const header = text.slice(0, text.indexOf('\n'));

        expect(header).toContain('{"name":"Button"},{"name":"Chip"}');
        expect(header).not.toContain('useSnackbar');
    });

    it('embeds the bridge source verbatim', async () => {
        const { script: text } = await bundleComponents(surface, new FakeBundler(outputs));

        expect(text).toContain(REACT18_BRIDGE_SOURCE.trim());
    });

    it('escapes script terminators from the bundler output, comments and strings alike', async () => {
        const { script: text } = await bundleComponents(
            surface,
            new FakeBundler({ web: 'var __CommiseWeb = "</script><!--";', native: 'var __CommiseNative = {};' }),
        );

        expect(text).not.toMatch(/<\/script/iu);
        expect(text).not.toContain('<!--');
        expect(text).toContain('<\\/script>\\x3C!--');
    });

    it('runs the platform builds one after the other, web first', async () => {
        const order: string[] = [];
        const bundler: Bundler = {
            async bundle(request) {
                order.push(`start:${request.platform}`);
                await Promise.resolve();
                order.push(`end:${request.platform}`);

                return { script: '', inputs: [] };
            },
        };

        await bundleComponents(surface, bundler);

        expect(order).toEqual(['start:web', 'end:web', 'start:native', 'end:native']);
    });

    it('returns the directories of both platforms’ inputs as the stylesheet’s source roots', async () => {
        const { sourceRoots } = await bundleComponents(
            surface,
            new FakeBundler(outputs, {
                web: ['/r/ui/src/Button.tsx', '/r/ui/src/deep/Chip.tsx'],
                native: ['/r/ui/src/Button.native.tsx', '/r/features/recipes/src/x.ts'],
            }),
        );

        expect(sourceRoots).toEqual(['/r/features/recipes/src', '/r/ui/src']);
    });
});
