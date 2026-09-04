// @vitest-environment node
/**
 * Repo-wide guard: a deployable service's `prod.package.json` must agree with the `package.json` it is derived
 * from.
 *
 * ## What this manifest is, and why a wrong one is quiet
 *
 * The Docker image installs `prod.package.json` over the dev manifest: same package, but exporting the compiled
 * `./dist` instead of `./src`, with `devDependencies` and `scripts` removed. It is NOT what installs the
 * dependencies — the image COPYs the repo-root `node_modules` and never runs `npm install` — so a wrong dependency
 * list does not crash the container. It is a DECLARATION, read by humans, by audits, and by anything that reasons
 * about what the image ships. Which is exactly why it drifts unnoticed: nothing fails.
 *
 * Measured drift at the time this guard was written:
 *
 *  - `recipe-service`'s manifest omitted EIGHT declared runtime dependencies, including `@kitchensink/schema-recipe`
 *    and `nestjs-zod` — both imported at runtime — and pinned `@nestjs/platform-express` to `^11.0.0` while the
 *    workspace resolved `^11.1.28`.
 *  - `food-service`'s once declared `zod ^3.24.0` while the service ran `^4.4.3`, i.e. it named a MAJOR version
 *    the code could not work with.
 *
 * All three now GENERATE theirs from ONE script, `scripts/prepareProdManifest.mjs`, invoked as each service's
 * `docker:prepare`. That replaced two byte-identical per-service copies (`docker-prepare.js` in `food-service`
 * and `identity`) plus `recipe-service`'s hand-maintained manifest — which is how recipe's came to omit eight
 * declared runtime dependencies and to point `main` at `./dist/main.js`, a path the build does not emit.
 *
 * This guard stays a check on the CONTENTS rather than a re-implementation of the generator: it holds all three
 * to the same rule and it catches a generator that was NOT RE-RUN exactly as well as a hand edit — which is the
 * failure mode that remains now that generation is a deploy-time step rather than a commit-time one.
 * `serviceDockerfileDeps.test.ts` is the complementary half — it checks that the image CONTAINS each shared
 * dependency's `dist` (transitively); this one checks that the manifest describing the image is true.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const servicesRoot = path.join(repoRoot, 'packages/services');

/** A package manifest, as far as this guard reads it. */
interface Manifest {
    readonly name?: string;
    readonly type?: string;
    readonly main?: string;
    readonly types?: string;
    readonly engines?: Record<string, string>;
    readonly exports?: Record<string, unknown>;
    readonly scripts?: Record<string, string>;
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
}

/** Deployable services = `packages/services/*` that ship both a Dockerfile and a production manifest. */
const deployable = readdirSync(servicesRoot, { withFileTypes: true })
    .filter(
        (entry) =>
            entry.isDirectory() &&
            existsSync(path.join(servicesRoot, entry.name, 'Dockerfile')) &&
            existsSync(path.join(servicesRoot, entry.name, 'prod.package.json')),
    )
    .map((entry) => entry.name)
    .sort();

/** Read a service's dev and production manifests. */
function manifestsOf(service: string): { dev: Manifest; prod: Manifest } {
    return {
        dev: JSON.parse(readFileSync(path.join(servicesRoot, service, 'package.json'), 'utf8')) as Manifest,
        prod: JSON.parse(readFileSync(path.join(servicesRoot, service, 'prod.package.json'), 'utf8')) as Manifest,
    };
}

describe('prod.package.json agrees with the manifest it is derived from', () => {
    it('finds every deployable service, so the assertions below are not vacuous', () => {
        expect(deployable).toStrictEqual(['food-service', 'identity', 'recipe-service']);
    });

    // THE measured drift, in both directions: a dependency the image really needs that the manifest omits, and a
    // version range the manifest states that the workspace does not resolve.
    it.each(deployable)(
        '%s declares exactly the runtime dependencies of its dev manifest, at the same ranges',
        (service) => {
            const { dev, prod } = manifestsOf(service);
            const devDependencies = dev.dependencies ?? {};
            const prodDependencies = prod.dependencies ?? {};

            const problems = [
                ...Object.entries(devDependencies)
                    .filter(([name]) => prodDependencies[name] === undefined)
                    .map(([name]) => `${name} is a declared runtime dependency but is MISSING from prod.package.json`),
                ...Object.entries(devDependencies)
                    .filter(([name, range]) => prodDependencies[name] !== undefined && prodDependencies[name] !== range)
                    .map(
                        ([name, range]) =>
                            `${name} is '${range}' in package.json but '${String(prodDependencies[name])}' in ` +
                            'prod.package.json — the image runs the workspace-resolved version, so the manifest lies',
                    ),
                ...Object.keys(prodDependencies)
                    .filter((name) => devDependencies[name] === undefined)
                    .map(
                        (name) =>
                            `${name} is declared in prod.package.json but not in package.json, so it is not installed`,
                    ),
            ];

            expect(problems).toStrictEqual([]);
        },
    );

    it.each(deployable)('%s ships no devDependencies and no scripts in the image manifest', (service) => {
        const { prod } = manifestsOf(service);

        expect(prod.devDependencies).toBeUndefined();
        expect(prod.scripts).toBeUndefined();
    });

    // The whole reason a separate manifest exists: the dev one points consumers at `./src` so they compile against
    // source, and the image has no `src`. An entry point left pointing at it is `ERR_MODULE_NOT_FOUND` at boot.
    it.each(deployable)('%s points every entry point at the compiled dist, never at src', (service) => {
        const { prod } = manifestsOf(service);
        const entryPoints = [prod.main, prod.types, ...Object.values(prod.exports ?? {})].filter(
            (value): value is string => typeof value === 'string',
        );

        // Two paths that LOOK wrong and are not: `./dist/src/main.js` keeps the `src/` segment because
        // `nest build` uses `rootDir: "."`, and `./dist/src/main.d.ts` is a declaration file, which is what a
        // `types` entry is supposed to be. What is forbidden is an entry still rooted at `./src/`, or a
        // non-declaration `.ts` the image does not contain.
        expect(entryPoints.length).toBeGreaterThan(0);
        expect(
            entryPoints.filter(
                (entry) => entry.startsWith('./src/') || (entry.endsWith('.ts') && !entry.endsWith('.d.ts')),
            ),
        ).toStrictEqual([]);
        expect(prod.main).toMatch(/^\.\/dist\//u);
    });

    // A `^./dist/` prefix check is NOT enough, and `recipe-service` proved it: its manifest said
    // `./dist/main.js` — matching that prefix perfectly — while the build emits `./dist/src/main.js`. It was not
    // a boot failure only because the Dockerfile CMD and the ECS command both spell the real path, so the wrong
    // one sat there being wrong. All three services compile with `rootDir: "."`, so the `src/` segment is
    // preserved and there is exactly ONE correct value; pinning it is also what holds each committed manifest to
    // `scripts/prepareProdManifest.mjs` having actually been re-run.
    it.each(deployable)('%s names the exact compiled entry point the build emits', (service) => {
        const { prod } = manifestsOf(service);

        expect(prod.main).toBe('./dist/src/main.js');
        expect(prod.types).toBe('./dist/src/main.d.ts');
    });

    // The dev manifest is the other half of the same rule: it exists so a consumer compiles against SOURCE.
    // recipe-service's pointed at `./dist/main.js` — a build output, and one that is never produced.
    it.each(deployable)('%s dev manifest points at source, never at a build output', (service) => {
        const { dev } = manifestsOf(service);
        const devEntryPoints = [dev.main, dev.types, ...Object.values(dev.exports ?? {})].filter(
            (value): value is string => typeof value === 'string',
        );

        expect(devEntryPoints.filter((entry) => entry.startsWith('./dist'))).toStrictEqual([]);
    });

    // `type` is not cosmetic: a production manifest that lost `"type": "module"` makes node parse the compiled
    // ESM as CommonJS and the container dies on the first `import`.
    it.each(deployable)('%s keeps the identity fields that change how node loads the code', (service) => {
        const { dev, prod } = manifestsOf(service);

        expect(prod.name).toBe(dev.name);
        expect(prod.type).toBe(dev.type);
        expect(prod.engines).toStrictEqual(dev.engines);
    });

    /**
     * ⛔ ADDED AFTER THIS GUARD MISSED THE SAME BUG IT WAS WRITTEN FOR. The docstring above records
     * `food-service` once declaring `zod ^3.24.0` while the service ran `^4.4.3`. On 2026-08-27 that exact
     * drift was found again — this time in `packages/clients/usda`, whose manifest said `^3.24.0` while its
     * own `package.json`, every sibling manifest in the same image, and the `dist` it was compiled against
     * all said `^4.4.3`.
     *
     * The scope above is why it was invisible: it reads `packages/services` only. But a service's Dockerfile
     * COPYs the production manifest of every shared package it ships — `food-service/Dockerfile` line 18 is
     * literally `COPY packages/clients/usda/prod.package.json` — so a client or shared package's manifest is
     * every bit as much a description of the image, and drifts under exactly the same silence.
     *
     * ⛔ SO THIS ONE ENUMERATES NOTHING. It finds every `prod.package.json` in the workspace rather than
     * naming a directory, which is the difference between a guard that covers what exists and a guard that
     * covers what someone remembered.
     */
    /**
     * ⛔ WIDENED A SECOND TIME (2026-09-04, PR #91 review). The check above caught only a RANGE that disagreed;
     * it said nothing about a dependency that was simply ABSENT — and that is the older of the two drifts
     * this file's own docstring opens with ("omitted EIGHT declared runtime dependencies"). Measured when this
     * was widened: `packages/schemas/recipe/prod.package.json` declared only `zod` while its sources import
     * `@kitchensink/recipe-core` and `@kitchensink/schema-food` at runtime (and `recipe-service/Dockerfile`
     * line 48 COPYs that manifest into the image); `shared/identity-db` omitted `@kitchensink/identity-core`
     * (COPY'd by `identity/Dockerfile`); `recipe-workers` and `recipe-import-core` omitted most of theirs.
     * So the repo-wide rule is now the SAME three-way rule the per-service test applies: nothing omitted,
     * nothing extra, no range disagreement.
     */
    it('holds EVERY production manifest to the same parity, not just the deployable services', () => {
        const manifests = globSync('packages/**/prod.package.json', {
            cwd: repoRoot,
            ignore: ['**/node_modules/**', '**/dist/**'],
        }).sort();

        // Anti-vacuity: a glob that matched nothing would satisfy the assertion below in silence, and the
        // widened scope must strictly exceed the three deployables the tests above already cover.
        expect(manifests.length).toBeGreaterThan(deployable.length);

        const problems = manifests.flatMap((prodPath) => {
            const devPath = path.join(path.dirname(prodPath), 'package.json');
            const prod = JSON.parse(readFileSync(path.join(repoRoot, prodPath), 'utf8')) as Manifest;
            const dev = JSON.parse(readFileSync(path.join(repoRoot, devPath), 'utf8')) as Manifest;
            const devDependencies = dev.dependencies ?? {};
            const prodDependencies = prod.dependencies ?? {};

            return [
                ...Object.keys(devDependencies)
                    .filter((name) => prodDependencies[name] === undefined)
                    .map(
                        (name) =>
                            `${prodPath}: ${name} is a declared runtime dependency but is MISSING from the ` +
                            'production manifest',
                    ),
                ...Object.entries(prodDependencies)
                    .filter(([name, range]) => devDependencies[name] !== undefined && devDependencies[name] !== range)
                    .map(
                        ([name, range]) =>
                            `${prodPath}: ${name} is '${range}' here but '${String(devDependencies[name])}' in ` +
                            'package.json — the image ships the workspace-resolved version, so the manifest lies',
                    ),
                ...Object.keys(prodDependencies)
                    .filter((name) => devDependencies[name] === undefined)
                    .map(
                        (name) =>
                            `${prodPath}: ${name} is declared in the production manifest but not in package.json, ` +
                            'so it is not installed',
                    ),
            ];
        });

        expect(problems, problems.join('\n')).toStrictEqual([]);
    });
});
