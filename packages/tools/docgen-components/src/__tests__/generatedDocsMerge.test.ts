// @vitest-environment node
/**
 * Two PRs that each change a component change the same aggregate lines of `docs/generated/components` (`totals`,
 * `coverage`, `counts`), so every pair of parallel PRs conflicted on derived output that `generatedOutput.integration`
 * already refuses to let go stale. The cure is three parts, and each is proved here against real git:
 *
 *   1. `.gitattributes` gives every generator output folder the `docgenRegenerate` merge driver. The folders are read
 *      from `config.ts`, which is the generator's own list, so a third output folder cannot be forgotten.
 *   2. The root `prepare` script runs the installer, since nothing else puts the driver on a machine.
 *   3. The driver keeps the current side (`installMergeDrivers.mjs` sets it to `true`), so the merge ends with no
 *      conflict, and the one after-merge script (`bin/afterMerge.ts`, run by `.husky/post-merge` and, for a merge
 *      commit, by `.husky/post-commit`) regenerates when the INCOMING side changed either folder. It reads the
 *      incoming side because the driver hides a both-sides change from the merge result.
 *
 * The merge is run in a temp repository that holds the real `.gitattributes`, so dropping the attribute makes the
 * merge conflict again and the test fail. Not covered, by design: GitHub's own conflict check ignores custom drivers,
 * and a rebase runs neither hook (CI's generated-docs check still fails stale output).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { COMPONENTS_OUT_DIR, DESIGN_OUT_DIR, REPO_ROOT } from '../config.js';

const OUT_DIRS = [COMPONENTS_OUT_DIR, DESIGN_OUT_DIR] as const;
const INSTALLER = join(REPO_ROOT, 'scripts/installMergeDrivers.mjs');
const POST_MERGE = join(REPO_ROOT, '.husky/post-merge');
const POST_COMMIT = join(REPO_ROOT, '.husky/post-commit');
const TSX = join(REPO_ROOT, 'node_modules/.bin/tsx');
const AFTER_MERGE = join(REPO_ROOT, 'packages/tools/docgen-components/bin/afterMerge.ts');
const TOTALS_FILE = `${COMPONENTS_OUT_DIR}/index.json`;

/** Absolute, so the test never resolves a command through a PATH it does not control. */
const GIT = '/usr/bin/git';

const git = (cwd: string, ...args: string[]): string =>
    execFileSync(GIT, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const scratch: string[] = [];

afterEach(() => {
    for (const directory of scratch.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/** A repository with the real `.gitattributes`, one totals file on `main`, and the driver installed when asked. */
function makeRepo(installDriver: boolean): string {
    const repo = mkdtempSync(join(tmpdir(), 'docgenMerge-'));
    scratch.push(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    copyFileSync(join(REPO_ROOT, '.gitattributes'), join(repo, '.gitattributes'));

    if (installDriver) {
        execFileSync(process.execPath, [INSTALLER], { cwd: repo });
    }

    writeTotals(repo, 10);
    git(repo, 'add', '.gitattributes', TOTALS_FILE);
    git(repo, 'commit', '-qm', 'base');

    return repo;
}

function writeTotals(repo: string, components: number): void {
    mkdirSync(join(repo, COMPONENTS_OUT_DIR), { recursive: true });
    writeFileSync(
        join(repo, TOTALS_FILE),
        `{\n    "totals": { "components": ${String(components)} },\n    "schemaVersion": 1\n}\n`,
        'utf8',
    );
}

/** Two branches that change the same totals line differently, then `main` merges the second into the first. */
function mergeTwoPrs(repo: string): { readonly merged: boolean; readonly text: string } {
    git(repo, 'checkout', '-qb', 'prA');
    writeTotals(repo, 11);
    git(repo, 'commit', '-qam', 'A adds a component');
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'checkout', '-qb', 'prB');
    writeTotals(repo, 12);
    git(repo, 'commit', '-qam', 'B adds a component');
    git(repo, 'checkout', '-q', 'prA');

    let merged = true;

    try {
        git(repo, 'merge', '-q', '--no-edit', 'prB');
    } catch {
        merged = false;
    }

    return { merged, text: readFileSync(join(repo, TOTALS_FILE), 'utf8') };
}

describe('the output folders carry the merge driver', () => {
    it.each(OUT_DIRS)('%s and its subfolders are attributed to docgenRegenerate', (directory) => {
        const files = [`${directory}/index.json`, `${directory}/groups/a.json`];
        const out = git(REPO_ROOT, 'check-attr', 'merge', '--', ...files);

        expect(out.trim().split('\n')).toEqual(files.map((file) => `${file}: merge: docgenRegenerate`));
    });
});

describe('a checkout installs the driver', () => {
    it('runs the installer from the root prepare script, so every npm install sets it up', () => {
        const manifest = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');

        expect(manifest).toMatch(/"prepare":\s*"[^"]*node scripts\/installMergeDrivers\.mjs/u);
    });
});

describe('a merge of two PRs that change the same totals line', () => {
    it('conflicts without the driver, which is what this exists to cure', () => {
        const { merged } = mergeTwoPrs(makeRepo(false));

        expect(merged).toBe(false);
    });

    it('ends with no conflict and the current side kept, with the driver installed', () => {
        const { merged, text } = mergeTwoPrs(makeRepo(true));

        expect(merged).toBe(true);
        expect(text).toContain('"components": 11');
        expect(text).not.toContain('<<<<<<<');
    });
});

describe('the after-merge script regenerates when the incoming side changed an output folder', () => {
    /** The stub `npm` records its arguments, one line per call, so a test counts the `docs:generate` runs. */
    function stubNpm(): { readonly bin: string; readonly calls: () => string[] } {
        const bin = mkdtempSync(join(tmpdir(), 'docgenNpm-'));
        scratch.push(bin);
        const log = join(bin, 'calls.txt');
        writeFileSync(
            join(bin, 'npm.js'),
            `require('node:fs').appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');\n`,
            'utf8',
        );

        return {
            bin,
            calls: () => {
                try {
                    return readFileSync(log, 'utf8').trim().split('\n');
                } catch {
                    return [];
                }
            },
        };
    }

    /** What a hook does: runs the script in the repository, with `npm_execpath` pointing at the stub `npm`. */
    function runAfterMerge(repo: string, bin: string): void {
        execFileSync(TSX, [AFTER_MERGE], {
            cwd: repo,
            env: { ...process.env, npm_execpath: join(bin, 'npm.js') },
            stdio: 'ignore',
        });
    }

    const GENERATE = 'run docs:generate --workspace=@kitchensink/docgen-components';

    /** `main` merges a branch that changed `changed`, a file `main` never touched. */
    function mergeOfUntouchedFile(changed: string): { readonly repo: string } {
        const repo = makeRepo(true);
        git(repo, 'checkout', '-qb', 'feature');
        mkdirSync(join(repo, changed, '..'), { recursive: true });
        writeFileSync(join(repo, changed), 'x\n', 'utf8');
        git(repo, 'add', changed);
        git(repo, 'commit', '-qm', 'feature');
        git(repo, 'checkout', '-q', 'main');
        writeFileSync(join(repo, 'other.txt'), 'y\n', 'utf8');
        git(repo, 'add', 'other.txt');
        git(repo, 'commit', '-qm', 'main moves');
        git(repo, 'merge', '-q', '--no-edit', 'feature');

        return { repo };
    }

    it.each(OUT_DIRS)('runs docs:generate when a file under %s changed on the incoming side', (directory) => {
        const { repo } = mergeOfUntouchedFile(`${directory}/groups/a.json`);
        const npm = stubNpm();

        runAfterMerge(repo, npm.bin);

        expect(npm.calls()).toEqual([GENERATE]);
    });

    it('does nothing when the merge touched neither folder', () => {
        const { repo } = mergeOfUntouchedFile('packages/x/readme.md');
        const npm = stubNpm();

        runAfterMerge(repo, npm.bin);

        expect(npm.calls()).toEqual([]);
    });

    /**
     * The case the driver exists for. Both sides changed the same generated file, and the `true` driver keeps ours, so
     * the merge result shows NO change to it: only the incoming side's own diff tells the script to regenerate.
     */
    it('runs docs:generate once when both sides changed the same generated file', () => {
        const repo = makeRepo(true);
        expect(mergeTwoPrs(repo).merged).toBe(true);
        const npm = stubNpm();

        runAfterMerge(repo, npm.bin);

        expect(npm.calls()).toEqual([GENERATE]);
    });

    it('runs docs:generate once for a merge made with --no-commit and committed by hand', () => {
        const repo = makeRepo(true);
        git(repo, 'checkout', '-qb', 'prA');
        writeTotals(repo, 11);
        git(repo, 'commit', '-qam', 'A adds a component');
        git(repo, 'checkout', '-q', 'main');
        git(repo, 'checkout', '-qb', 'prB');
        writeTotals(repo, 12);
        git(repo, 'commit', '-qam', 'B adds a component');
        git(repo, 'checkout', '-q', 'prA');
        git(repo, 'merge', '-q', '--no-commit', '--no-ff', 'prB');
        git(repo, 'commit', '-qm', 'merge prB');
        const npm = stubNpm();

        runAfterMerge(repo, npm.bin);

        expect(npm.calls()).toEqual([GENERATE]);
    });

    it('runs docs:generate after a fast-forward pull that changed an output folder', () => {
        const repo = makeRepo(true);
        git(repo, 'checkout', '-qb', 'feature');
        writeTotals(repo, 11);
        git(repo, 'commit', '-qam', 'feature adds a component');
        git(repo, 'checkout', '-q', 'main');
        git(repo, 'merge', '-q', '--ff-only', 'feature');
        const npm = stubNpm();

        runAfterMerge(repo, npm.bin);

        expect(npm.calls()).toEqual([GENERATE]);
    });
});

describe('the hooks call the one script', () => {
    it.each([POST_MERGE, POST_COMMIT])('%s runs docs:after-merge and never stages or commits', (hook) => {
        const text = readFileSync(hook, 'utf8');

        expect(text).toContain('npm run docs:after-merge --workspace=@kitchensink/docgen-components');
        expect(text).not.toMatch(/git (add|commit)/u);
    });

    it('guards post-commit so only a merge commit runs it', () => {
        expect(readFileSync(POST_COMMIT, 'utf8')).toMatch(/rev-parse -q --verify HEAD\^2/u);
    });
});
