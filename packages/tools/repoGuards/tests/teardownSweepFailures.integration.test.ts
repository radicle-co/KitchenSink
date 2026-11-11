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
/** Another open PR's stack: listed, readable, and never this PR's. */
const OTHER_PR_STACK = 'kitchensink-recipe-service-pr-74';
/** Another application's stack in the same account: listed, and unreadable by the CI role. */
const FOREIGN_STACK = 'armoury-api-prod';
/** The shared tier: readable, and never a per-PR stack, so its tags are never read. */
const SHARED_STACK = 'kitchensink-data-sandbox';
/** Outside the CI role's namespace but NAMED for this PR: IAM refuses to delete it, so it is not this PR's to delete. */
const OUT_OF_SCOPE_PR_STACK = 'pr-73-legacy';

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
        # ListStacks is granted on \`*\`, so the real account answers with EVERY stack in it: another PR's, and
        # another application's (the account hosts two). \`AWS_STUB_NO_SANDBOX\` is a PR that never raised one.
        case "$*" in
            *CREATE_IN_PROGRESS*) : ;;
            *)
                [ -n "\${AWS_STUB_NO_SANDBOX:-}" ] || printf '%s\\t' '${STACK}'
                printf '%s\\t%s\\t%s\\t%s\\n' '${OTHER_PR_STACK}' '${FOREIGN_STACK}' '${SHARED_STACK}' '${OUT_OF_SCOPE_PR_STACK}'
                ;;
        esac
        ;;
    'cloudformation describe-stacks')
        # The CI role may read only \`stack/kitchensink-*/*\` (GithubActionsAccessStack's STACK_READ_ACTIONS), so a
        # describe of any other stack is refused exactly as IAM refuses it.
        case "$*" in
            *'--stack-name kitchensink-'*) ;;
            *'--stack-name '*) echo 'AccessDenied: not authorized to perform: cloudformation:DescribeStacks' >&2; exit 254 ;;
        esac
        case "$*" in
            *Tags*)
                fails describe && { echo 'Throttling' >&2; exit 254; }
                # Another PR's cleanup deleted its stack between this run's list and describe.
                case "\${AWS_STUB_VANISH:-}:$*" in
                    1:*'${OTHER_PR_STACK}'*)
                        echo 'An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id ${OTHER_PR_STACK} does not exist' >&2
                        exit 254
                        ;;
                esac
                case "$*" in *pr-74*) echo pr-74-sandbox ;; *) echo pr-73-sandbox ;; esac
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
        # The CI role may describe only \`repository/kitchensink-*\`, so an unscoped listing (\`repository/*\`) is refused.
        echo 'AccessDeniedException: ecr:DescribeRepositories' >&2
        exit 254
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
function run(fail?: string, extraEnv: Record<string, string> = {}): RunResult {
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
            ...extraEnv,
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
    it('a PR with a sandbox deletes its own stack, after its preview address, and exits 0', () => {
        const { status, stdout, calls } = run();
        const deletes = calls.filter((call) => call.startsWith('cloudformation delete-stack'));
        const addressAt = calls.findIndex((call) => call.includes('teardownPreviewDomain'));
        const deleteAt = calls.findIndex((call) => call.startsWith('cloudformation delete-stack'));

        expect(deletes).toEqual([expect.stringContaining(STACK)]);
        expect(addressAt).toBeGreaterThanOrEqual(0);
        expect(addressAt).toBeLessThan(deleteAt);
        expect(stdout).not.toContain('::error::');
        expect(status).toBe(0);
    });

    it('a PR that never raised a sandbox is a clean no-op, even with other stacks in the account', () => {
        const { status, stdout, calls } = run(undefined, { AWS_STUB_NO_SANDBOX: '1' });

        expect(calls.filter((call) => call.startsWith('cloudformation delete-stack'))).toEqual([]);
        expect(stdout).not.toContain('::error::');
        expect(status).toBe(0);
    });

    it('reads tags only of stacks named like a per-PR stack the CI role may delete', () => {
        const { calls } = run();
        const tagReads = calls.filter(
            (call) => call.startsWith('cloudformation describe-stacks') && call.includes('Tags'),
        );

        expect(tagReads.map((call) => /--stack-name (\S+)/u.exec(call)?.[1]).sort()).toEqual(
            [OTHER_PR_STACK, STACK].sort(),
        );
    });

    it('never deletes a stack NAMED for the PR outside the namespace IAM lets it delete', () => {
        const { status, calls } = run();

        expect(calls.filter((call) => call.includes(OUT_OF_SCOPE_PR_STACK))).toEqual([]);
        expect(status).toBe(0);
    });

    it('a stack that vanishes between list and describe is skipped, and this PR is still torn down', () => {
        const { status, stdout, calls } = run(undefined, { AWS_STUB_VANISH: '1' });

        expect(calls.filter((call) => call.startsWith('cloudformation delete-stack'))).toEqual([
            expect.stringContaining(STACK),
        ]);
        expect(stdout).not.toContain('::error::');
        expect(status).toBe(0);
    });

    it('never makes the unscoped ECR listing the CI role is refused', () => {
        const { calls } = run();

        expect(calls.filter((call) => call.startsWith('ecr describe-repositories'))).toEqual([]);
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

        expect(calls.some((call) => call.startsWith('logs describe-log-groups'))).toBe(true);
    });
});
