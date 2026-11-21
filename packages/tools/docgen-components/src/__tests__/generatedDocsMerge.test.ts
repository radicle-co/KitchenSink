// @vitest-environment node
/**
 * Two PRs that each change a component change the same aggregate lines of `docs/generated/components` (`totals`,
 * `coverage`, `counts`), so every pair of parallel PRs conflicted on derived output that `generatedOutput.integration`
 * already refuses to let go stale. The cure is two parts, and each is proved here against real git:
 *
 *   1. `.gitattributes` gives every generator output folder the `docgenRegenerate` merge driver. The folders are read
 *      from `config.ts`, which is the generator's own list, so a third output folder cannot be forgotten.
 *   2. The driver keeps the current side (`installMergeDrivers.mjs` sets it to `true`), so the merge ends with no
 *      conflict, and `.husky/post-merge` then regenerates when a merge touched either folder.
 *
 * The merge is run in a temp repository that holds the real `.gitattributes`, so dropping the attribute makes the
 * merge conflict again and the test fail. Not covered, by design: GitHub's own conflict check ignores custom drivers,
 * and a merge made with `--no-commit` never runs `post-merge`.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { COMPONENTS_OUT_DIR, DESIGN_OUT_DIR, REPO_ROOT } from '../config.js';

const OUT_DIRS = [COMPONENTS_OUT_DIR, DESIGN_OUT_DIR] as const;
const INSTALLER = join(REPO_ROOT, 'scripts/installMergeDrivers.mjs');
const POST_MERGE = join(REPO_ROOT, '.husky/post-merge');
const TOTALS_FILE = `${COMPONENTS_OUT_DIR}/index.json`;

const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

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
        execFileSync('node', [INSTALLER], { cwd: repo });
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
        `{\n    "totals": { "components": ${components} },\n    "schemaVersion": 1\n}\n`,
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

describe('the post-merge hook regenerates when a merge touched an output folder', () => {
    /** A repo where `main` merges a branch that changed `changed`, and the hook runs with a stub `npm` on the path. */
    function runHookAfterMergeOf(changed: string): string[] {
        const repo = makeRepo(true);
        const bin = mkdtempSync(join(tmpdir(), 'docgenNpm-'));
        scratch.push(bin);
        const calls = join(bin, 'calls.txt');
        writeFileSync(join(bin, 'npm'), `#!/bin/sh\necho "$@" >> '${calls}'\n`, 'utf8');
        chmodSync(join(bin, 'npm'), 0o755);

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

        execFileSync('sh', [POST_MERGE], {
            cwd: repo,
            env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` },
            stdio: 'ignore',
        });

        return readFileSafe(calls);
    }

    const readFileSafe = (file: string): string[] => {
        try {
            return readFileSync(file, 'utf8').trim().split('\n');
        } catch {
            return [];
        }
    };

    it.each(OUT_DIRS)('runs docs:generate when a file under %s changed', (directory) => {
        expect(runHookAfterMergeOf(`${directory}/groups/a.json`)).toEqual([
            'run docs:generate --workspace=@kitchensink/docgen-components',
        ]);
    });

    it('does nothing when the merge touched neither folder', () => {
        expect(runHookAfterMergeOf('packages/x/readme.md')).toEqual([]);
    });

    it('never commits or stages: the author reviews the regenerated files', () => {
        const hook = readFileSync(POST_MERGE, 'utf8');

        expect(hook).not.toMatch(/git (add|commit)/u);
    });
});
