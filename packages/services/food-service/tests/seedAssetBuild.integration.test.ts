/**
 * The catalog seed function's asset, as the pipeline builds it (curated catalog plan U3, KTD-4).
 *
 * `npm run bundle:lambda` (`node esbuild.mjs`) writes `distSeed/`: the handler bundle, a verbatim copy of the committed
 * `src/foods/seed/data/`, and the verifier's SQL under `verify/sql/`. The seed digest names that whole tree, computed in
 * the function and in `runSeed.sh`, so three properties of the build are load-bearing and pinned here:
 *
 * - **Deterministic.** The food-service job redeploys the schema stack from its own rebuild, so a build that differs
 *   byte for byte from the schema job's would leave every preview's seed stale on every push.
 * - **Complete and closed.** Exactly the bundle, the data and the SQL: a missing file is a seed the verifier cannot
 *   read, and an extra one (yesterday's data file, a stray metafile) changes the digest for nothing.
 * - **Refuses before emptying.** A build with no data or no SQL fails without touching the previous asset, so a broken
 *   checkout cannot replace a working asset with an empty one.
 *
 * No database: this tier mocks or omits it (2026-09-20). The build runs as the pipeline runs it, in a child `node`.
 */
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { readSeedManifest } from '@kitchensink/db-schema-guard';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../../..');
const SEED_ASSET = join(PACKAGE_ROOT, 'distSeed');
const SEED_DATA = join(PACKAGE_ROOT, 'src', 'foods', 'seed', 'data');
const VERIFIER_SQL = join(PACKAGE_ROOT, 'src', 'foods', 'seed', 'verify', 'sql');
const BUILDER = pathToFileURL(join(PACKAGE_ROOT, 'seedAssetBuild.mjs')).href;

/** A build takes a few seconds; two of them plus a digest each fit well inside this. */
const BUILD_TIMEOUT_MS = 120_000;

const scratch = mkdtempSync(join(tmpdir(), 'seedAssetBuild-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/** Every regular file under `root`, as sorted POSIX paths relative to it. */
function filesUnder(root: string): string[] {
    return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split('\\').join('/'))
        .sort();
}

/**
 * Run the package's real bundler, `node esbuild.mjs`, from the package root, as `npm run bundle:lambda` does.
 *
 * @sideEffect Rebuilds `dist-lambda/` and `distSeed/`.
 */
function bundleLambdas(): void {
    const run = spawnSync(process.execPath, ['esbuild.mjs'], { cwd: PACKAGE_ROOT, encoding: 'utf8' });

    expect(run.status, run.stderr).toBe(0);
}

/**
 * Call `buildSeedAsset` in a child `node`, over another package root.
 *
 * @param packageRoot - Where the builder reads `src/` from.
 * @param outdir - Where it writes.
 * @returns The child's exit status and stderr.
 * @sideEffect Runs esbuild and writes `outdir`.
 */
function buildFrom(packageRoot: string, outdir: string): { readonly status: number | null; readonly stderr: string } {
    const run = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            'const { buildSeedAsset } = await import(process.argv[1]); await buildSeedAsset({ packageRoot: process.argv[2], outdir: process.argv[3] });',
            BUILDER,
            packageRoot,
            outdir,
        ],
        { encoding: 'utf8' },
    );

    return { status: run.status, stderr: run.stderr };
}

/**
 * A package root holding a copy of the seed handler's sources' location but with the given data and SQL trees, for the
 * refusal cases. The handler is never reached: the refusals come first.
 *
 * @param data - Files under `src/foods/seed/data/`.
 * @param sql - Files under `src/foods/seed/verify/sql/`.
 * @returns The root.
 * @sideEffect Writes a directory tree.
 */
function packageWith(data: Readonly<Record<string, string>>, sql: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(scratch, 'package-'));

    for (const [dir, files] of [
        ['src/foods/seed/data', data],
        ['src/foods/seed/verify/sql', sql],
    ] as const) {
        mkdirSync(join(root, dir), { recursive: true });

        for (const [name, body] of Object.entries(files)) {
            writeFileSync(join(root, dir, name), body);
        }
    }

    return root;
}

/** An output directory holding last build's asset, which a refused build must leave alone. */
function previousAsset(): string {
    const outdir = mkdtempSync(join(scratch, 'out-'));

    writeFileSync(join(outdir, 'previous.txt'), 'last good asset\n');

    return outdir;
}

describe('the seed asset build', () => {
    it(
        'gives one digest from two clean builds at the real path',
        () => {
            rmSync(SEED_ASSET, { recursive: true, force: true });
            bundleLambdas();
            const first = readSeedManifest(SEED_ASSET);

            rmSync(SEED_ASSET, { recursive: true, force: true });
            bundleLambdas();
            const second = readSeedManifest(SEED_ASSET);

            expect(second.text).toBe(first.text);
            expect(second.sha).toBe(first.sha);
        },
        BUILD_TIMEOUT_MS,
    );

    it(
        'holds exactly the bundle, a verbatim copy of the data and the verifier SQL',
        () => {
            bundleLambdas();

            const data = filesUnder(SEED_DATA);
            const sql = readdirSync(VERIFIER_SQL)
                .filter((file) => file.endsWith('.sql'))
                .sort();

            expect(data.length).toBeGreaterThan(0);
            expect(sql.length).toBeGreaterThan(0);
            expect(filesUnder(SEED_ASSET)).toStrictEqual(
                [
                    'lambdas/seed/handler.js',
                    'lambdas/seed/handler.js.map',
                    'package.json',
                    ...data.map((file) => `data/${file}`),
                    ...sql.map((file) => `verify/sql/${file}`),
                ].sort(),
            );
            expect(JSON.parse(readFileSync(join(SEED_ASSET, 'package.json'), 'utf8'))).toStrictEqual({
                type: 'module',
            });

            for (const file of data) {
                expect(readFileSync(join(SEED_ASSET, 'data', file)).equals(readFileSync(join(SEED_DATA, file)))).toBe(
                    true,
                );
            }

            for (const file of sql) {
                expect(readFileSync(join(SEED_ASSET, 'verify', 'sql', file), 'utf8')).toBe(
                    readFileSync(join(VERIFIER_SQL, file), 'utf8'),
                );
            }
        },
        BUILD_TIMEOUT_MS,
    );

    it(
        'never names the checkout it was built in, so another runner builds the same bytes',
        () => {
            bundleLambdas();

            for (const file of ['lambdas/seed/handler.js', 'lambdas/seed/handler.js.map']) {
                expect(readFileSync(join(SEED_ASSET, file), 'utf8')).not.toContain(REPO_ROOT);
            }
        },
        BUILD_TIMEOUT_MS,
    );

    it(
        'empties its output first, so a file the source no longer holds does not ship',
        () => {
            bundleLambdas();
            writeFileSync(join(SEED_ASSET, 'data', 'yesterday.jsonl'), '{}\n');

            bundleLambdas();

            expect(existsSync(join(SEED_ASSET, 'data', 'yesterday.jsonl'))).toBe(false);
        },
        BUILD_TIMEOUT_MS,
    );

    it.each<[string, () => string, RegExp]>([
        ['a data directory with no file', () => packageWith({}, { 'a.sql': 'SELECT 1;\n' }), /no committed seed data/u],
        ['a verifier with no SQL', () => packageWith({ 'seed.jsonl': '{}\n' }, {}), /no verifier SQL/u],
        [
            'a symlink in the data, which the two digests would read differently',
            () => {
                const root = packageWith({ 'seed.jsonl': '{}\n' }, { 'a.sql': 'SELECT 1;\n' });

                symlinkSync(join(root, 'src/foods/seed/data/seed.jsonl'), join(root, 'src/foods/seed/data/link.jsonl'));

                return root;
            },
            /symlink.*link\.jsonl/u,
        ],
    ])('⛔ refuses %s before touching the previous asset', (_case, makeRoot, reason) => {
        const outdir = previousAsset();
        const run = buildFrom(makeRoot(), outdir);

        expect(run.status).not.toBe(0);
        expect(run.stderr).toMatch(reason);
        expect(readdirSync(outdir)).toStrictEqual(['previous.txt']);
    });
});
