// @vitest-environment node
/**
 * Unit tests for `scripts/prepareProdManifest.mjs` — the ONE generator that derives every deployable service's
 * `prod.package.json` from its dev manifest.
 *
 * Tested here rather than beside the script because that is where this repo tests its root `scripts/` (see
 * `prScope.test.ts` and `deployGate.test.ts`), and because the generator is a deploy-path artifact: a wrong
 * manifest is not caught by any build, only by `prodManifestParity.test.ts` reading the result.
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

/**
 * ⛔ THE SUBPATH THAT VANISHED. `exports` is parsed from a `package.json`, so its keys are data — and
 * rebuilding onto an object LITERAL sent a subpath named `__proto__` to `Object.prototype`'s inherited
 * setter, dropping it from the production manifest instead of rewriting it. This generator derives every
 * deployable service's shipped manifest, so the only symptom would be an import failing at runtime inside
 * the built image, with nothing in the build to point at.
 *
 * ⚠️ A `__proto__` subpath is not something this repository declares today. That is the reason to assert
 * it rather than a reason not to: the sink is a property of the CODE, and the guard that finds this class
 * repo-wide (`prototypePollutionSinks.test.ts`) had `.mjs` outside its stated scope, so nothing else here
 * would have seen it.
 */
describe('rewriteExports keeps a `__proto__` subpath as DATA', () => {
    it('⛔ rewrites it rather than dropping it into the prototype', () => {
        // ⚠️ `Object.fromEntries`, NOT an object literal with a computed `__proto__` key. The literal form
        // reads to CodeQL as an attempt to SET a prototype (`js/invalid-prototype-value`, error severity),
        // which is a different thing from the DATA this asserts — the same distinction `otlp.test.ts` makes
        // by parsing a string rather than writing the literal.
        // ⛔ A CONDITION OBJECT, NOT A STRING, and the fixture shape is what gives the prototype assertion
        // below any teeth at all. Assigning a STRING to `__proto__` is a silent no-op, so with a string
        // value the sink leaves the prototype untouched and only `hasOwn` reacts; an OBJECT is what the
        // literal's inherited setter actually installs. It is also the realistic shape — `exports` entries
        // are condition maps — and it passes `rewriteExports`' `typeof value === 'string'` branch untouched,
        // so it exercises the sink without depending on the rewrite.
        const rewritten =
            rewriteExports(
                Object.fromEntries([
                    ['__proto__', { require: './src/x.ts' }],
                    ['./safe', './src/y.ts'],
                ]),
            ) ?? {};

        expect(Object.hasOwn(rewritten, '__proto__')).toBe(true);
        expect(rewritten['./safe']).toBe('./dist/src/y.js');
        // ⛔ THE PROTOTYPE ITSELF, not a probe of an unrelated object. The `expect(({} as …)['polluted'])`
        // this replaces could never fail: nothing writes `polluted`, so it passed even when the subpath was
        // dropped entirely — the exact case the test exists for.
        expect(Object.getPrototypeOf(rewritten)).toBe(Object.prototype);
    });
});
