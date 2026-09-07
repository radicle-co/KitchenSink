import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

/**
 * Bundle each Lambda handler into a self-contained ESM file under dist/, mirroring the src/ layout so
 * the CDK `handler:` strings (e.g. `handlers/identityWebhook.handler`) still resolve. The CDK ships
 * `dist/` via `Code.fromAsset`, which carries no node_modules — so every
 * dependency (svix, drizzle, the @kitchensink/identity-service source, Sentry, …) must be inlined
 * here. `@aws-sdk/*` is left external because the Node 22 Lambda runtime provides it.
 *
 * The `dist/package.json` marker makes Node load the emitted `.js` as ESM; without it the runtime
 * treats `import` statements as CommonJS and the function dies at init (`Cannot use import statement
 * outside a module`).
 */
const entryPoints = [
    'src/handlers/identityWebhook.ts',
    'src/handlers/deletionWorker.ts',
    'src/handlers/reconciliation.ts',
    // The 12-month tombstone → erasure sweep (CR-002 KTD-3). Its WebhooksStack Lambda references
    // `handlers/tombstoneSweep.handler`, so it MUST bundle here or the asset is missing at runtime.
    'src/handlers/tombstoneSweep.ts',
    // The erasure completion-contract reconciliation (CR-002 R7 / U4b). Same — the ErasureReconciliation
    // Lambda references `handlers/erasureReconciliation.handler`.
    'src/handlers/erasureReconciliation.ts',
    'src/handlers/logForwarder.ts',
];

await build({
    entryPoints,
    outdir: 'dist',
    outbase: 'src',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    external: ['@aws-sdk/*'],
    // CJS dependencies bundled into an ESM output may reference `require`/`__dirname`; provide shims
    // so esbuild's "Dynamic require of … is not supported" path resolves at runtime.
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

writeFileSync('dist/package.json', `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

// ⛔ NO migration SQL is copied here any more. This package used to reach across into
// `packages/services/identity/src/database/migrations` for the migrate handler that lived beside these
// ones; that handler moved to `packages/services/identity`, which now bundles the SQL beside its own
// runner (`packages/services/identity/esbuild.mjs`). The SQL's home never changed — only which bundle
// carries it — so there is still exactly ONE source of truth for it.

console.log(`bundled ${entryPoints.length} handlers to dist/ + wrote dist/package.json {"type":"module"}`);
