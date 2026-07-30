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
