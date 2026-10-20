// @vitest-environment node
/**
 * Repo-wide guard: the ONE door the seed and pool CLIs are run through (`packages/tools/e2e-seed/runCli.sh`).
 *
 * ## Why there is a door at all
 *
 * The Maestro jobs used to install the WHOLE monorepo to run four TypeScript CLIs through `tsx` — 8m26s of `npm ci` on a
 * 3-core macOS runner before the first iOS flow (run 39345702996). They now run self-contained esbuild bundles built once
 * per run on Linux (`cliBundle.mjs`). A developer's machine still runs the sources through `tsx`. So the same command
 * line has two meanings, and the choice between them is made in ONE place, here, rather than in every workflow step and
 * in `runMaestroFlows.sh` separately:
 *
 *   - `E2E_SEED_CLI_DIR` unset or empty: `npx --no-install tsx <source>` — the dev path. `--no-install`, because on a
 *     machine without the install `npx` would otherwise DOWNLOAD `tsx` and then fail on the first import, far from the
 *     cause.
 *   - `E2E_SEED_CLI_DIR` set: the bundle the manifest maps that SOURCE to, run with plain `node`. A source the manifest
 *     does not list, or a listed file that is missing, is REFUSED — it never falls back to `tsx`, because on a runner
 *     with no `node_modules` the fallback cannot work and would fail somewhere that does not name the cause.
 *
 * The command line names the SOURCE (`packages/tools/e2e-seed/src/resetPool.ts`), never the bundle file, so every guard
 * that discovers a step by what it runs (`testPoolWorkflowWiring`, `maestroStageGuard`, `runtimeUserCreation`) still
 * finds it.
 *
 * ## Why the bundle is run by its PHYSICAL path
 *
 * `resetPool` and `poolAdmin` run their `main()` only when `import.meta.url === pathToFileURL(process.argv[1]).href`.
 * Node resolves the module URL through symlinks but leaves `argv[1]` as given, so a bundle reached through a symlinked
 * directory would load, skip `main()`, and EXIT 0 — a pool reset that reports success having reset nothing. The door
 * resolves the directory with `pwd -P` first; the symlink case below holds it.
 *
 * ## `verify`
 *
 * `runCli.sh verify <dir> <commit>` is the consumer's proof that the bundles are this run's: the manifest's commit must
 * equal the job's own `GITHUB_SHA`, and every file it lists must be present.
 *
 * Executed as real bash with `node` and `npx` stubbed on `PATH`, recording their argv. Mutation lens: falling back to
 * `tsx` when the directory is set reds the refusal cases; matching the manifest by prefix reds the prefix case; dropping
 * `pwd -P` reds the symlink case; skipping the commit comparison reds the verify cases.
 */
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../tools/e2e-seed/runCli.sh', import.meta.url));
const RESET = 'packages/tools/e2e-seed/src/reset.ts';
const RESET_POOL = 'packages/tools/e2e-seed/src/resetPool.ts';
const POOL_ADMIN = 'packages/tools/e2e-fixtures/src/poolAdmin.ts';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

interface Run {
    readonly status: number;
    readonly log: string;
    /** One line per stub call: `<tool>\t<argv joined by tabs>`. */
    readonly calls: readonly string[];
}

/** A scratch directory holding `node`/`npx` stubs that record their argv and exit with `STUB_EXIT`. */
function stubs(): { readonly dir: string; readonly bin: string; readonly calls: string } {
    const dir = mkdtempSync(join(tmpdir(), 'seed-cli-door-'));

    scratch.push(dir);

    const bin = join(dir, 'bin');
    const calls = join(dir, 'calls.log');

    mkdirSync(bin);
    writeFileSync(calls, '');

    for (const tool of ['node', 'npx']) {
        writeFileSync(
            join(bin, tool),
            `#!/usr/bin/env bash\n{ printf '%s' '${tool}'; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "${calls}"\nexit "\${STUB_EXIT:-0}"\n`,
        );
        chmodSync(join(bin, tool), 0o755);
    }

    return { dir, bin, calls };
}

/**
 * A bundle directory: a manifest naming `entries`, and the files in `present`.
 *
 * @sideEffect Writes the directory.
 */
function bundleDir(
    parent: string,
    options: {
        readonly commit?: string;
        readonly entries?: readonly (readonly [string, string])[];
        readonly present?: readonly string[];
        readonly manifest?: boolean;
    } = {},
): string {
    const dir = join(parent, 'seedCli');
    const entries = options.entries ?? [
        [RESET, 'reset.mjs'],
        [RESET_POOL, 'resetPool.mjs'],
        [POOL_ADMIN, 'poolAdmin.mjs'],
    ];

    mkdirSync(dir, { recursive: true });

    if (options.manifest !== false) {
        writeFileSync(
            join(dir, 'seedCli.manifest'),
            [
                `commit ${options.commit ?? COMMIT}`,
                ...entries.map(([source, file]) => `entry ${source} ${file}`),
                '',
            ].join('\n'),
        );
    }

    for (const file of options.present ?? entries.map(([, file]) => file)) {
        writeFileSync(join(dir, file), '// bundle\n');
    }

    return dir;
}

/** Run the door with `args`, `E2E_SEED_CLI_DIR` set to `cliDir` (or absent when `undefined`). */
function run(args: readonly string[], cliDir: string | undefined, stubExit = '0'): Run {
    const { dir, bin, calls } = stubs();
    const env: Record<string, string> = { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: dir, STUB_EXIT: stubExit };

    if (cliDir !== undefined) {
        env['E2E_SEED_CLI_DIR'] = cliDir;
    }

    const result = spawnSync('bash', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });

    return {
        status: result.status ?? -1,
        log: `${result.stdout}${result.stderr}`,
        calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean),
    };
}

describe('the dev path: no bundle directory runs the source through the installed tsx', () => {
    it('runs `npx --no-install tsx <source> <args>` and never node', () => {
        const outcome = run([RESET, '--mode', 'seeded'], undefined);

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.calls).toStrictEqual([`npx\t--no-install\ttsx\t${RESET}\t--mode\tseeded`]);
    });

    it('treats an EMPTY directory variable as unset — the dev path, not a refusal', () => {
        const outcome = run([RESET, '--mode', 'empty'], '');

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.calls).toStrictEqual([`npx\t--no-install\ttsx\t${RESET}\t--mode\tempty`]);
    });

    it('passes the CLI’s own exit status through', () => {
        expect(run([RESET], undefined, '3').status).toBe(3);
    });
});

describe('the CI path: a bundle directory runs the bundle the manifest maps the source to', () => {
    it('runs `node --enable-source-maps <dir>/<bundle> <args>` and never tsx', () => {
        const parent = stubs().dir;
        const dir = bundleDir(parent);
        const outcome = run([RESET_POOL, '--tier', 'maestro', '--shard', '2'], dir);

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.calls).toStrictEqual([
            `node\t--enable-source-maps\t${realpathSync(dir)}/resetPool.mjs\t--tier\tmaestro\t--shard\t2`,
        ]);
    });

    it('passes the bundle’s own exit status through', () => {
        const dir = bundleDir(stubs().dir);

        expect(run([POOL_ADMIN, '--apply'], dir, '5').status).toBe(5);
    });

    it('⛔ runs the bundle by its PHYSICAL path, so a main-guarded CLI cannot load, skip main() and exit 0', () => {
        const parent = stubs().dir;
        const real = bundleDir(parent);
        const link = join(parent, 'linked');

        symlinkSync(real, link);

        const outcome = run([RESET_POOL], link);

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.calls).toStrictEqual([`node\t--enable-source-maps\t${realpathSync(real)}/resetPool.mjs`]);
    });

    it('⛔ refuses a source the manifest does not list — and does NOT fall back to tsx', () => {
        const dir = bundleDir(stubs().dir);
        const outcome = run(['packages/tools/e2e-seed/src/provision.ts'], dir);

        expect(outcome.status).not.toBe(0);
        expect(outcome.log).toMatch(/::error::.*packages\/tools\/e2e-seed\/src\/provision\.ts/u);
        expect(outcome.calls).toStrictEqual([]);
    });

    it('⛔ matches the source EXACTLY — a prefix or a suffix of a listed source is not that source', () => {
        const dir = bundleDir(stubs().dir, { entries: [[RESET_POOL, 'resetPool.mjs']] });

        for (const source of [RESET, 'src/resetPool.ts', `${RESET_POOL}x`, 'tools/e2e-seed/src/resetPool.ts']) {
            const outcome = run([source], dir);

            expect(outcome.status, source).not.toBe(0);
            expect(outcome.calls, source).toStrictEqual([]);
        }
    });

    it('⛔ refuses a listed bundle whose file is missing', () => {
        const dir = bundleDir(stubs().dir, { present: ['reset.mjs', 'poolAdmin.mjs'] });
        const outcome = run([RESET_POOL], dir);

        expect(outcome.status).not.toBe(0);
        expect(outcome.log).toMatch(/::error::.*resetPool\.mjs/u);
        expect(outcome.calls).toStrictEqual([]);
    });

    it('⛔ refuses a directory with no manifest', () => {
        const dir = bundleDir(stubs().dir, { manifest: false });
        const outcome = run([RESET], dir);

        expect(outcome.status).not.toBe(0);
        expect(outcome.log).toMatch(/::error::.*seedCli\.manifest/u);
        expect(outcome.calls).toStrictEqual([]);
    });

    it('refuses to run with no source at all', () => {
        const outcome = run([], undefined);

        expect(outcome.status).not.toBe(0);
        expect(outcome.calls).toStrictEqual([]);
    });
});

describe('verify: the bundles are this run’s, and whole', () => {
    it('passes when the manifest’s commit is the expected one and every listed file is present', () => {
        const dir = bundleDir(stubs().dir);
        const outcome = run(['verify', dir, COMMIT], undefined);

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.log).toContain(COMMIT);
        expect(outcome.calls).toStrictEqual([]);
    });

    it('⛔ refuses bundles built from another commit, naming both', () => {
        const other = 'fedcba9876543210fedcba9876543210fedcba98';
        const dir = bundleDir(stubs().dir, { commit: other });
        const outcome = run(['verify', dir, COMMIT], undefined);

        expect(outcome.status).not.toBe(0);
        expect(outcome.log).toMatch(/::error::/u);
        expect(outcome.log).toContain(other);
        expect(outcome.log).toContain(COMMIT);
    });

    it('⛔ refuses an EMPTY expected commit — an unset GITHUB_SHA must not match a manifest with no commit', () => {
        const dir = bundleDir(stubs().dir, { commit: '' });

        expect(run(['verify', dir, ''], undefined).status).not.toBe(0);
        expect(run(['verify', bundleDir(stubs().dir), ''], undefined).status).not.toBe(0);
    });

    it('⛔ refuses a manifest that lists a file the directory does not hold', () => {
        const dir = bundleDir(stubs().dir, { present: ['reset.mjs'] });
        const outcome = run(['verify', dir, COMMIT], undefined);

        expect(outcome.status).not.toBe(0);
        expect(outcome.log).toMatch(/::error::.*resetPool\.mjs/u);
    });

    it('⛔ refuses a directory with no manifest, and a manifest that lists no bundle at all', () => {
        expect(run(['verify', bundleDir(stubs().dir, { manifest: false }), COMMIT], undefined).status).not.toBe(0);
        expect(run(['verify', bundleDir(stubs().dir, { entries: [] }), COMMIT], undefined).status).not.toBe(0);
    });
});
