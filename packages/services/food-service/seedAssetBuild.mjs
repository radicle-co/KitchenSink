import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { ESM_PACKAGE_JSON, LAMBDA_BUNDLE_OPTIONS } from './lambdaBundleOptions.mjs';

/**
 * Build the catalog seed function's asset (curated catalog plan U3, KTD-4): the handler bundle, a verbatim copy of the
 * committed seed data, and the verifier's SQL.
 *
 * The layout, under `outdir`:
 *
 * - `package.json` — `{"type":"module"}`;
 * - `lambdas/seed/handler.js` and its source map — the bundle, mirroring `src/` so the CDK `handler:` string
 *   `lambdas/seed/handler.handler` resolves;
 * - `data/**` — `src/foods/seed/data/`, byte for byte;
 * - `verify/sql/*.sql` — `src/foods/seed/verify/sql/`, so the seed digest covers a change to the verifier too.
 *
 * ⛔ The whole tree is the seed digest (`readSeedManifest` in the function, `runSeed.sh manifest` in the pipeline). So:
 *
 * - it is a directory of its own, never `dist-lambda/`, so a migration edit does not move the seed digest;
 * - it is EMPTIED before it is written, so a file the source no longer holds cannot ship;
 * - the refusals come BEFORE the emptying, so a checkout with no data replaces nothing;
 * - a symlink in the data is refused, because the two digests would read it differently;
 * - the esbuild metafile is RETURNED, never written into the tree, where it would change the digest for nothing.
 *
 * ⚠️ Determinism is load-bearing. The food-service job redeploys the schema stack from its own rebuild, so two builds of
 * one checkout must give one digest, or every preview reads its seed as stale on every push. Source-map paths are
 * relative to `outdir`, so a runner with the same checkout layout builds the same bytes
 * (`tests/seedAssetBuild.integration.test.ts`).
 *
 * @param {{ readonly packageRoot: string; readonly outdir: string }} options - The food-service package root, which
 *   `src/` is read from, and the asset directory.
 * @returns {Promise<{ readonly metafile: import('esbuild').Metafile; readonly dataFiles: number; readonly sqlFiles: number }>}
 *   The bundle's metafile, for the import-graph guard, and how many files were copied.
 * @throws {Error} when the data holds no file or a symlink, or the verifier holds no SQL, before `outdir` is touched.
 * @sideEffect Empties and writes `outdir`; runs esbuild.
 */
export async function buildSeedAsset({ packageRoot, outdir }) {
    const dataSrc = join(packageRoot, 'src', 'foods', 'seed', 'data');
    const sqlSrc = join(packageRoot, 'src', 'foods', 'seed', 'verify', 'sql');
    const dataFiles = regularFilesUnder(dataSrc);
    const sqlFiles = readdirSync(sqlSrc).filter((file) => file.endsWith('.sql'));

    if (dataFiles.length === 0) {
        throw new Error(`no committed seed data in ${dataSrc} — refusing to build a seed asset that seeds nothing`);
    }

    if (sqlFiles.length === 0) {
        throw new Error(`no verifier SQL in ${sqlSrc} — refusing to build a seed asset that cannot verify itself`);
    }

    rmSync(outdir, { recursive: true, force: true });

    const result = await build({
        ...LAMBDA_BUNDLE_OPTIONS,
        absWorkingDir: packageRoot,
        entryPoints: ['src/lambdas/seed/handler.ts'],
        outdir,
        metafile: true,
        logLevel: 'warning',
    });

    for (const file of dataFiles) {
        const target = join(outdir, 'data', file);

        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(dataSrc, file), target);
    }

    mkdirSync(join(outdir, 'verify', 'sql'), { recursive: true });

    for (const file of sqlFiles) {
        copyFileSync(join(sqlSrc, file), join(outdir, 'verify', 'sql', file));
    }

    writeFileSync(join(outdir, 'package.json'), ESM_PACKAGE_JSON);

    return { metafile: result.metafile, dataFiles: dataFiles.length, sqlFiles: sqlFiles.length };
}

/**
 * Every regular file under a directory, as paths relative to it.
 *
 * @param {string} root - The directory.
 * @returns {string[]} The files.
 * @throws {Error} naming every symlink or special file found: the seed digest refuses both, so the build does too.
 * @sideEffect Reads the tree.
 */
function regularFilesUnder(root) {
    const files = [];
    const refused = [];
    const pending = [root];

    for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const absolute = join(dir, entry.name);
            const path = relative(root, absolute).split(sep).join('/');

            // A `Dirent` describes a symlink itself, so a link to a file or a directory is neither and is refused.
            if (entry.isDirectory()) {
                pending.push(absolute);
            } else if (entry.isFile()) {
                files.push(path);
            } else {
                refused.push(path);
            }
        }
    }

    if (refused.length > 0) {
        throw new Error(
            `the committed seed data holds a symlink or special file, which the seed digest refuses: ${refused.sort().join(', ')}`,
        );
    }

    return files.sort();
}
