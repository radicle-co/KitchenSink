import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

/**
 * Bundle the sandbox nightly-shutdown scheduler Lambda (ADR-0007) into a self-contained ESM file under
 * `dist-lambda/`, mirroring the `src/` layout so the CDK `handler:` string
 * (`sandbox-scheduler/handler.handler`) resolves. The pure decision logic in `lib/sandbox-scheduler/`
 * is bundled in; the AWS SDK v3 clients are left `external` because the Node 22 Lambda runtime provides
 * them (so they are not — and need not be — package dependencies).
 *
 * A bare `cdk synth` that skips this bundle still works: `SandboxSchedulerStack` falls back to an inline
 * placeholder when `dist-lambda/` is absent. The real deploy always runs this first.
 */
const entryPoints = [
    'src/sandbox-scheduler/handler.ts',
    'src/food-db-bootstrap/handler.ts',
    'src/recipe-db-bootstrap/handler.ts',
];

await build({
    entryPoints,
    outdir: 'dist-lambda',
    outbase: 'src',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    // `@aws-sdk/*` is provided by the Node 22 Lambda runtime; `pg-native` is an optional native binding
    // `pg` only require()s when explicitly asked for it (we never do), so neither is bundled. `pg` itself
    // (pure JS, needed by the food-db-bootstrap handler) IS bundled — the runtime does not provide it.
    external: ['@aws-sdk/*', 'pg-native'],
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

console.log(`bundled ${entryPoints.length} handler to dist-lambda/ + wrote dist-lambda/package.json {"type":"module"}`);

/**
 * The CloudFront viewer-request verifier (ADR-0020 / plan U16), bundled SEPARATELY from the four handlers
 * above. Three differences, each of which forces the split rather than merely suggesting it:
 *
 *  1. **Its own output root.** The asset CDK packages is the directory it points at, so sharing
 *     `dist-lambda/` would ship the `pg`-bearing bootstrap handlers inside a function whose viewer-request
 *     code limit is 1 MB.
 *  2. **CommonJS, not ESM.** `dist-lambda/package.json` declares `{"type":"module"}`, which the edge asset
 *     does not include; CJS is what every Lambda@Edge runtime accepts without qualification, so the question
 *     never has to be answered.
 *  3. **The key is compiled IN.** Lambda@Edge cannot read environment variables and
 *     `valueForStringParameter` resolves at deploy time, too late for an asset hashed at synth. CI exports
 *     `CLERK_JWT_KEY` from SSM before this runs and `define` inlines it. The key is PUBLIC — it verifies
 *     signatures, it does not make them — so nothing secret is embedded.
 *
 * ⚠️ SKIPPED, not fatal, when the key is unset: `sandbox-deploy` and every local `bundle:lambda` run this
 * script with no Clerk key in scope and must keep working, and the edge is production-only. The loud failure
 * lives where it belongs — `EdgeStack` refuses to synthesize without both the key AND a bundle built from
 * that same key, so a prod deploy cannot silently ship a stale or absent verifier.
 *
 * ⚠️ NOT MINIFIED, deliberately: `EdgeStack` proves the bundle was built with the key it was handed by
 * looking for that key's string literal in the output, and a minifier is free to re-escape it.
 */
const edgeJwtKey = process.env['CLERK_JWT_KEY'];

if (!edgeJwtKey) {
    console.log('skipped the Lambda@Edge verifier bundle — CLERK_JWT_KEY is not set (prod-only, ADR-0020)');
} else {
    await build({
        entryPoints: ['src/edge-verifier/handler.ts'],
        outdir: 'dist-edge',
        outbase: 'src/edge-verifier',
        bundle: true,
        platform: 'node',
        // Lambda@Edge offers no nodejs24.x — see EDGE_LAMBDA_RUNTIME in lib/platform/EdgeStack.ts.
        target: 'node22',
        format: 'cjs',
        // No source map: a Lambda@Edge replica logs to whichever region served the request, so there is no
        // symbolication path that would read one, and the viewer-request code limit is 1 MB.
        sourcemap: false,
        // Nothing is external: @clerk/backend is NOT provided by the Lambda runtime, and the whole point of
        // the edge verifier is that it needs no network and no layer.
        define: { __CLERK_EDGE_JWT_KEY__: JSON.stringify(edgeJwtKey) },
        logLevel: 'info',
    });

    writeFileSync('dist-edge/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

    console.log('bundled the Lambda@Edge verifier to dist-edge/ with the build-time Clerk key inlined');
}
