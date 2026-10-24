import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * The seed and pool CLIs the Maestro jobs run, bundled into self-contained ES modules so a shard needs Node and nothing
 * else — no `npm ci` of the monorepo (8m26s on a 3-core macOS runner, run 39345702996), no turbo build of the closure.
 *
 * Each entry names:
 *
 * - `name` — the bundle's file name (`<name>.mjs`);
 * - `entry` — how THIS package reaches the module: its own source by path, a sibling's through that package's export,
 *   never a relative path across a workspace boundary;
 * - `source` — the repository path a command line names (`bash packages/tools/e2e-seed/runCli.sh <source> …`). The
 *   command keeps naming the source, so the guards that discover a step by what it runs still find it, and
 *   `runCli.sh` maps it to the bundle through the manifest below. `tests/cliBundle.integration.test.ts` checks that
 *   each bundle really starts at its `source`.
 *
 * ⛔ One CLI per bundle, never a shared chunk: `resetPool` and `poolAdmin` run `main()` only when
 * `import.meta.url === pathToFileURL(process.argv[1]).href`, and inside one bundle every module shares one
 * `import.meta.url`, so a bundle holding two CLIs' modules would run both. The integration test holds it.
 *
 * Adding a CLI to a Maestro job means adding it here; `maestroSeedCli.test.ts` refuses a job step that launches a source
 * this list does not declare.
 */
export const SEED_CLIS = Object.freeze([
    Object.freeze({
        name: 'provision',
        entry: './src/provision.ts',
        source: 'packages/tools/e2e-seed/src/provision.ts',
    }),
    Object.freeze({ name: 'reset', entry: './src/reset.ts', source: 'packages/tools/e2e-seed/src/reset.ts' }),
    Object.freeze({
        name: 'resetPool',
        entry: './src/resetPool.ts',
        source: 'packages/tools/e2e-seed/src/resetPool.ts',
    }),
    Object.freeze({
        name: 'poolAdmin',
        entry: '@kitchensink/e2e-fixtures/poolAdmin',
        source: 'packages/tools/e2e-fixtures/src/poolAdmin.ts',
    }),
]);

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Build every CLI in {@link SEED_CLIS} into `outdir`, with a manifest `runCli.sh` reads.
 *
 * The layout, under `outdir`:
 *
 * - `<name>.mjs` and its linked source map, for each CLI (`runCli.sh` runs them with `--enable-source-maps`, so a
 *   failure in CI points at a TypeScript line);
 * - `seedCli.manifest` — `commit <sha>`, then one `entry <source> <name>.mjs` line per CLI. Plain text, because the
 *   reader is bash on a runner that has no `jq` guarantee.
 *
 * The directory is EMPTIED first, so a bundle the list no longer declares cannot ship; and the refusal of a missing
 * commit comes before that, so a bad call replaces nothing. The esbuild metafile is RETURNED, never written into the
 * directory, which ships whole.
 *
 * Only Node's built-ins stay external: the bundles run where there is no `node_modules`. The `require` shim is there for
 * a CommonJS dependency inlined into an ES module that calls `require` for a built-in.
 *
 * @param {{ readonly outdir: string; readonly commit: string }} options - Where to write, and the commit the sources were
 *   checked out at (`GITHUB_SHA`), recorded so a consumer can refuse bundles another commit built.
 * @returns {Promise<{ readonly metafile: import('esbuild').Metafile }>} The bundles' metafile, for the integration test.
 * @throws {Error} when `outdir` or `commit` is empty, before anything is touched.
 * @sideEffect Empties and writes `outdir`; runs esbuild.
 */
export async function buildSeedClis({ outdir, commit }) {
    if (!outdir) {
        throw new Error('cliBundle: an output directory is required');
    }

    if (!/^[0-9a-f]{7,64}$/u.test(commit ?? '')) {
        throw new Error(
            `cliBundle: --commit must be the commit the sources were checked out at, got '${commit ?? ''}'`,
        );
    }

    const target = resolve(outdir);

    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    const result = await build({
        absWorkingDir: PACKAGE_ROOT,
        entryPoints: Object.fromEntries(SEED_CLIS.map((cli) => [cli.name, cli.entry])),
        outdir: target,
        outExtension: { '.js': '.mjs' },
        bundle: true,
        splitting: false,
        platform: 'node',
        target: 'node24',
        format: 'esm',
        sourcemap: 'linked',
        sourcesContent: false,
        banner: {
            js: "import { createRequire as __seedCliCreateRequire } from 'node:module';\nconst require = __seedCliCreateRequire(import.meta.url);",
        },
        metafile: true,
        logLevel: 'warning',
    });

    writeFileSync(
        join(target, 'seedCli.manifest'),
        [`commit ${commit}`, ...SEED_CLIS.map((cli) => `entry ${cli.source} ${cli.name}.mjs`), ''].join('\n'),
    );

    return { metafile: result.metafile };
}

/**
 * `node packages/tools/e2e-seed/cliBundle.mjs --outdir <dir> --commit <sha>`.
 *
 * @sideEffect Builds the bundles and prints where they went.
 */
async function main() {
    const { values } = parseArgs({
        options: { outdir: { type: 'string' }, commit: { type: 'string' } },
        strict: true,
    });

    await buildSeedClis({ outdir: values.outdir ?? '', commit: values.commit ?? '' });
    console.log(`cliBundle: ${SEED_CLIS.map((cli) => cli.name).join(', ')} → ${resolve(values.outdir ?? '')}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
