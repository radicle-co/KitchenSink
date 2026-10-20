/**
 * The seed and pool CLIs as self-contained bundles, built exactly as CI builds them (`cliBundle.mjs`).
 *
 * The Maestro jobs no longer install the monorepo (8m26s of `npm ci` on a 3-core macOS runner before the first iOS flow,
 * run 39345702996). They run these bundles with plain `node`, on a runner whose only JavaScript is the bundles
 * themselves. So the properties pinned here are the ones whose failure would show up there, as a red that names nothing
 * useful:
 *
 * - **Self-contained.** Each bundle runs from a directory with no `node_modules` above it, under an empty environment,
 *   and gets as far as its OWN refusal — the env check inside `readSeedEnvironment`, or `poolAdmin`'s key check inside
 *   `main()`. Reaching that line means the whole module graph loaded and the main guard fired. A dependency left
 *   external would stop it first with `ERR_MODULE_NOT_FOUND`; the only imports a bundle may leave are Node built-ins.
 * - **One CLI per bundle.** `resetPool` and `poolAdmin` start through `import.meta.url === argv[1]`. Inside one bundle
 *   every module shares one `import.meta.url`, so a CLI that imported another CLI's module would run BOTH `main()`s.
 *   No bundle may carry another bundle's entry module.
 * - **Built from source, never from a stale `dist/`.** Every first-party input is a source file. The jobs no longer
 *   build the closure first, so an input read out of a `dist/` would be whatever an earlier build left.
 * - **Closed.** The output directory holds exactly the manifest and each bundle with its source map, so a file the
 *   source no longer produces cannot ship; and the manifest names the commit it was built from, which each Maestro job
 *   checks against its own (`runCli.sh verify`).
 *
 * No network and no database: the bundles are run only as far as the refusal that precedes their first request.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../../..');
const BUILDER = join(PACKAGE_ROOT, 'cliBundle.mjs');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** Two builds and four bundle runs. */
const TIMEOUT_MS = 120_000;

/** One CLI, as `cliBundle.mjs` declares it. */
interface SeedCli {
    readonly name: string;
    readonly entry: string;
    readonly source: string;
}

/** The slice of esbuild's metafile these rules read. */
interface Metafile {
    readonly inputs: Readonly<Record<string, unknown>>;
    readonly outputs: Readonly<
        Record<
            string,
            {
                readonly entryPoint?: string;
                readonly inputs: Readonly<Record<string, unknown>>;
                readonly imports: readonly { readonly path: string; readonly external?: boolean }[];
            }
        >
    >;
}

/** What each CLI must say, from inside its own code, when it is started with no environment and no arguments. */
const REFUSAL: Readonly<Record<string, RegExp>> = {
    provision: /e2e-seed: missing required environment/u,
    reset: /e2e-seed: missing required environment/u,
    resetPool: /e2e-seed: missing required environment/u,
    poolAdmin: /poolAdmin: CLERK_SECRET_KEY is required/u,
};

// The PHYSICAL path: on macOS `tmpdir()` is under a symlink (`/var` → `/private/var`), and a main-guarded bundle run
// through a symlink loads, skips `main()` and exits 0 — the case `runCli.sh` resolves with `pwd -P`.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'seedCliBundle-')));
const outdir = join(scratch, 'out');

let clis: readonly SeedCli[] = [];
let metafile: Metafile = { inputs: {}, outputs: {} };

/**
 * Narrow the builder module's export, which a dynamic import types as `unknown`.
 *
 * @throws {Error} when the export is not a list of `{ name, entry, source }`.
 */
function asClis(value: unknown): readonly SeedCli[] {
    if (
        !Array.isArray(value) ||
        !value.every(
            (cli: unknown) =>
                typeof cli === 'object' &&
                cli !== null &&
                ['name', 'entry', 'source'].every((key) => typeof (cli as Record<string, unknown>)[key] === 'string'),
        )
    ) {
        throw new Error('cliBundle.mjs does not export SEED_CLIS as a list of { name, entry, source }');
    }

    return value as readonly SeedCli[];
}

/**
 * Run `cliBundle.mjs` as CI does, in a child `node`.
 *
 * @sideEffect Spawns node, which empties and writes `args`' outdir.
 */
function build(args: readonly string[]): { readonly status: number; readonly log: string } {
    const result = spawnSync(process.execPath, [BUILDER, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });

    return { status: result.status ?? -1, log: `${result.stdout}${result.stderr}` };
}

beforeAll(async () => {
    const module: unknown = await import(pathToFileURL(BUILDER).href);

    clis = asClis((module as Record<string, unknown>)['SEED_CLIS']);

    const built = build(['--outdir', outdir, '--commit', COMMIT]);

    expect(built.status, built.log).toBe(0);

    // The metafile is not written into the output (it would ship); the builder returns it, so read it the same way.
    const meta = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            'const { buildSeedClis } = await import(process.argv[1]); const { metafile } = await buildSeedClis({ outdir: process.argv[2], commit: process.argv[3] }); process.stdout.write(JSON.stringify(metafile));',
            pathToFileURL(BUILDER).href,
            join(scratch, 'meta'),
            COMMIT,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    expect(meta.status, meta.stderr).toBe(0);
    metafile = JSON.parse(meta.stdout) as Metafile;
}, TIMEOUT_MS);

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

describe('the declared CLIs', () => {
    it('are exactly the four the Maestro jobs run, each from a source file that exists', () => {
        expect(clis.map((cli) => cli.name).sort()).toStrictEqual(['poolAdmin', 'provision', 'reset', 'resetPool']);

        for (const cli of clis) {
            expect(existsSync(join(REPO_ROOT, cli.source)), cli.source).toBe(true);
        }
    });
});

describe('the output directory', () => {
    it('holds exactly the manifest and each bundle with its source map', () => {
        const expected = ['seedCli.manifest', ...clis.flatMap((cli) => [`${cli.name}.mjs`, `${cli.name}.mjs.map`])];

        expect(readdirSync(outdir).sort()).toStrictEqual(expected.sort());
    });

    it('names the commit it was built from, then maps each source to its bundle, one line each', () => {
        expect(readFileSync(join(outdir, 'seedCli.manifest'), 'utf8')).toBe(
            [`commit ${COMMIT}`, ...clis.map((cli) => `entry ${cli.source} ${cli.name}.mjs`), ''].join('\n'),
        );
    });

    it('⛔ refuses to build without a commit, and touches nothing when it refuses', () => {
        const refusedDir = join(scratch, 'refused');
        const refused = build(['--outdir', refusedDir]);

        expect(refused.status).not.toBe(0);
        expect(existsSync(refusedDir)).toBe(false);
    });

    it(
        'is EMPTIED before it is written, so a file the source no longer produces cannot ship',
        () => {
            const again = join(scratch, 'again');

            expect(build(['--outdir', again, '--commit', COMMIT]).status).toBe(0);
            cpSync(join(again, 'reset.mjs'), join(again, 'stale.mjs'));
            expect(build(['--outdir', again, '--commit', COMMIT]).status).toBe(0);
            expect(existsSync(join(again, 'stale.mjs'))).toBe(false);
        },
        TIMEOUT_MS,
    );
});

describe('⛔ each bundle runs with no node_modules and no environment, as far as its own refusal', () => {
    const isolated = join(scratch, 'isolated');

    beforeAll(() => {
        // Away from the repository, so nothing can resolve through a node_modules above it.
        cpSync(outdir, isolated, { recursive: true });
    });

    it.each(Object.keys(REFUSAL))('%s', (name) => {
        const result = spawnSync(process.execPath, ['--enable-source-maps', join(isolated, `${name}.mjs`)], {
            cwd: isolated,
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', HOME: isolated },
        });

        expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)/u);
        expect(result.stderr).toMatch(REFUSAL[name] ?? /(?!)/u);
        expect(result.status).toBe(1);
        // provision's stdout IS the fixture manifest the flows read: a refusal must write nothing there.
        expect(result.stdout).toBe('');
    });
});

describe('the bundles’ contents (esbuild’s own metafile)', () => {
    const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
    const bundles = () => Object.entries(metafile.outputs).filter(([path]) => path.endsWith('.mjs'));
    const firstParty = (path: string) => !path.includes('node_modules/');

    it('produces one bundle per CLI (non-vacuity)', () => {
        expect(bundles()).toHaveLength(clis.length);
    });

    it('⛔ leaves no import unresolved but Node’s own built-ins', () => {
        for (const [path, output] of bundles()) {
            const external = output.imports.filter((entry) => entry.external === true).map((entry) => entry.path);

            expect(
                external.filter((specifier) => !builtins.has(specifier)),
                path,
            ).toStrictEqual([]);
        }
    });

    it('⛔ starts each bundle from its declared source, and carries no OTHER CLI’s entry module', () => {
        for (const cli of clis) {
            const [, output] = bundles().find(([path]) => path.endsWith(`/${cli.name}.mjs`)) ?? [];
            const sourceOf = (input: string) => resolve(PACKAGE_ROOT, input);

            expect(output, cli.name).toBeDefined();
            expect(sourceOf(output?.entryPoint ?? ''), cli.name).toBe(join(REPO_ROOT, cli.source));

            const others = clis.filter((other) => other !== cli).map((other) => join(REPO_ROOT, other.source));
            const carried = Object.keys(output?.inputs ?? {}).map(sourceOf);

            expect(
                carried.filter((input) => others.includes(input)),
                `${cli.name} would also run another CLI's main()`,
            ).toStrictEqual([]);
        }
    });

    it('⛔ reads every first-party module from source, never from a dist/ an earlier build left', () => {
        const fromDist = Object.keys(metafile.inputs).filter(
            (path) => firstParty(path) && /(?:^|\/)dist\//u.test(path),
        );

        expect(fromDist).toStrictEqual([]);
        // Non-vacuity: the workspace packages really are inlined, not left external.
        expect(
            Object.keys(metafile.inputs).some((path) => firstParty(path) && path.includes('e2e-fixtures/src/')),
        ).toBe(true);
    });
});
