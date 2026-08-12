// @vitest-environment node
/**
 * Unit tests for `scripts/prepareProdManifest.mjs` — the ONE generator that derives every deployable service's
 * `prod.package.json` from its dev manifest.
 *
 * Tested here rather than beside the script because that is where this repo tests its root `scripts/` (see
 * `pr-scope.test.ts` and `deploy-gate.test.ts`), and because the generator is a deploy-path artifact: a wrong
 * manifest is not caught by any build, only by `prod-manifest-parity.test.ts` reading the result.
 *
 * The case that matters most is `exports`. This script replaced two per-service copies whose logic did
 * `{ ...pkg, exports: rewritten }` unconditionally — correct for the two services that HAVE an `exports` map,
 * and a live hazard for `recipe-service`, which has none: it would have emitted `"exports": {}`, and an empty
 * exports map does not mean "no exports" to node, it BLOCKS every import of the package. Nothing imports
 * `@kitchensink/recipe-service` today, so that would have been a silent landmine rather than a failure — which
 * is exactly the kind of thing this suite exists to stop.
 */
import { describe, expect, it } from 'vitest';

import { rewriteExports, toProductionManifest } from '../../../../scripts/prepareProdManifest.mjs';

describe('rewriteExports', () => {
    // The landmine. `undefined`, never `{}`.
    it('returns undefined (never an empty map) when the dev manifest declares no exports', () => {
        expect(rewriteExports(undefined)).toBeUndefined();
    });

    it('rewrites every ./src/*.ts export to the compiled ./dist/src/*.js', () => {
        expect(
            rewriteExports({
                '.': './src/index.ts',
                './db/schema': './src/db/schema/index.ts',
                './types/*': './src/types/*.ts',
            }),
        ).toStrictEqual({
            '.': './dist/src/index.js',
            './db/schema': './dist/src/db/schema/index.js',
            './types/*': './dist/src/types/*.js',
        });
    });

    // Rewrite what it recognizes; never guess at the rest. A conditional-export object or an already-compiled
    // path passed through a naive `.replace` chain is how a manifest silently acquires a broken entry.
    it('passes through non-string and already-compiled entries untouched', () => {
        const exports = {
            '.': { types: './dist/index.d.ts', default: './dist/index.js' },
            './already': './dist/src/already.js',
            './asset': './openapi.yaml',
        };

        expect(rewriteExports(exports)).toStrictEqual(exports);
    });
});

describe('toProductionManifest', () => {
    /** A dev manifest shaped like the real ones: exports source, has scripts + devDependencies. */
    const dev = {
        name: '@kitchensink/some-service',
        version: '0.0.0',
        private: true,
        type: 'module',
        exports: { '.': './src/index.ts' },
        scripts: { build: 'nest build', 'docker:prepare': 'node ../../../scripts/prepareProdManifest.mjs' },
        dependencies: { pg: '^8.13.0' },
        devDependencies: { typescript: '^5.9.3' },
        engines: { node: '24.x' },
    };

    it('points the entry points at the compiled dist, keeping the rootDir "." src/ segment', () => {
        const prod = toProductionManifest(dev);

        // `./dist/src/main.js`, not `./dist/main.js`: every service compiles with `rootDir: "."`, so the `src/`
        // segment is preserved under `outDir`. This is the path the Dockerfile CMD and the ECS command use.
        expect(prod.main).toBe('./dist/src/main.js');
        expect(prod.types).toBe('./dist/src/main.d.ts');
        expect(prod.exports).toStrictEqual({ '.': './dist/src/index.js' });
    });

    it('strips devDependencies and scripts, which no image should carry', () => {
        const prod = toProductionManifest(dev);

        expect(prod).not.toHaveProperty('devDependencies');
        expect(prod).not.toHaveProperty('scripts');
    });

    // `type: module` is not cosmetic — losing it makes node parse the compiled ESM as CommonJS and the container
    // dies on its first `import`. `name`/`engines` are what audits read.
    it('preserves the identity fields that change how node loads the code', () => {
        const prod = toProductionManifest(dev);

        expect(prod.name).toBe(dev.name);
        expect(prod.type).toBe('module');
        expect(prod.engines).toStrictEqual({ node: '24.x' });
        expect(prod.dependencies).toStrictEqual({ pg: '^8.13.0' });
    });

    it('omits exports entirely for a service that declares none, rather than emitting a blocking {}', () => {
        const { exports: _exports, ...noExports } = dev;

        expect(toProductionManifest(noExports)).not.toHaveProperty('exports');
    });

    it('does not mutate the manifest it was given', () => {
        const input = structuredClone(dev);

        toProductionManifest(input);

        expect(input).toStrictEqual(dev);
    });
});
