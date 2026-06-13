import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

/**
 * Bundle each Lambda handler into a self-contained ESM file under dist/, mirroring the src/ layout so
 * the CDK `handler:` strings (e.g. `handlers/identityWebhook.handler`, `authorizer/handler.handler`)
 * still resolve. The CDK ships `dist/` via `Code.fromAsset`, which carries no node_modules — so every
 * dependency (svix, drizzle, the @kitchensink/identity-service source, Sentry, …) must be inlined
 * here. `@aws-sdk/*` is left external because the Node 22 Lambda runtime provides it.
 *
 * The `dist/package.json` marker makes Node load the emitted `.js` as ESM; without it the runtime
 * treats `import` statements as CommonJS and the function dies at init (`Cannot use import statement
 * outside a module`).
 */
const entryPoints = [
    'src/authorizer/handler.ts',
    'src/handlers/identityWebhook.ts',
    'src/handlers/deletion-worker.ts',
    'src/handlers/reconciliation.ts',
    'src/handlers/log-forwarder.ts',
    'src/handlers/migrate.ts',
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
    // Migration .sql files ship inlined as text so the migrate Lambda is self-contained.
    loader: { '.sql': 'text' },
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
