import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundle the in-VPC migration-runner Lambda (feature 001) into a self-contained ESM file under
 * `dist-lambda/`, mirroring the `src/` layout so the CDK `handler:` string (`lambdas/migrate/handler.
 * handler`) resolves. Mirrors the food service's esbuild. `Code.fromAsset` carries no `node_modules`, so
 * every dependency (pg, drizzle, the recipe schema, `@aws-sdk/rds-signer` for the IAM auth token) is
 * inlined; only `pg-native` (pg's optional native binding we never use) is left external.
 */
const entryPoints = ['src/lambdas/migrate/handler.ts', 'src/lambdas/seed/handler.ts'];

await build({
    entryPoints,
    outdir: 'dist-lambda',
    outbase: 'src',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    external: ['pg-native'],
    banner: {
        js: [
            "import { createRequire as __createRequire } from 'node:module';",
            "import { fileURLToPath as __fileURLToPath } from 'node:url';",
            "import { dirname as __pathDirname } from 'node:path';",
            'const require = __createRequire(import.meta.url);',
            'const __filename = __fileURLToPath(import.meta.url);',
            'const __dirname = __pathDirname(__filename);',
        ].join('\n'),
    },
    logLevel: 'info',
});

writeFileSync('dist-lambda/package.json', `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

// Ship the recipe migration SQL alongside the bundle so the migrate Lambda reads it at runtime
// (lambdas/migrate/handler.ts → ../../migrations). src/database/migrations stays the single source of
// truth; this is a build-time file copy. Discovery is by readdir+sort, so adding a .sql is picked up.
const pkgRoot = dirname(fileURLToPath(import.meta.url));
const migrationsSrc = join(pkgRoot, 'src', 'database', 'migrations');
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
