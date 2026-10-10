import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

/**
 * The edge verifier's build inputs, read and checked BEFORE anything is bundled (the edge build below says why each
 * is compiled in). With no key the edge bundle is skipped, for the reason given there. With a key and no parties it
 * is refused: that bundle would answer every `401` with no `Access-Control-Allow-Origin` for any origin, so a browser
 * reads every rejected token as a network error (ADR-0047, plan 002 C1). Trimmed here and in `EdgeStack`, which
 * checks the bundle against the same value.
 */
const edgeJwtKey = process.env['CLERK_JWT_KEY'];
const edgeAuthorizedParties = (process.env['CLERK_AUTHORIZED_PARTIES'] ?? '').trim();

if (edgeJwtKey && edgeAuthorizedParties === '') {
    throw new Error(
        'CLERK_AUTHORIZED_PARTIES must be exported beside CLERK_JWT_KEY to bundle the Lambda@Edge verifier: its 401 ' +
            'admits exactly those origins (ADR-0047). CI reads it from SSM /kitchensink/prod/clerk/authorized-parties.',
    );
}

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
    // ONE bootstrap for every database on the instance (the role split) — it replaced food's and recipe's.
    'src/db-bootstrap/handler.ts',
    'src/db-reaper/handler.ts',
    // The remote search CloudFront signing key's provisioner (ADR-0055), one per base stage.
    'src/remoteSearchSigningKey/handler.ts',
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
    // (pure JS, needed by the db-bootstrap and db-reaper handlers) IS bundled — the runtime does not provide it.
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

console.log(
    `bundled ${entryPoints.length} handlers to dist-lambda/ + wrote dist-lambda/package.json {"type":"module"}`,
);

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
 *  3. **The key and the authorized parties are compiled IN.** Lambda@Edge cannot read environment variables and
 *     `valueForStringParameter` resolves at deploy time, too late for an asset hashed at synth. CI exports
 *     `CLERK_JWT_KEY` and `CLERK_AUTHORIZED_PARTIES` from SSM before this runs and `define` inlines them. Both are
 *     PUBLIC — the key verifies signatures, it does not make them, and the parties are the web origins — so nothing
 *     secret is embedded.
 *
 * ⚠️ SKIPPED, not fatal, when the key is unset: `sandbox-deploy` and every local `bundle:lambda` run this
 * script with no Clerk key in scope and must keep working, and the edge is production-only. The loud failure
 * lives where it belongs — `EdgeStack` refuses to synthesize without the key, the parties AND a bundle built from
 * those same values, so a prod deploy cannot silently ship a stale or absent verifier.
 *
 * ⚠️ NOT MINIFIED, deliberately: `EdgeStack` proves the bundle was built with the values it was handed by
 * looking for their string literals in the output, and a minifier is free to re-escape them.
 */
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
        define: {
            __CLERK_EDGE_JWT_KEY__: JSON.stringify(edgeJwtKey),
            __CLERK_EDGE_AUTHORIZED_PARTIES__: JSON.stringify(edgeAuthorizedParties),
            // ⚠️ Empty when unset, and deliberately NOT fatal (plan U20). A verifier with no Clerk key
            // rejects every request, so its absence must fail the build; one with no DSN simply reports
            // nothing, which is how it behaved before. Making this fatal would break every local bundle.
            __SENTRY_EDGE_DSN__: JSON.stringify(process.env['SENTRY_EDGE_DSN'] ?? ''),
            __EDGE_STAGE__: JSON.stringify(process.env['EDGE_STAGE'] ?? 'prod'),
        },
        logLevel: 'info',
    });

    writeFileSync('dist-edge/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

    console.log('bundled the Lambda@Edge verifier to dist-edge/ with the build-time Clerk key and parties inlined');
}
