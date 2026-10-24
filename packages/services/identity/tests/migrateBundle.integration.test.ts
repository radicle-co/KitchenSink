/**
 * Integration guard on the ONE thing neither the unit nor the DB tier can see: that the Lambda BUNDLE
 * puts the migration SQL exactly where the bundled handler looks for it.
 *
 * The handler resolves its migrations RELATIVE TO ITS OWN LOCATION (`../../migrations`), and `esbuild.mjs`
 * copies them there as a build step. The two facts live in different files and nothing but this test makes
 * them agree. Get it wrong and the failure is not a build error — `readdirSync` throws at RUNTIME, inside
 * the in-deploy trigger, on a deploy that had already built and published everything.
 *
 * A worse variant is possible and is what makes this tier necessary rather than nice: if the directory
 * exists but is EMPTY, the runner discovers nothing, applies nothing, validates nothing, and returns a
 * clean result. That is indistinguishable from "no migrations were pending" — the exact silent no-op the
 * whole in-deploy gate exists to remove. The suites that migrate from `src/database/migrations` cannot
 * catch either case, because they never read the bundle.
 *
 * Runs the real bundler (~1s) rather than asserting on `esbuild.mjs`'s text: the subject is the artifact.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceMigrationsDir = join(packageRoot, 'src/database/migrations');
const bundleRoot = join(packageRoot, 'dist-lambda');

/** Where the CDK stack's `handler: 'lambdas/migrate/handler.handler'` string resolves inside the asset. */
const bundledHandler = join(bundleRoot, 'lambdas/migrate/handler.js');

describe('the migration Lambda bundle', () => {
    beforeAll(() => {
        // ⛔ The previous build is DELETED first. Without this the suite measures whatever `dist-lambda/`
        // happened to contain, and a bundler that had stopped copying the SQL entirely passed — because a
        // developer machine (unlike a CI checkout) still had yesterday's copy sitting there. Measured, not
        // theorised: that is exactly how the missing `rmSync` in `esbuild.mjs` was found.
        rmSync(bundleRoot, { recursive: true, force: true });
        // The real build, not a fixture. `stdio: 'pipe'` keeps esbuild's banner out of the test output; a
        // non-zero exit throws and fails the suite, which is the correct outcome for a broken bundler.
        execFileSync('node', ['esbuild.mjs'], { cwd: packageRoot, stdio: 'pipe' });
    }, 120_000);

    it('emits the handler at the path the CDK stack names', () => {
        expect(
            existsSync(bundledHandler),
            `${bundledHandler} is what \`lambdas/migrate/handler.handler\` resolves to`,
        ).toBe(true);
    });

    it('ships every migration where the bundled handler looks for it, byte for byte', () => {
        // Derived the SAME way the handler derives it: `join(dirname(import.meta.url), '..', '..', 'migrations')`.
        // Restating the literal path would let the two drift and still pass.
        const asTheHandlerResolvesIt = join(dirname(bundledHandler), '..', '..', 'migrations');
        const sourceFiles = readdirSync(sourceMigrationsDir).filter((file) => file.endsWith('.sql'));

        // Non-vacuity: an empty source directory would satisfy every loop below while shipping nothing.
        expect(sourceFiles.length, 'the identity service must have migrations to ship').toBeGreaterThan(0);
        expect(existsSync(asTheHandlerResolvesIt)).toBe(true);

        const bundledFiles = readdirSync(asTheHandlerResolvesIt).filter((file) => file.endsWith('.sql'));

        expect([...bundledFiles].sort()).toEqual([...sourceFiles].sort());

        for (const file of sourceFiles) {
            expect(readFileSync(join(asTheHandlerResolvesIt, file), 'utf8'), `${file} must ship unmodified`).toBe(
                readFileSync(join(sourceMigrationsDir, file), 'utf8'),
            );
        }
    });

    it('⛔ ships no STALE migration — the bundle is replaced, never merged into', () => {
        // `dist-lambda/` survives between builds, so a copy step that only ADDS files keeps shipping SQL
        // that has been deleted or RENAMED upstream. The rename case is the dangerous one: the same
        // statements ship under two filenames, so `schema_migrations` records two keys and the body runs
        // TWICE — on a fresh database, against an object the first copy already created.
        const stale = join(bundleRoot, 'migrations', '9999_deleted_upstream.sql');

        writeFileSync(stale, 'SELECT 1;');
        execFileSync('node', ['esbuild.mjs'], { cwd: packageRoot, stdio: 'pipe' });

        expect(existsSync(stale), 'a migration removed from source must not survive in the bundle').toBe(false);
    });

    it('marks the asset as ESM, or the function dies at init', () => {
        // Without `{"type":"module"}` Node reads the emitted `import` statements as CommonJS and the runtime
        // fails on the first invocation — which, for this function, is the one gating a production deploy.
        const marker = JSON.parse(readFileSync(join(bundleRoot, 'package.json'), 'utf8')) as { type?: string };

        expect(marker.type).toBe('module');
    });
});
