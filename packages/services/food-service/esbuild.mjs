import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESM_PACKAGE_JSON, LAMBDA_BUNDLE_OPTIONS } from './lambdaBundleOptions.mjs';
import { buildSeedAsset } from './seedAssetBuild.mjs';

/**
 * Bundle food's two pipeline-only Lambdas, each into its own asset directory (`lambdaBundleOptions.mjs` holds what
 * the two bundles share):
 *
 * - the in-VPC migration runner (T-191 / FU-MIGRATE) → `dist-lambda/`, mirroring the `src/` layout so the CDK
 *   `handler:` string (`lambdas/migrate/handler.handler`) resolves, with the migrations copied beside it;
 * - the catalog seed function (curated catalog plan U3) → `distSeed/`, built by `seedAssetBuild.mjs`. Its own
 *   directory, because the seed digest names the whole tree, and a migration edit must not move it.
 *
 * Neither is the service's main `dist/` (the NestJS API + worker `node dist/...` build): each Lambda asset ships
 * separately via `Code.fromAsset`.
 */
const entryPoints = ['src/lambdas/migrate/handler.ts'];

await build({
    ...LAMBDA_BUNDLE_OPTIONS,
    entryPoints,
    outdir: 'dist-lambda',
    logLevel: 'info',
});

writeFileSync('dist-lambda/package.json', ESM_PACKAGE_JSON);

// Ship the food migration SQL alongside the bundle so the migrate Lambda reads it at runtime
// (lambdas/migrate/handler.ts → ../../migrations). src/db/migrations stays the single source of truth;
// this is a build-time file copy, not a module import. Discovery is by readdir+sort, so adding a .sql
// here is picked up automatically.
const pkgRoot = dirname(fileURLToPath(import.meta.url));
const migrationsSrc = join(pkgRoot, 'src', 'db', 'migrations');
// ⛔ EMPTIED first, never merged into. `dist-lambda/` is not cleaned between builds, so a copy that merely
// adds files leaves yesterday's `.sql` in place: a migration that was RENAMED would ship under both names
// and be applied twice under two different `schema_migrations` keys, and a deleted one would keep shipping.
// It also makes a broken copy step invisible on a machine that had built before.
rmSync('dist-lambda/migrations', { recursive: true, force: true });
mkdirSync('dist-lambda/migrations', { recursive: true });
const sqlFiles = readdirSync(migrationsSrc).filter((file) => file.endsWith('.sql'));

if (sqlFiles.length === 0) {
    // ⛔ A bundle with no SQL is a runner that reports a clean run having applied nothing — the exact silent
    // no-op ADR-0022 exists to remove, and `@kitchensink/db-schema-guard` refuses to digest for the same
    // reason (`sha256('')` is a well-formed digest, so an empty bundle would AGREE with an empty tree).
    // Fail the BUILD rather than ship it: this is the earliest point the mistake is visible.
    throw new Error(`No .sql migrations found in ${migrationsSrc} — refusing to ship an empty migration bundle`);
}

for (const file of sqlFiles) {
    copyFileSync(join(migrationsSrc, file), join('dist-lambda/migrations', file));
}

console.log(
    `bundled ${entryPoints.length} handler + ${sqlFiles.length} migrations to dist-lambda/ + wrote dist-lambda/package.json {"type":"module"}`,
);

const seed = await buildSeedAsset({ packageRoot: pkgRoot, outdir: join(pkgRoot, 'distSeed') });

console.log(
    `bundled the seed handler + ${seed.dataFiles} data files + ${seed.sqlFiles} verifier SQL files to distSeed/`,
);
