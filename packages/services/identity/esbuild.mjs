import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundle the in-VPC migration-runner Lambda into a self-contained ESM file under `dist-lambda/`,
 * mirroring the `src/` layout so the CDK `handler:` string (`lambdas/migrate/handler.handler`) resolves.
 * The output dir is deliberately NOT the service's main `dist/` (which holds the NestJS `node dist/...`
 * build) — the Lambda asset ships separately via `Code.fromAsset('dist-lambda')`.
 *
 * `Code.fromAsset` carries no `node_modules`, so every dependency (pg, drizzle, the identity schema, zod,
 * the Secrets Manager client) is inlined here. ⚠️ `@aws-sdk/*` is bundled rather than left external: the
 * Node Lambda runtime's built-in SDK is a convenience AWS documents as not-to-be-relied-on, and the
 * failure mode when it is absent is a cold-start crash on the one invocation that gates a deploy. Only
 * `pg-native` (pg's optional native binding we never use) stays external. The `dist-lambda/package.json`
 * `{"type":"module"}` marker makes Node load the emitted `.js` as ESM; without it the runtime reads the
 * `import` statements as CommonJS and the function dies at init.
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

// Ship the identity migration SQL alongside the bundle so the migrate Lambda reads it at runtime
// (lambdas/migrate/handler.ts → ../../migrations). `src/database/migrations` stays the single source of
// truth — this is a build-time file copy, not a module import, and it is the SAME directory the identity
// integration suite migrates from. Discovery is by readdir+sort, so adding a `.sql` here is picked up
// automatically.
//
// ⚠️ The copy is why the pipeline's migrate step must run AFTER `cdk deploy`, never before: the bundle
// ships WITH the stack, so invoking first invokes the previous deploy's Lambda carrying the previous
// migration set — exit 0, nothing applied. `prodDeployMigrationOrder.test.ts` pins that ordering.
const pkgRoot = dirname(fileURLToPath(import.meta.url));
const migrationsSrc = join(pkgRoot, 'src', 'database', 'migrations');
// ⛔ EMPTIED first, never merged into. `dist-lambda/` is not cleaned between builds, so a copy that merely
// adds files leaves yesterday's `.sql` in place: a migration that was RENAMED would ship under both names
// and be applied twice under two different `schema_migrations` keys, and one that was deleted would keep
// shipping. It also makes a broken copy step invisible on a machine that had built before — which is not
// hypothetical, it is how this was found (the check for it passed against a stale directory).
rmSync('dist-lambda/migrations', { recursive: true, force: true });
mkdirSync('dist-lambda/migrations', { recursive: true });
const sqlFiles = readdirSync(migrationsSrc).filter((file) => file.endsWith('.sql'));
for (const file of sqlFiles) {
    copyFileSync(join(migrationsSrc, file), join('dist-lambda/migrations', file));
}

if (sqlFiles.length === 0) {
    // A bundle with no SQL is a runner that reports a clean run having applied nothing — the exact silent
    // no-op the in-deploy trigger exists to remove. Fail the BUILD instead of shipping it.
    throw new Error(`No .sql migrations found in ${migrationsSrc} — refusing to ship an empty migration bundle`);
}

console.log(
    `bundled ${entryPoints.length} handler + ${sqlFiles.length} migrations to dist-lambda/ + wrote dist-lambda/package.json {"type":"module"}`,
);
