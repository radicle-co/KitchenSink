import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundle the in-VPC migration-runner Lambda (T-191 / FU-MIGRATE) into a self-contained ESM file under
 * `dist-lambda/`, mirroring the `src/` layout so the CDK `handler:` string (`lambdas/migrate/handler.
 * handler`) resolves. The output dir is deliberately NOT the service's main `dist/` (which holds the
 * NestJS API + worker `node dist/...` build) — the Lambda asset is shipped separately via
 * `Code.fromAsset('dist-lambda')`.
 *
 * `Code.fromAsset` carries no `node_modules`, so every dependency (pg, drizzle, the food schema,
 * `@aws-sdk/rds-signer` for the IAM auth token) is inlined here. `@aws-sdk/rds-signer` is NOT reliably
 * present in the Node 22 Lambda runtime SDK, so — unlike the commonly-provided clients — it must be
 * bundled; only `pg-native` (pg's optional native binding we never use) is left external. The
 * `dist-lambda/package.json` `{"type":"module"}` marker makes Node load the emitted `.js` as ESM.
 */
const entryPoints = ['src/lambdas/migrate/handler.ts'];

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
    // CJS dependencies bundled into an ESM output may reference `require`/`__dirname`; provide shims so
    // esbuild's "Dynamic require of … is not supported" path resolves at runtime.
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

// Ship the food migration SQL alongside the bundle so the migrate Lambda reads it at runtime
// (lambdas/migrate/handler.ts → ../../migrations). src/db/migrations stays the single source of truth;
// this is a build-time file copy, not a module import. Discovery is by readdir+sort, so adding a .sql
// here is picked up automatically.
const pkgRoot = dirname(fileURLToPath(import.meta.url));
const migrationsSrc = join(pkgRoot, 'src', 'db', 'migrations');
mkdirSync('dist-lambda/migrations', { recursive: true });
const sqlFiles = readdirSync(migrationsSrc).filter((file) => file.endsWith('.sql'));
for (const file of sqlFiles) {
    copyFileSync(join(migrationsSrc, file), join('dist-lambda/migrations', file));
}

console.log(
    `bundled ${entryPoints.length} handler + ${sqlFiles.length} migrations to dist-lambda/ + wrote dist-lambda/package.json {"type":"module"}`,
);
