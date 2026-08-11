/**
 * Guard for DRIFT LAYER 2 — the contract-drift gate (`scripts/contractDriftGate.mjs`).
 *
 * The gate's whole job is to fail when the checked-in wire-contract artifacts are not what the generator
 * produces. Its failure mode is therefore SILENCE: a gate that exits 0 on real drift is worse than no gate,
 * because the pipeline then certifies a published contract that describes a service which no longer exists.
 *
 * So this suite does not test that the script "works" on a clean tree — that assertion is worthless, since a
 * `return 0` would satisfy it. It builds REAL git repositories in a temp directory and drives the real script
 * against each of the four states drift can take, plus the two states in which the gate could be blind:
 *
 *  | state                              | why it is the hard case                                            |
 *  |------------------------------------|--------------------------------------------------------------------|
 *  | artifact MODIFIED                  | the ordinary stale-commit case                                     |
 *  | artifact ADDED (untracked)         | invisible to a bare `git diff` until the path is registered         |
 *  | artifact DELETED                   | `git add --all` STAGES it, so a diff against the INDEX goes clean   |
 *  | added AND deleted together         | the addition reds the step for the wrong reason and hides the other |
 *  | artifact `.gitignore`d             | `git add` skips it, so drift is unseeable AND the run is green      |
 *  | no contract present at all         | nothing to check, so a pass certifies nothing                       |
 *
 * The deleted and ignored rows are the two that a plausible-looking implementation gets wrong, and both were
 * measured against real git rather than reasoned about.
 *
 * The seventh case is not drift at all and is here because it was MISSED first time round: the gate must not
 * stage a contributor's content. `--intent-to-add` is not what makes the detection work (a mutant dropping it
 * passed every drift case above), it is what keeps `npm run contract:verify` from sweeping unrelated
 * work-in-progress into the developer's next commit — so that is the property asserted, not the flag.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    classifyDrift,
    formatDriftReport,
    formatIgnoredReport,
    hasDrift,
} from '../../../../scripts/contractDriftGate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const script = path.join(repoRoot, 'scripts/contractDriftGate.mjs');

/** The outcome of running the gate: its exit status and everything it printed. */
interface GateRun {
    readonly status: number;
    readonly output: string;
}

/** Run a command in `cwd`, throwing only on a spawn failure — a non-zero exit is DATA here. */
function run(command: string, args: readonly string[], cwd: string, input = ''): GateRun {
    try {
        const stdout = execFileSync(command, [...args], {
            cwd,
            input,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        return { status: 0, output: stdout };
    } catch (error: unknown) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };

        return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
}

/** Run the gate in `cwd`. */
function runGate(cwd: string): GateRun {
    return run(process.execPath, [script], cwd);
}

/** Write a file, creating parent directories. */
function write(root: string, relative: string, contents: string): void {
    const target = path.join(root, relative);

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
}

/**
 * Build a throwaway repo whose committed state mimics a generated contract package, and return its path.
 *
 * @sideEffect Creates a temp directory and initializes a git repository in it.
 */
function makeContractRepo(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'contract-drift-'));

    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'gate@test.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Gate Test'], { cwd: root });

    write(root, 'packages/schemas/recipe/openapi.yaml', 'openapi: 3.0.3\n');
    write(root, 'packages/schemas/recipe/src/contract-hash.ts', "export const CONTRACT_HASH = 'aaaa';\n");
    write(root, 'packages/schemas/recipe/src/schemas.ts', "export * from './schemas/x.schema.js';\n");
    write(
        root,
        'packages/services/recipe-service/src/contract/contract-hash.ts',
        "export const CONTRACT_HASH = 'aaaa';\n",
    );

    execFileSync('git', ['add', '--all'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '--no-verify', '-m', 'generated contract'], { cwd: root });

    return root;
}

/** Run a body against a fresh throwaway repo, cleaning up afterwards. */
function withContractRepo(body: (root: string) => void): void {
    const root = makeContractRepo();

    try {
        body(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe('the gate against a real repository', () => {
    it('passes when the committed artifacts match, and says how many documents it checked', () => {
        withContractRepo((root) => {
            const result = runGate(root);

            expect(result.status).toBe(0);
            expect(result.output).toContain('byte-identical');
            expect(result.output).toContain('1 document(s) checked');
        });
    });

    it('fails on a MODIFIED artifact and names it as stale', () => {
        withContractRepo((root) => {
            write(root, 'packages/schemas/recipe/src/contract-hash.ts', "export const CONTRACT_HASH = 'bbbb';\n");

            const result = runGate(root);

            expect(result.status).toBe(1);
            expect(result.output).toContain('Stale');
            expect(result.output).toContain('packages/schemas/recipe/src/contract-hash.ts');
            expect(result.output).toContain('::error::');
        });
    });

    it('fails on an ADDED artifact, which a bare `git diff` cannot see', () => {
        withContractRepo((root) => {
            write(root, 'packages/schemas/recipe/src/schemas/photos.schema.ts', 'export const x = 1;\n');

            const result = runGate(root);

            expect(result.status).toBe(1);
            expect(result.output).toContain('Uncommitted');
            expect(result.output).toContain('packages/schemas/recipe/src/schemas/photos.schema.ts');
        });
    });

    it('fails on a DELETED artifact — the case a diff against the INDEX reports clean', () => {
        withContractRepo((root) => {
            rmSync(path.join(root, 'packages/schemas/recipe/src/schemas.ts'));

            const result = runGate(root);

            expect(result.status).toBe(1);
            expect(result.output).toContain('Orphaned');
            expect(result.output).toContain('packages/schemas/recipe/src/schemas.ts');
        });
    });

    it('reports BOTH when one artifact is added and another deleted, rather than only the addition', () => {
        withContractRepo((root) => {
            rmSync(path.join(root, 'packages/schemas/recipe/src/schemas.ts'));
            write(root, 'packages/schemas/recipe/src/types.ts', 'export type X = 1;\n');

            const result = runGate(root);

            expect(result.status).toBe(1);
            expect(result.output).toContain('packages/schemas/recipe/src/schemas.ts');
            expect(result.output).toContain('packages/schemas/recipe/src/types.ts');
        });
    });

    it('does not stage the contributor’s content — it registers paths, so a later commit is unaffected', () => {
        withContractRepo((root) => {
            write(root, 'unrelated-work-in-progress.ts', 'export const wip = 1;\nexport const more = 2;\n');

            expect(runGate(root).status).toBe(1);

            // `--intent-to-add` records the path against an EMPTY blob, so the index holds no content and
            // `--cached --numstat` is empty. A plain `git add --all` would report `2  0  <path>` here, meaning
            // the gate had swept a developer's unrelated work into their next commit.
            const stagedContent = run('git', ['diff', '--cached', '--numstat'], root);

            expect(stagedContent.output.trim()).toBe('');
            expect(run('git', ['status', '--porcelain', 'unrelated-work-in-progress.ts'], root).output).toContain(
                ' A unrelated-work-in-progress.ts',
            );
        });
    });

    it('fails when a generated artifact is git-IGNORED, naming that as the cause', () => {
        withContractRepo((root) => {
            write(root, '.gitignore', 'packages/schemas/**/openapi.yaml\n');
            write(root, 'packages/schemas/recipe/openapi.yaml.new', 'openapi: 3.0.3\n');
            // A second, genuinely ignored generated file so the check has something to report.
            write(root, '.gitignore', 'packages/schemas/recipe/src/generated-extra.ts\n');
            write(root, 'packages/schemas/recipe/src/generated-extra.ts', 'export const x = 1;\n');
            execFileSync('git', ['add', '.gitignore'], { cwd: root });
            execFileSync('git', ['commit', '--quiet', '--no-verify', '-m', 'ignore generated'], { cwd: root });
            rmSync(path.join(root, 'packages/schemas/recipe/openapi.yaml.new'));

            const result = runGate(root);

            expect(result.status).toBe(1);
            expect(result.output).toContain('git-IGNORED');
            expect(result.output).toContain('packages/schemas/recipe/src/generated-extra.ts');
        });
    });

    it('fails rather than passes vacuously when no contract document is tracked at all', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'contract-empty-'));

        try {
            execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root });
            execFileSync('git', ['config', 'user.email', 'gate@test.invalid'], { cwd: root });
            execFileSync('git', ['config', 'user.name', 'Gate Test'], { cwd: root });
            write(root, 'README.md', '# nothing generated here\n');
            execFileSync('git', ['add', '--all'], { cwd: root });
            execFileSync('git', ['commit', '--quiet', '--no-verify', '-m', 'no contract'], { cwd: root });

            const result = runGate(root);

            expect(result.status).toBe(1);
            expect(result.output).toContain('No committed contract to gate');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('classifyDrift', () => {
    it('separates modified, added, deleted and renamed', () => {
        const drift = classifyDrift(
            [
                'M\tpackages/schemas/recipe/openapi.yaml',
                'A\ta/new.ts',
                'D\ta/gone.ts',
                'R100\ta/old.ts\ta/new2.ts',
            ].join('\n'),
        );

        expect(drift).toEqual({
            modified: ['packages/schemas/recipe/openapi.yaml'],
            added: ['a/new.ts'],
            deleted: ['a/gone.ts'],
            renamed: ['a/old.ts → a/new2.ts'],
        });
    });

    it('treats an empty diff as no drift', () => {
        expect(hasDrift(classifyDrift(''))).toBe(false);
        expect(hasDrift(classifyDrift('\n\n'))).toBe(false);
    });

    it('treats every non-empty status as drift, including a lone deletion', () => {
        expect(hasDrift(classifyDrift('D\ta/gone.ts'))).toBe(true);
    });

    it('sorts within each bucket so the report is stable across runs', () => {
        expect(classifyDrift('A\tb.ts\nA\ta.ts').added).toEqual(['a.ts', 'b.ts']);
    });
});

describe('the reports', () => {
    it('gives each drift kind its own diagnosis, so the reader knows which mistake they made', () => {
        const report = formatDriftReport(classifyDrift('M\tm.ts\nA\ta.ts\nD\td.ts'));

        expect(report).toContain('Stale');
        expect(report).toContain('Uncommitted');
        expect(report).toContain('Orphaned');
        expect(report).toContain('npm run contract:generate');
    });

    it('omits a bucket that is empty rather than printing an empty code fence', () => {
        const report = formatDriftReport(classifyDrift('M\tm.ts'));

        expect(report).toContain('Stale');
        expect(report).not.toContain('Orphaned');
    });

    it('explains that an ignored artifact means the run checked nothing', () => {
        expect(formatIgnoredReport(['packages/schemas/recipe/openapi.yaml'])).toContain('invisible');
    });
});

describe('--stdin mode', () => {
    it('passes on empty input, so a clean tree is not reported as drift', () => {
        const clean = run(process.execPath, [script, '--stdin'], repoRoot);

        expect(clean.status).toBe(0);
        expect(clean.output).toContain('byte-identical');
    });

    it('EXITS NON-ZERO on any status, which is the property the CI step depends on', () => {
        const dirty = run(process.execPath, [script, '--stdin'], repoRoot, 'M\tpackages/schemas/recipe/openapi.yaml\n');

        expect(dirty.status).toBe(1);
        expect(dirty.output).toContain('Stale');
        expect(dirty.output).toContain('::error::');
    });
});
