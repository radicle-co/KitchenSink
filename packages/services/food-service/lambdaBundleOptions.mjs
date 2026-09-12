/**
 * The esbuild options every food Lambda bundle shares: the migration runner's (`esbuild.mjs`) and the catalog seed
 * function's (`seedAssetBuild.mjs`).
 *
 * `Code.fromAsset` carries no `node_modules`, so every dependency (`pg`, `drizzle-orm`, `@aws-sdk/rds-signer` for the
 * IAM auth token, …) is inlined. `@aws-sdk/rds-signer` is NOT reliably present in the Lambda runtime's SDK, so it is
 * bundled too; only `pg-native` (pg's optional native binding, never used) stays external. Each asset writes a
 * `package.json` holding `{"type":"module"}` beside its bundle, so Node loads the emitted `.js` as ESM.
 *
 * @type {Pick<import('esbuild').BuildOptions, 'bundle' | 'platform' | 'target' | 'format' | 'sourcemap' | 'external' | 'banner' | 'outbase'>}
 */
export const LAMBDA_BUNDLE_OPTIONS = {
    outbase: 'src',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    external: ['pg-native'],
    // CJS dependencies bundled into an ESM output may reference `require`/`__dirname`; provide shims so esbuild's
    // "Dynamic require of … is not supported" path resolves at runtime.
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
};

/** The `package.json` every asset carries, so Node loads its bundle as ESM. */
export const ESM_PACKAGE_JSON = `${JSON.stringify({ type: 'module' }, null, 2)}\n`;
