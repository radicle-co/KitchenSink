import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

/**
 * Bundle each Lambda handler into a self-contained ESM file under dist/, mirroring the src/ layout
 * (outbase: src) so the CDK `handler:` strings (e.g. `handlers/versionArchiveWorker.handler`) resolve.
 * The CDK ships `dist/` via `Code.fromAsset`, which carries no node_modules, so every JS dependency
 * (drizzle, pg, powertools, …) is inlined here.
 *
 * `external`:
 *  - `@aws-sdk/*` is provided by the Node Lambda runtime.
 *  - `pg-native` is an optional peer pg only requires when `Client.native` is accessed; leaving it
 *    external avoids a build-time resolve error since it isn't installed.
 *
 * ⚠️ **`@aws-sdk/client-bedrock-runtime` IS BUNDLED, against the rule above** — the one exception, made
 * deliberately. AWS documents that "all supported Lambda Node.js runtimes include a specific minor version of
 * the AWS SDK for JavaScript v3" but does NOT publish which modular `@aws-sdk/client-*` packages that
 * includes, and recommends "bundling and minifying the AWS SDK in your deployment package, rather than using
 * the SDK included in the runtime". `dist/` ships with no `node_modules`, so being wrong costs a cold-start
 * `ERR_MODULE_NOT_FOUND` — the exact failure `handle-sync-worker` shipped with, past two guards. The clients
 * already externalised (`s3`, `sqs`, `cloudfront`, `rds-signer`, `ssm`) are proven present by running
 * production code; `bedrock-runtime` has no such evidence, so it is carried rather than assumed. Bundling
 * also pins the SDK version the gate is tested against, which matters more here than elsewhere because the
 * `StopReason` enum this unit reads has already grown twice.
 *
 * The `dist/package.json` `{"type":"module"}` marker makes Node load the emitted `.js` as ESM.
 */
/**
 * ⛔ THIS LIST MUST COVER EVERY `lambda.Function` THE STACK DEPLOYS, AND IT IS NO LONGER TRUSTED TO.
 *
 * `handle-sync-worker` was missing here while `RecipeWorkersStack.ts` deployed it, so its asset carried the
 * raw `tsc` output (4.6 KB, opening `import { sql } from 'drizzle-orm'`) instead of a bundle — against siblings
 * of 436 KB–981 KB — and `dist/` has no `node_modules`, so every cold start died on `ERR_MODULE_NOT_FOUND`.
 * Two guard tests missed it because both enumerated the same five names this array did; a copy of a list cannot
 * detect that the list is incomplete.
 *
 * The check now DERIVES the required set from the stack instead: `serviceInfraWiringInvariants.test.ts` (W2)
 * discovers every `new lambda.Function(…)` handler string in any service's infra and requires its entry point
 * here, and `RecipeWorkersStack.test.ts` re-asserts it against the synthesized template. Adding a Lambda
 * without adding its entry point is now a red test, not a runtime discovery.
 */
const entryPoints = [
    'src/handlers/versionArchiveWorker.ts',
    'src/handlers/accountErasureWorker.ts',
    'src/handlers/handleSyncWorker.ts',
    'src/handlers/archiveSweeper.ts',
    'src/handlers/erasureSweeper.ts',
    'src/handlers/erasureOrphanSweeper.ts',
    'src/handlers/verifyLine.ts',
];

/**
 * ⛔ THE HANDLERS THAT CARRY THEIR OWN AWS SDK, and why this is a SET rather than a flag.
 *
 * Every other handler leaves `@aws-sdk/*` external because the Lambda Node runtime provides it — and, for the
 * clients they use (`s3`, `sqs`, `cloudfront`, `rds-signer`), that is proven by production code running today.
 *
 * `verifyLine` uses `@aws-sdk/client-bedrock-runtime`, for which there is NO such evidence. AWS documents that
 * the runtime "includes a specific minor version of the AWS SDK for JavaScript v3" but does not publish which
 * modular `@aws-sdk/client-*` packages that covers, and its own guidance is to bundle "rather than using the
 * SDK included in the runtime". `dist/` ships with no `node_modules`, so being wrong is a cold-start
 * `ERR_MODULE_NOT_FOUND` — a total, silent outage of the verification gate. That is the exact failure
 * `handle-sync-worker` shipped with, and it went past two guards.
 *
 * Bundling also PINS the SDK version this gate is tested against, which matters more here than elsewhere: the
 * `StopReason` enum `verification/verdict.ts` reads has already grown twice, and a runtime-provided SDK
 * changes underneath a deployed function with no deploy of ours.
 *
 * ⚠️ Two passes rather than an esbuild plugin. `external` is applied by esbuild AFTER plugin resolution
 * returns, so an `onResolve` hook cannot un-external a path — a first attempt did exactly that and produced a
 * bundle that still carried a bare `import … from "@aws-sdk/client-bedrock-runtime"`. Two passes over one
 * shared options object is the honest spelling, and `entryPoints` above stays the COMPLETE list so W2's
 * discovery gate keeps working.
 */
const SELF_CONTAINED = new Set(['src/handlers/verifyLine.ts']);

/** Everything both passes share. Declared once so the two cannot drift in anything but `external`. */
const shared = {
    outdir: 'dist',
    outbase: 'src',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    sourcemap: true,
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
};

const runtimeSdkEntries = entryPoints.filter((entry) => !SELF_CONTAINED.has(entry));
const selfContainedEntries = entryPoints.filter((entry) => SELF_CONTAINED.has(entry));

await build({ ...shared, entryPoints: runtimeSdkEntries, external: ['@aws-sdk/*', 'pg-native'] });
await build({ ...shared, entryPoints: selfContainedEntries, external: ['pg-native'] });

writeFileSync('dist/package.json', `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

console.log(`bundled ${entryPoints.length} handlers to dist/ + wrote dist/package.json {"type":"module"}`);
