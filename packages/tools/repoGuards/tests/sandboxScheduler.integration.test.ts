// @vitest-environment node
/**
 * Integration: `.github/scripts/sandboxScheduler.sh` — the ONE way a workflow drives the sandbox scheduler (ADR-0060).
 *
 * Executed for real, with `aws` stubbed on `PATH`, because what matters is shell behaviour no static reader sees:
 *
 * - `aws lambda invoke` EXITS 0 WHEN THE FUNCTION THREW. The failure is in `FunctionError`, not the exit status, so
 *   a caller that trusts the status reports a scheduler that never ran as a success.
 * - a `start` takes exactly one PR token, built and checked HERE before it reaches a payload; anything else is
 *   refused without an invoke, because a start the function cannot parse used to mean "start everything".
 * - an absent scheduler is a FAILURE: a sync that cannot run leaves every scheduled job off while the sandbox is up,
 *   which is the "configured, reports nothing" failure this repository keeps paying for.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/sandboxScheduler.sh');
const workspaces: string[] = [];

afterAll(() => {
    for (const dir of workspaces) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** How the stubbed account answers. */
interface Account {
    /** The exported function name, or `undefined` for an absent scheduler stack. */
    readonly functionName?: string;
    /** What the function returns (written to the invoke's outfile). */
    readonly response?: string;
    /** The CLI's `FunctionError` (`Unhandled` when the handler threw). */
    readonly functionError?: string;
    /** The CLI's own exit status for the invoke. */
    readonly invokeExit?: number;
}

/**
 * Run the script against a stubbed `aws`.
 *
 * @returns The exit status, both streams, and every payload the stub was invoked with.
 */
function run(
    args: readonly string[],
    account: Account = {},
): {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly payloads: readonly unknown[];
    readonly invokedFunction: string | undefined;
} {
    const workspace = mkdtempSync(path.join(tmpdir(), 'sandbox-scheduler-'));
    workspaces.push(workspace);
    const payloadLog = path.join(workspace, 'payloads');
    const functionLog = path.join(workspace, 'function');

    writeFileSync(
        path.join(workspace, 'aws'),
        `#!/usr/bin/env bash
set -u
if [ "$1" = cloudformation ] && [ "$2" = list-exports ]; then
    printf '%s\\n' "\${STUB_FUNCTION:-None}"
    exit 0
fi
if [ "$1" = lambda ] && [ "$2" = invoke ]; then
    out="\${@: -1}"
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --payload) printf '%s\\n' "$2" >>"${payloadLog}"; shift 2 ;;
            --function-name) printf '%s' "$2" >"${functionLog}"; shift 2 ;;
            *) shift ;;
        esac
    done
    printf '%s' "\${STUB_RESPONSE:-}" >"$out"
    printf '%s\\n' "\${STUB_FUNCTION_ERROR:-None}"
    exit "\${STUB_INVOKE_EXIT:-0}"
fi
echo "unexpected aws call: $*" >&2
exit 99
`,
    );
    chmodSync(path.join(workspace, 'aws'), 0o755);

    const result = spawnSync('bash', [SCRIPT, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
            PATH: `${workspace}:${process.env['PATH'] ?? ''}`,
            HOME: workspace,
            ...(account.functionName === undefined ? {} : { STUB_FUNCTION: account.functionName }),
            STUB_RESPONSE: account.response ?? '{"action":"sync","warnings":[],"errors":[]}',
            STUB_FUNCTION_ERROR: account.functionError ?? 'None',
            STUB_INVOKE_EXIT: String(account.invokeExit ?? 0),
        },
    });

    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        payloads: existsSync(payloadLog)
            ? readFileSync(payloadLog, 'utf8')
                  .split('\n')
                  .filter((line) => line.length > 0)
                  .map((line) => JSON.parse(line) as unknown)
            : [],
        invokedFunction: existsSync(functionLog) ? readFileSync(functionLog, 'utf8') : undefined,
    };
}

const LIVE = { functionName: 'kitchensink-sandbox-scheduler-SandboxSchedulerFunction-abc' } as const;

describe('sandboxScheduler.sh', () => {
    it('sync: invokes the exported scheduler with exactly {"action":"sync"} and succeeds on a clean run', () => {
        const result = run(['sync', 'us-east-1'], LIVE);

        expect(result.status).toBe(0);
        expect(result.invokedFunction).toBe(LIVE.functionName);
        expect(result.payloads).toEqual([{ action: 'sync' }]);
    });

    it('start: carries exactly the one PR token', () => {
        const result = run(['start', 'pr-7', 'us-east-1'], LIVE);

        expect(result.status).toBe(0);
        expect(result.payloads).toEqual([{ action: 'start', stage: 'pr-7' }]);
    });

    it.each([['sandbox'], ['prod'], ['pr-07'], ['pr-'], ['pr-7-sandbox'], ['pr-7;rm'], ['']])(
        '⛔ refuses start %j with exit 2 and never invokes',
        (stage) => {
            const result = run(['start', stage, 'us-east-1'], LIVE);

            expect(result.status).toBe(2);
            expect(result.payloads).toEqual([]);
        },
    );

    it('refuses an unknown verb with exit 2 and never invokes', () => {
        const result = run(['stop', 'us-east-1'], LIVE);

        // `stop` belongs to the midnight schedule alone; no workflow may issue it.
        expect(result.status).toBe(2);
        expect(result.payloads).toEqual([]);
    });

    it('⛔ fails when the scheduler is not deployed — a sync that cannot run leaves every job off', () => {
        const result = run(['sync', 'us-east-1'], {});

        expect(result.status).toBe(1);
        expect(result.payloads).toEqual([]);
        expect(result.stderr).toContain('::error::');
    });

    it('⛔ fails when the FUNCTION threw, although `aws lambda invoke` itself exited 0', () => {
        const result = run(['sync', 'us-east-1'], {
            ...LIVE,
            functionError: 'Unhandled',
            response: '{"errorType":"SchedulerRunFailedError","errorMessage":"sandbox-scheduler sync failed: rule x"}',
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('SchedulerRunFailedError');
    });

    it('fails when the invoke itself failed', () => {
        expect(run(['sync', 'us-east-1'], { ...LIVE, invokeExit: 255 }).status).toBe(1);
    });

    it('surfaces each warning as a workflow annotation and still succeeds', () => {
        const result = run(['sync', 'us-east-1'], {
            ...LIVE,
            response: '{"action":"sync","warnings":["sync: pr-7 is serving and owns no scheduled rule"],"errors":[]}',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('::warning::sync: pr-7 is serving and owns no scheduled rule');
    });
});
