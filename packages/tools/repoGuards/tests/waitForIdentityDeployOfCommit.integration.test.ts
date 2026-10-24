/**
 * Integration suite for the IMPURE half of `waitForIdentityDeployOfCommit.sh`: `evaluate`, which asks GitHub for the
 * identity-deploy runs of one commit, polls until they finish and turns the verdict into an exit status.
 * `waitForIdentityDeployOfCommit.test.ts` covers the pure verdict.
 *
 * Real: the script (as `bash`), `jq`, a real child process. Stubbed: `gh`, via an executable placed first on PATH.
 * The stub serves a scripted sequence of answers (one per call, the last repeating) and records its argv so the
 * suite can prove WHICH commit, workflow and event the script asked about. Without that, a script that listed every
 * run of the workflow would pass these tests and wait on someone else's deploy.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/waitForIdentityDeployOfCommit.sh', import.meta.url));
const SHA = '0123456789abcdef0123456789abcdef01234567';

/** A `gh` stub: logs argv, then prints answer N of `$GH_STUB_DIR/answers` (last repeats), or fails on `FAIL`. */
const GH_STUB = `#!/usr/bin/env bash
dir="$GH_STUB_DIR"
printf '%s\\n' "$*" >> "$dir/argv"
n=$(( $(cat "$dir/calls" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$dir/calls"
total=$(wc -l < "$dir/answers")
line=$(sed -n "$(( n > total ? total : n ))p" "$dir/answers")
if [ "$line" = 'FAIL' ]; then
  echo 'HTTP 502: Bad Gateway' >&2
  exit 1
fi
printf '%s' "$line"
`;

let workdir: string;
let binDir: string;

beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'wait-identity-'));
    binDir = join(workdir, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'gh'), GH_STUB);
    chmodSync(join(binDir, 'gh'), 0o755);
});

afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
});

interface Run {
    readonly status: string;
    readonly conclusion: string;
    readonly url: string;
    readonly createdAt: string;
}

const run = (status: string, conclusion: string, n: number, createdAt = `2026-10-18T10:0${n}:00Z`): Run => ({
    status,
    conclusion,
    url: `https://github.com/o/r/actions/runs/${n}`,
    createdAt,
});

interface Result {
    readonly status: number;
    readonly output: string;
    readonly argv: readonly string[];
    readonly calls: number;
}

/**
 * Run `evaluate` against scripted `gh` answers (each a list of runs, or `'FAIL'`).
 *
 * @sideEffect Spawns `bash`; writes a temp directory.
 */
const evaluate = (
    answers: readonly (readonly Run[] | 'FAIL')[],
    env: Readonly<Record<string, string>> = {},
): Result => {
    const dir = mkdtempSync(join(workdir, 'case-'));
    writeFileSync(
        join(dir, 'answers'),
        answers.map((a) => (a === 'FAIL' ? 'FAIL' : JSON.stringify(a))).join('\n') + '\n',
    );

    const result = spawnSync('bash', [SCRIPT, 'evaluate', SHA], {
        encoding: 'utf8',
        env: {
            PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
            GH_STUB_DIR: dir,
            GITHUB_REPOSITORY: 'o/r',
            WAIT_POLL_SECONDS: '0',
            WAIT_TIMEOUT_SECONDS: '5',
            NO_RUN_GRACE_SECONDS: '0',
            ...env,
        },
    });

    if (result.error) {
        throw result.error;
    }

    const read = (name: string): string => {
        try {
            return readFileSync(join(dir, name), 'utf8');
        } catch {
            return '';
        }
    };

    return {
        status: result.status ?? -1,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        argv: read('argv').split('\n').filter(Boolean),
        calls: Number(read('calls') || '0'),
    };
};

describe('waitForIdentityDeployOfCommit evaluate', () => {
    it('asks about THIS commit, the identity workflow and the pull_request event, in this repository', () => {
        const result = evaluate([[run('completed', 'success', 1)]]);

        expect(result.status).toBe(0);
        const line = result.argv[0] ?? '';
        expect(line).toContain('run list');
        expect(line).toContain('--workflow sandbox-identity-deploy.yml');
        expect(line).toContain('--event pull_request');
        expect(line).toContain(`--commit ${SHA}`);
        expect(line).toContain('--repo o/r');
    });

    it('proceeds when there is no run once the grace has passed', () => {
        expect(evaluate([[]]).status).toBe(0);
    });

    it('keeps looking for a run during the grace, because the two runs are created by one event but not atomically', () => {
        const result = evaluate([[], [], [run('completed', 'failure', 1)]], { NO_RUN_GRACE_SECONDS: '5' });

        expect(result.status).toBe(1);
        expect(result.calls).toBeGreaterThanOrEqual(3);
    });

    it('polls while a run is queued or in progress and proceeds when it succeeds', () => {
        const result = evaluate([
            [run('queued', '', 1)],
            [run('in_progress', '', 1)],
            [run('completed', 'success', 1)],
        ]);

        expect(result.status).toBe(0);
        expect(result.calls).toBe(3);
    });

    it.each(['failure', 'cancelled', 'timed_out'])('fails on %s and names the run URL', (conclusion) => {
        const result = evaluate([[run('completed', conclusion, 7)]]);

        expect(result.status).toBe(1);
        expect(result.output).toContain('::error::');
        expect(result.output).toContain('https://github.com/o/r/actions/runs/7');
    });

    it('judges the newest run when several share the commit, whatever order gh lists them in', () => {
        const older = run('completed', 'failure', 1, '2026-10-18T10:00:00Z');
        const newer = run('completed', 'success', 2, '2026-10-18T10:05:00Z');

        expect(evaluate([[older, newer]]).status).toBe(0);
        expect(evaluate([[newer, older]]).status).toBe(0);
    });

    it('treats a gh error as unknown: it fails, never reads as nothing running', () => {
        const result = evaluate(['FAIL']);

        expect(result.status).toBe(1);
        expect(result.output).toContain('::error::');
    });

    it('treats a gh error in the middle of a wait as unknown too', () => {
        expect(evaluate([[run('in_progress', '', 1)], 'FAIL']).status).toBe(1);
    });

    it('treats an unparseable answer as unknown', () => {
        const dir = mkdtempSync(join(workdir, 'case-'));
        writeFileSync(join(dir, 'answers'), 'not json\n');
        const result = spawnSync('bash', [SCRIPT, 'evaluate', SHA], {
            encoding: 'utf8',
            env: { PATH: `${binDir}:${process.env['PATH'] ?? ''}`, GH_STUB_DIR: dir, GITHUB_REPOSITORY: 'o/r' },
        });

        expect(result.status).toBe(1);
    });

    it('fails with a clear error when a run is still going at the timeout', () => {
        const result = evaluate([[run('in_progress', '', 1)]], { WAIT_TIMEOUT_SECONDS: '1', WAIT_POLL_SECONDS: '1' });

        expect(result.status).toBe(1);
        expect(result.output).toContain('::error::');
        expect(result.output).toContain('https://github.com/o/r/actions/runs/1');
    });

    it('refuses to run without a commit or a repository', () => {
        const noSha = spawnSync('bash', [SCRIPT, 'evaluate'], { encoding: 'utf8' });
        const noRepo = spawnSync('bash', [SCRIPT, 'evaluate', SHA], {
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '' },
        });

        expect(noSha.status).toBe(2);
        expect(noRepo.status).toBe(2);
    });
});
