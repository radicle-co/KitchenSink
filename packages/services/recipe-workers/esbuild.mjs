import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

/**
 * Bundle each Lambda handler into a self-contained ESM file under dist/, mirroring the src/ layout
 * (outbase: src) so the CDK `handler:` strings (e.g. `handlers/version-archive-worker.handler`) resolve.
 * The CDK ships `dist/` via `Code.fromAsset`, which carries no node_modules, so every JS dependency
 * (drizzle, pg, powertools, …) is inlined here.
 *
 * `external`:
 *  - `@aws-sdk/*` is provided by the Node Lambda runtime.
 *  - `pg-native` is an optional peer pg only requires when `Client.native` is accessed; leaving it
 *    external avoids a build-time resolve error since it isn't installed.
 *
 * The `dist/package.json` `{"type":"module"}` marker makes Node load the emitted `.js` as ESM.
 */
/**
 * ⛔ THIS LIST MUST COVER EVERY `lambda.Function` THE STACK DEPLOYS, AND IT IS NO LONGER TRUSTED TO.
 *
 * `handle-sync-worker` was missing here while `recipe-workers-stack.ts` deployed it, so its asset carried the
 * raw `tsc` output (4.6 KB, opening `import { sql } from 'drizzle-orm'`) instead of a bundle — against siblings
 * of 436 KB–981 KB — and `dist/` has no `node_modules`, so every cold start died on `ERR_MODULE_NOT_FOUND`.
 * Two guard tests missed it because both enumerated the same five names this array did; a copy of a list cannot
 * detect that the list is incomplete.
 *
 * The check now DERIVES the required set from the stack instead: `service-infra-wiring-invariants.test.ts` (W2)
 * discovers every `new lambda.Function(…)` handler string in any service's infra and requires its entry point
 * here, and `recipe-workers-stack.test.ts` re-asserts it against the synthesized template. Adding a Lambda
 * without adding its entry point is now a red test, not a runtime discovery.
 */
const entryPoints = [
    'src/handlers/version-archive-worker.ts',
    'src/handlers/account-erasure-worker.ts',
    'src/handlers/handle-sync-worker.ts',
    'src/handlers/archive-sweeper.ts',
    'src/handlers/erasure-sweeper.ts',
    'src/handlers/erasure-orphan-sweeper.ts',
];

await build({
    entryPoints,
    outdir: 'dist',
    outbase: 'src',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    sourcemap: true,
    external: ['@aws-sdk/*', 'pg-native'],
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

console.log(`bundled ${entryPoints.length} handlers to dist/ + wrote dist/package.json {"type":"module"}`);
