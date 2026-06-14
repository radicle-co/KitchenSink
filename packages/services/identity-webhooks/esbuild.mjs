import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Ship the identity-service migration SQL alongside the bundle so the migrate Lambda reads it at
// runtime (handlers/migrate.ts) without a cross-package import. identity-service stays the single
// source of truth; this is a build-time file copy, not a module import.
const pkgRoot = dirname(fileURLToPath(import.meta.url));
const migrationsSrc = join(pkgRoot, '..', 'identity', 'src', 'database', 'migrations');
mkdirSync('dist/migrations', { recursive: true });
const sqlFiles = readdirSync(migrationsSrc).filter((f) => f.endsWith('.sql'));
for (const file of sqlFiles) {
    copyFileSync(join(migrationsSrc, file), join('dist/migrations', file));
}

console.log(
    `bundled ${entryPoints.length} handlers + ${sqlFiles.length} migrations to dist/ + wrote dist/package.json {"type":"module"}`,
);
