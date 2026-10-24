import { build } from 'esbuild';
import { rmSync, writeFileSync } from 'node:fs';

/**
 * Bundle the remote search function into `dist-lambda/`, its asset (`handler.handler`). `outbase: src` mirrors the
 * `src/` layout, so the CDK `handler:` string resolves.
 *
 * Every dependency is inlined, the AWS SDK included: `Code.fromAsset` carries no `node_modules`, and AWS recommends
 * bundling the SDK rather than relying on the runtime's copy, so the deployed client is the one the tests ran.
 * `dist-lambda/package.json` holds `{"type":"module"}`, so Node loads the bundle as ESM.
 */
const entryPoints = ['src/handler.ts'];

// Emptied first, never merged into: a handler that was renamed or removed must not keep shipping.
rmSync('dist-lambda', { recursive: true, force: true });

await build({
    entryPoints,
    outdir: 'dist-lambda',
    outbase: 'src',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
    // CommonJS dependencies inlined into an ESM bundle may reference `require`, `__filename` or `__dirname`.
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
});

writeFileSync('dist-lambda/package.json', `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
