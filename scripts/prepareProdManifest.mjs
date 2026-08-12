#!/usr/bin/env node
/**
 * Generate a deployable service's `prod.package.json` from the `package.json` it is derived from.
 *
 * ## What this manifest is, and why a wrong one is quiet
 *
 * The Docker image installs `prod.package.json` OVER the dev manifest: same package, but exporting the compiled
 * `./dist` instead of `./src`, with `devDependencies` and `scripts` stripped. It is NOT what installs the
 * dependencies — the image COPYs the repo-root `node_modules` and never runs `npm install` — so a wrong
 * dependency list does not crash the container. It is a DECLARATION: read by humans, by audits, and by anything
 * reasoning about what the image ships. Which is exactly why it drifts unnoticed; nothing fails.
 *
 * ## Why ONE script rather than one per service
 *
 * `food-service` and `identity` each carried a byte-identical copy of this logic (`docker-prepare.js`), and
 * `recipe-service` had none at all — so its manifest was hand-maintained and had drifted by eight declared
 * runtime dependencies plus a wrong `main`. Adding a third copy would have made the duplication worse; the
 * generator is ONE piece of knowledge ("what a production manifest is") and now has one home, next to the
 * repo's other cross-cutting scripts (`contractGenerate.mjs`, `contractDriftGate.mjs`, `pr-scope.sh`).
 *
 * `prod-manifest-parity.test.ts` remains the complementary guard: it checks the CONTENTS of every committed
 * manifest, so it catches a generator that was never re-run just as well as a hand edit. The generator removes
 * the need to hand-maintain; the guard proves the result is true.
 *
 * ## The two path rules that look wrong and are not
 *
 *  - `./dist/src/main.js`, not `./dist/main.js`. Both `nest build` (food, identity) and recipe's
 *    `tsc -p tsconfig.build.json` compile with `rootDir: "."`, so the `src/` segment is PRESERVED under
 *    `outDir`. This matches the Dockerfile `CMD` and the ECS task command.
 *  - `./dist/src/main.d.ts` for `types`. A `types` entry is supposed to be a declaration file.
 *
 * ## Usage
 *
 *     node ../../../scripts/prepareProdManifest.mjs        # target = process.cwd()
 *     node scripts/prepareProdManifest.mjs <packageDir>    # target = explicit directory
 *
 * @sideEffect Reads `<packageDir>/package.json` and writes `<packageDir>/prod.package.json`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Rewrite every `./src/...ts` export path to the compiled `./dist/src/...js` it becomes in the image.
 *
 * Pure. Non-string entries (conditional-export objects) and paths that are already `./dist` are passed through
 * untouched — this rewrites what it recognizes and never guesses at the rest.
 *
 * @param {Record<string, unknown> | undefined} exports - The dev manifest's `exports` map, if it has one.
 * @returns {Record<string, unknown> | undefined} The rewritten map, or `undefined` when there was none.
 */
export function rewriteExports(exports) {
    if (exports === undefined) {
        // IMPORTANT: return `undefined`, never `{}`. An empty `exports` map does not mean "no exports" to node —
        // it BLOCKS every import of the package. `recipe-service` declares no `exports`, so a generator that
        // emitted `{}` for it would have produced a manifest that cannot be imported at all.
        return undefined;
    }

    /** @type {Record<string, unknown>} */
    const rewritten = {};

    for (const [key, value] of Object.entries(exports)) {
        rewritten[key] =
            typeof value === 'string' && value.startsWith('./src/')
                ? value.replace(/^\.\/src\//u, './dist/src/').replace(/\.ts$/u, '.js')
                : value;
    }

    return rewritten;
}

/**
 * Derive the production manifest from a dev manifest.
 *
 * Pure — separated from the file I/O below so it can be tested without a filesystem.
 *
 * @param {Record<string, unknown>} pkg - The parsed dev `package.json`.
 * @returns {Record<string, unknown>} The production manifest object.
 */
export function toProductionManifest(pkg) {
    const rewrittenExports = rewriteExports(/** @type {Record<string, unknown> | undefined} */ (pkg.exports));

    const productionPkg = {
        ...pkg,
        ...(rewrittenExports === undefined ? {} : { exports: rewrittenExports }),
        main: './dist/src/main.js',
        types: './dist/src/main.d.ts',
    };

    // Neither belongs in an image: the dev dependencies are pruned before the build, and the scripts reference
    // tooling (`nest`, `tsc`, `tsx`) the runtime image does not contain.
    Reflect.deleteProperty(productionPkg, 'devDependencies');
    Reflect.deleteProperty(productionPkg, 'scripts');

    return productionPkg;
}

/**
 * Read a package's dev manifest, derive the production one, and write it alongside.
 *
 * @param {string} packageDir - The package directory.
 * @returns {string} The path written.
 * @sideEffect Reads and writes files.
 */
export function writeProductionManifest(packageDir) {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const outPath = join(packageDir, 'prod.package.json');

    writeFileSync(outPath, `${JSON.stringify(toProductionManifest(pkg), null, 4)}\n`);

    return outPath;
}

// Only act when invoked as a CLI, so the pure helpers above can be imported by the tests.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
    const target = process.argv[2] ?? process.cwd();
    console.log(`Wrote production package.json to ${writeProductionManifest(target)}`);
}
