// @vitest-environment node
/**
 * `deployKey.sh`: the CONTENT KEY that names a sandbox image (ADR-0067). It is the sha256 of the git objects of a
 * deployable's image closure (`imageClosures.tsv`), so it moves exactly when something the build reads moves:
 *
 *  - the same tree gives the same key in any commit, a merge commit included, and the key never contains a commit;
 *  - an edit inside the closure gives a new key; an edit outside it (a CDK app, a guard, a test) does not;
 *  - a path the closure names that the revision lacks is a STALE closure, refused rather than skipped, because
 *    skipping it would hash fewer inputs than the build reads;
 *  - with `--require-clean`, uncommitted changes to a closure path are refused: a key read from HEAD while the
 *    tree holds something else names an image nobody can rebuild.
 *
 * Run against throwaway git repositories, so the script's real `git` calls are what is tested.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github', 'scripts', 'deployKey.sh');
const CLOSURES = 'docs/generated/infrastructure/imageClosures.tsv';
const scratch: string[] = [];

afterAll(() => {
    for (const dir of scratch) {
        rmSync(dir, { recursive: true, force: true });
    }
});

const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 't',
            GIT_AUTHOR_EMAIL: 't@example.invalid',
            GIT_COMMITTER_NAME: 't',
            GIT_COMMITTER_EMAIL: 't@example.invalid',
        },
    }).trim();

const write = (repo: string, file: string, contents: string): void => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), contents);
};

/** A repository with one deployable whose closure is `app/src`, `app/Dockerfile` and the lockfile. */
function makeRepo(): string {
    const repo = mkdtempSync(path.join(tmpdir(), 'deployKey-'));

    scratch.push(repo);
    git(repo, 'init', '-q', '-b', 'main');
    write(repo, 'app/src/main.ts', 'export const a = 1;\n');
    write(repo, 'app/Dockerfile', 'FROM node:24-slim\n');
    write(repo, 'app/infra/stack.ts', 'export const stack = 1;\n');
    write(repo, 'package-lock.json', '{}\n');
    write(repo, 'guards/check.ts', 'export const guard = 1;\n');
    write(repo, CLOSURES, '# generated\nsvc\tapp/Dockerfile\nsvc\tapp/src\nsvc\tpackage-lock.json\nother\tguards\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');

    return repo;
}

const commitEdit = (repo: string, file: string, contents: string): string => {
    write(repo, file, contents);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', `edit ${file}`);

    return git(repo, 'rev-parse', 'HEAD');
};

const key = (repo: string, ...args: string[]) =>
    spawnSync('bash', [SCRIPT, 'key', ...args], { cwd: repo, encoding: 'utf8' });

const keyOf = (repo: string, ...args: string[]): string => {
    const result = key(repo, ...args);

    expect(result.status, result.stderr).toBe(0);

    return result.stdout.trim();
};

describe('deployKey.sh key', () => {
    it('prints 64 lowercase hex characters and nothing else', () => {
        const result = key(makeRepo(), 'svc');

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/^[0-9a-f]{64}\n$/u);
    });

    it('gives the same key for the same closure in two different commits, and never contains a commit', () => {
        const repo = makeRepo();
        const before = keyOf(repo, 'svc');
        const after = commitEdit(repo, 'app/infra/stack.ts', 'export const stack = 2;\n');

        expect(keyOf(repo, 'svc')).toBe(before);
        expect(before).not.toContain(after);
        expect(before).not.toContain(after.slice(0, 12));
    });

    it('gives the same key at a merge commit that holds the same closure', () => {
        const repo = makeRepo();
        const base = keyOf(repo, 'svc');

        git(repo, 'checkout', '-q', '-b', 'side');
        commitEdit(repo, 'guards/check.ts', 'export const guard = 2;\n');
        git(repo, 'checkout', '-q', 'main');
        commitEdit(repo, 'app/infra/stack.ts', 'export const stack = 3;\n');
        git(repo, 'merge', '-q', '--no-edit', 'side');

        expect(keyOf(repo, 'svc')).toBe(base);
    });

    it.each([
        ['a source file', 'app/src/main.ts'],
        ['the Dockerfile', 'app/Dockerfile'],
        ['the lockfile', 'package-lock.json'],
    ])('gives a new key when %s changes', (_label, file) => {
        const repo = makeRepo();
        const before = keyOf(repo, 'svc');

        commitEdit(repo, file, 'changed\n');

        expect(keyOf(repo, 'svc')).not.toBe(before);
    });

    it.each([
        ['its CDK app', 'app/infra/stack.ts'],
        ['a guard outside its closure', 'guards/check.ts'],
    ])('keeps the key when %s changes', (_label, file) => {
        const repo = makeRepo();
        const before = keyOf(repo, 'svc');

        commitEdit(repo, file, 'changed\n');

        expect(keyOf(repo, 'svc')).toBe(before);
    });

    it('reads the key at a named revision, not the working tree', () => {
        const repo = makeRepo();
        const first = git(repo, 'rev-parse', 'HEAD');
        const before = keyOf(repo, 'svc');

        commitEdit(repo, 'app/src/main.ts', 'export const a = 2;\n');

        expect(keyOf(repo, 'svc', first)).toBe(before);
        expect(keyOf(repo, 'svc')).not.toBe(before);
    });

    it('gives two deployables different keys', () => {
        const repo = makeRepo();

        expect(keyOf(repo, 'svc')).not.toBe(keyOf(repo, 'other'));
    });

    it('refuses a closure path the revision does not hold (a stale closure), printing nothing', () => {
        const repo = makeRepo();

        git(repo, 'rm', '-q', 'app/Dockerfile');
        git(repo, 'commit', '-q', '-m', 'drop the Dockerfile');

        const result = key(repo, 'svc');

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('app/Dockerfile');
    });

    it('refuses a deployable the closure does not name, printing nothing', () => {
        const result = key(makeRepo(), 'nobody');

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
    });

    it('refuses uncommitted changes to a closure path with --require-clean', () => {
        const repo = makeRepo();

        write(repo, 'app/src/main.ts', 'export const a = 9;\n');

        const result = key(repo, 'svc', 'HEAD', '--require-clean');

        expect(result.status).toBe(3);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('app/src');
    });

    it('accepts uncommitted changes OUTSIDE the closure with --require-clean', () => {
        const repo = makeRepo();

        write(repo, 'app/infra/stack.ts', 'export const stack = 9;\n');

        expect(key(repo, 'svc', 'HEAD', '--require-clean').status).toBe(0);
    });

    it.each([[[]], [['key']], [['bogus', 'svc']]])('refuses %j with the usage status', (args) => {
        const result = spawnSync('bash', [SCRIPT, ...args], { cwd: makeRepo(), encoding: 'utf8' });

        expect(result.status).toBe(2);
    });
});
