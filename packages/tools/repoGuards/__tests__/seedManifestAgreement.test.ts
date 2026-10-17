/**
 * ⛔ THE SEED DIGEST IS COMPUTED TWICE, AND THE TWO MUST AGREE (curated catalog plan U2, R8, KTD-4).
 *
 * `runSeed.sh manifest` digests the seed bundle the pipeline built; `readSeedManifest` in
 * `@kitchensink/db-schema-guard` digests the bundle the seed function holds. Two independent implementations over
 * one rendering, deliberately: a single shared helper can be wrong identically on both sides and still agree, and
 * sha256 has exactly one right answer. Asserted on the rendered TEXT as well as the digest, so a disagreement names
 * the line it happened on.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { isSeedBundleRefusedError, readSeedManifest } from '@kitchensink/db-schema-guard';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'runSeed.sh');
const FOOD = join(REPO_ROOT, 'packages', 'services', 'food-service');
const SEED_DATA = join(FOOD, 'src', 'foods', 'seed', 'data');

const scratch = mkdtempSync(join(tmpdir(), 'seedAgreement-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/** A tree of `path → content` under a fresh directory. */
function tree(files: readonly (readonly [string, string])[]): string {
    const root = mkdtempSync(join(scratch, 'tree-'));

    for (const [path, content] of files) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }

    return root;
}

interface ShellRun {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

/** Run one of the script's functions, sourced, as the pipeline's shell would. */
function shell(fn: 'run_seed_render' | 'run_seed_manifest', ...args: readonly string[]): ShellRun {
    // `$0` is a neutral name: were it the script's own path, sourcing would trip the script's CLI dispatch. The
    // locale's collation is NOT byte order, so the script's own `LC_ALL=C` is what keeps the two halves agreeing.
    const result = spawnSync('bash', ['-c', `source "$1" && shift && ${fn} "$@"`, 'bash', SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });

    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

const NESTED = [
    ['handler.js', 'export const handler = () => 1;\n'],
    ['data/curatedCatalog.jsonl', '{"key":"apple"}\n'],
    ['data/usda/sourcePins.json', '{}\n'],
] as const;

const C_ORDER = ['data0', 'a_b', 'data/x', 'Data', 'a.b', 'data.json', 'a-b'].map(
    (path) => [path, `${path}\n`] as const,
);

describe('runSeed.sh manifest and readSeedManifest agree', () => {
    it.each([
        ['a nested bundle', NESTED],
        ['names whose C order differs from a locale-aware order', C_ORDER],
    ] as const)('on the rendered text and the digest over %s', (_case, files) => {
        const root = tree(files);
        const typescript = readSeedManifest(root);

        // An empty stderr also proves the locale took: without it, bash warns and falls back to C, and this case
        // could no longer catch the script losing its own `LC_ALL=C`.
        expect(shell('run_seed_render', root)).toStrictEqual({ status: 0, stdout: typescript.text, stderr: '' });
        expect(shell('run_seed_manifest', root)).toStrictEqual({
            status: 0,
            stdout: `${typescript.sha}\n`,
            stderr: '',
        });
    });

    it('on the real committed seed data', () => {
        const typescript = readSeedManifest(SEED_DATA);

        expect(shell('run_seed_manifest', SEED_DATA).stdout).toBe(`${typescript.sha}\n`);
    });

    it('on the real seed asset, built as the pipeline builds it', { timeout: 120_000 }, () => {
        const outdir = join(scratch, 'distSeed');
        const build = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                'const { buildSeedAsset } = await import(process.argv[1]); await buildSeedAsset({ packageRoot: process.argv[2], outdir: process.argv[3] });',
                pathToFileURL(join(FOOD, 'seedAssetBuild.mjs')).href,
                FOOD,
                outdir,
            ],
            { encoding: 'utf8' },
        );

        expect(build.status, build.stderr).toBe(0);

        const typescript = readSeedManifest(outdir);

        // The asset is the bundle, the data and the verifier SQL — not the data alone.
        expect(typescript.files).toContain('lambdas/seed/handler.js');
        expect(typescript.files).toContain('verify/sql/checkRoots.sql');
        expect(shell('run_seed_render', outdir)).toStrictEqual({ status: 0, stdout: typescript.text, stderr: '' });
        expect(shell('run_seed_manifest', outdir).stdout).toBe(`${typescript.sha}\n`);
    });

    it('that a body edit under an unchanged name is a different digest', () => {
        const before = tree(NESTED);
        const after = tree(NESTED.map(([path, content]) => [path, path === 'handler.js' ? `${content} ` : content]));

        expect(shell('run_seed_manifest', after).stdout).not.toBe(shell('run_seed_manifest', before).stdout);
        expect(readSeedManifest(after).sha).not.toBe(readSeedManifest(before).sha);
    });
});

describe('both halves refuse the same bundles', () => {
    const refusals: readonly (readonly [string, () => string, RegExp])[] = [
        [
            'a tree with no file',
            () => {
                const root = tree([]);

                mkdirSync(join(root, 'data'));

                return root;
            },
            /no regular file/u,
        ],
        [
            'a symlink',
            () => {
                const root = tree(NESTED);

                symlinkSync(join(root, 'handler.js'), join(root, 'link.js'));

                return root;
            },
            /symlink.*link\.js/u,
        ],
        [
            'an unsafe name',
            () => tree([...NESTED, ['data/a b.json', '1']]),
            /outside the seed path contract.*data\/a\\ b\.json/u,
        ],
        [
            'a name holding a newline, which a line-delimited walk would split',
            () => tree([...NESTED, ['data/new\nline.json', '1']]),
            /outside the seed path contract.*new\\nline\.json/u,
        ],
        [
            'a special file',
            () => {
                const root = tree(NESTED);

                execFileSync('mkfifo', [join(root, 'data/pipe')]);

                return root;
            },
            /special file.*data\/pipe/u,
        ],
    ];

    it.each(refusals)(
        '⛔ %s: the shell exits 1 naming why and prints no digest, and TypeScript throws',
        (_case, make, why) => {
            const root = make();
            const run = shell('run_seed_manifest', root);

            expect(run.status).toBe(1);
            expect(run.stdout).toBe('');
            expect(run.stderr).toMatch(why);
            expect(() => readSeedManifest(root)).toThrow();

            try {
                readSeedManifest(root);
            } catch (error) {
                expect(isSeedBundleRefusedError(error)).toBe(true);
            }
        },
    );

    it('⛔ a directory that does not exist exits 1, and no argument is misuse (2)', () => {
        expect(shell('run_seed_manifest', join(scratch, 'absent')).status).toBe(1);
        expect(shell('run_seed_manifest').status).toBe(2);
    });
});
