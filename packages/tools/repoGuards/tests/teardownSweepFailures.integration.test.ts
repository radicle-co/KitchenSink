/**
 * Integration suite for `.github/scripts/teardownSandboxPr.sh` §2-§4 — a stack delete or a listing call that
 * FAILS must fail the run.
 *
 * Before this suite, §2 printed `::warning::` when `wait stack-delete-complete` failed and ignored a failed
 * `delete-stack`, and §3/§4 read their listings through `2>/dev/null` inside `$(...)`, so a listing that errored
 * matched nothing. A stack left in DELETE_FAILED, or a sweep that never saw its resources, ended the PR cleanup
 * GREEN while billed resources kept running. A per-resource delete that is refused stays `|| true` on purpose:
 * one refused delete must not hide the rest (that is a separate decision, not tested here).
 *
 * Real: the teardown script and the scripts it calls, run as `bash`. Stubbed: `aws`, `gh`, `npx`, first on PATH.
 * `AWS_STUB_FAIL` names the one call that fails.
 *
 * Mutation evidence: each `teardown_failed=1` added for this finding was removed in turn and the matching test
 * below watched to fail.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/teardownSandboxPr.sh', import.meta.url));
const STACK = 'kitchensink-food-service-pr-73';

let workdir: string;
let binDir: string;
let logFile: string;

const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AWS_CALL_LOG"
fails() { [ "\${AWS_STUB_FAIL:-}" = "$1" ]; }
case "$1 $2" in
    'rds describe-db-instances')
        case "$*" in
            *DBInstanceStatus*) echo available ;;
            *) echo kitchensink-data-sandbox-db ;;
        esac
        ;;
    'ec2 describe-instances')
        case "$*" in
            *State.Name*) echo running ;;
            *) printf 'i-0nat\\tGlobal-sandbox-NatInstance\\n' ;;
        esac
        ;;
    'cloudformation list-stacks')
        case "$*" in
            *CREATE_IN_PROGRESS*) : ;;
            *) echo '${STACK}' ;;
        esac
        ;;
    'cloudformation describe-stacks')
        case "$*" in
            *Tags*)
                fails describe && { echo 'Throttling' >&2; exit 254; }
                echo pr-73
                ;;
            *PerPrDatabaseReaperFunctionName*) echo kitchensink-data-sandbox-reaper ;;
        esac
        ;;
    'cloudformation delete-stack')
        fails delete && { echo 'AccessDenied: not allowed to delete' >&2; exit 254; }
        ;;
    'cloudformation wait')
        fails wait && { echo 'Waiter StackDeleteComplete failed' >&2; exit 255; }
        ;;
    'resourcegroupstaggingapi get-resources')
        # ecsQuiesce.sh (§1b) makes the same call with a resource-type filter; failing it too would fail the run
        # from §1b and hide a missing \`teardown_failed=1\` in §3. Only the §3 sweep (no type filter) fails.
        case "$*" in *resource-type-filters*) : ;; *) fails tagsweep && { echo 'Throttling' >&2; exit 254; } ;; esac
        ;;
    'logs describe-log-groups')
        fails logs && { echo 'AccessDenied' >&2; exit 254; }
        ;;
    'ecr describe-repositories')
        fails ecr && { echo 'AccessDenied' >&2; exit 254; }
        ;;
    'lambda invoke')
        for arg in "$@"; do
            case "$arg" in /*.json) echo '{"action":"drop","dropped":[]}' > "$arg" ;; esac
        done
        ;;
esac
exit 0
`;

const TRIVIAL_STUB = `#!/usr/bin/env bash
printf '%s %s\\n' "$(basename "$0")" "$*" >> "$AWS_CALL_LOG"
exit 0
`;

interface RunResult {
    readonly status: number;
    readonly stdout: string;
    readonly calls: readonly string[];
}

/** Run the real teardown script for pr-73 with the stub CLIs first on PATH. */
function run(fail?: string): RunResult {
    const result = spawnSync('bash', [SCRIPT, 'pr-73', 'us-east-1'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
            AWS_CALL_LOG: logFile,
            AWS_STUB_FAIL: fail ?? '',
            PREVIEW_ZONE: 'sandbox.commise.app',
            PREVIEW_HOSTED_ZONE_ID: 'Z0000000000000000000',
            VERCEL_TOKEN: 'stub',
            VERCEL_PROJECT_ID: 'stub',
            GH_ENVIRONMENT_ADMIN_TOKEN: '',
            SANDBOX_WAKE_TIMEOUT_SECONDS: '5',
            SANDBOX_WAKE_POLL_SECONDS: '1',
            SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS: '0',
            TEARDOWN_SETTLE_TIMEOUT_SECONDS: '3',
            TEARDOWN_SETTLE_POLL_SECONDS: '1',
        },
    });
    const calls = existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
              .split('\n')
              .filter((line) => line.length > 0)
        : [];

    return { status: result.status ?? -1, stdout: result.stdout, calls };
}

beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'teardown-sweep-'));
    binDir = join(workdir, 'bin');
    logFile = join(workdir, 'calls.log');
    mkdirSync(binDir);

    for (const [name, body] of [
        ['aws', AWS_STUB],
        ['gh', TRIVIAL_STUB],
        ['npx', TRIVIAL_STUB],
    ] as const) {
        const file = join(binDir, name);
        writeFileSync(file, body);
        chmodSync(file, 0o755);
    }
});

afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
});

describe('teardown fails the run when a stack delete or a sweep listing fails', () => {
    it('a clean run with one stack that deletes fine exits 0', () => {
        const { status, stdout, calls } = run();

        expect(calls.some((call) => call.startsWith('cloudformation delete-stack') && call.includes(STACK))).toBe(true);
        expect(stdout).not.toContain('::error::');
        expect(status).toBe(0);
    });

    it('a stack whose delete never completes fails the run and names the stack', () => {
        const { status, stdout } = run('wait');

        expect(stdout).toMatch(new RegExp(`::error::[^\\n]*${STACK}`, 'u'));
        expect(status).not.toBe(0);
    });

    it('a failed delete-stack fails the run and names the stack', () => {
        const { status, stdout } = run('delete');

        expect(stdout).toMatch(new RegExp(`::error::[^\\n]*${STACK}`, 'u'));
        expect(status).not.toBe(0);
    });

    it.each([
        ['tagsweep', 'resourcegroupstaggingapi get-resources'],
        ['logs', 'logs describe-log-groups'],
        ['ecr', 'ecr describe-repositories'],
    ])('a failed %s listing fails the run and names the call', (fail, call) => {
        const { status, stdout } = run(fail);

        expect(stdout).toMatch(new RegExp(`::error::[^\\n]*${call}`, 'u'));
        expect(status).not.toBe(0);
    });

    it('a failed describe-stacks tag read fails the run and names the call', () => {
        const { status, stdout } = run('describe');

        expect(stdout).toMatch(/::error::[^\n]*cloudformation describe-stacks/u);
        expect(status).not.toBe(0);
    });

    it('a failed delete still lets the sweeps run', () => {
        const { calls } = run('delete');

        expect(calls.some((call) => call.startsWith('ecr describe-repositories'))).toBe(true);
    });
});
