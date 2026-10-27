import { build } from 'esbuild';

/**
 * Bundle the sandbox container's entry into one file, `dist/main.mjs`, so the container needs no `node_modules`:
 * a plain `node:24` image runs it. `local:up` builds this beside the search function's own Lambda bundle.
 */
await build({
    entryPoints: ['src/main.ts'],
    outfile: 'dist/main.mjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    logLevel: 'info',
    // CommonJS dependencies inlined into an ESM bundle may reference `require`, `__filename` or `__dirname`.
    banner: {
        js: [
            "import { createRequire as __createRequire } from 'node:module';",
            'const require = __createRequire(import.meta.url);',
        ].join('\n'),
    },
});
