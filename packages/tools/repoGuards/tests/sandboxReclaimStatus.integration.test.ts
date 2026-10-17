// @vitest-environment node
/**
 * Integration: `sandboxScheduler.sh reclaim-status` — the question Sandbox Up asks before it starts the tier (ADR-0061).
 *
 * The midnight reclaim deletes stacks for up to two hours after the stop. A press during that window would start the
 * database and the NAT the reclaim is about to delete from under, and the reclaim would stand down half-way through.
 * So the start asks first: is a reclaim execution RUNNING?
 *
 * ## The answers, and the one that must never be wrong
 *
 *   0 — idle: there is no state machine yet (the scheduler stack has not been deployed with it), or none is RUNNING;
 *   3 — RUNNING: refuse the press;
 *   1 — it could not be told.
 *
 * ⛔ A lookup that FAILS is exit 1, never 0. `cfnExport.sh --optional` makes absence an answer and keeps a failed
 * lookup (credentials, permissions, throttling) a failure; this verb inherits that, and adds the same rule for the
 * Step Functions call. A throttled or denied call that read as "idle" would let a press run during an active reclaim,
 * which is the failure this verb exists to prevent.
 *
 * Executed for real with `aws` stubbed on `PATH`; the stub is the boundary. A second block reads `sandboxUp.yml` and
 * requires the verb to run, with credentials, before the start.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from '../__tests__/serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/sandboxScheduler.sh');
const ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:reclaim';
const workspaces: string[] = [];

afterAll(() => {
    for (const dir of workspaces) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** How the stubbed account answers. */
interface Account {
    /** The exported ARN, or `undefined` for a scheduler stack that has no reclaim yet. */
    readonly arn?: string;
    /** What `list-executions --query length(executions)` prints. */
    readonly running?: string;
    /** `list-exports` itself fails (credentials, throttling). */
    readonly exportsFail?: boolean;
    /** `list-executions` fails. */
    readonly executionsFail?: boolean;
}

function run(args: readonly string[], account: Account = {}) {
    const workspace = mkdtempSync(path.join(tmpdir(), 'reclaim-status-'));
    workspaces.push(workspace);
    const callLog = path.join(workspace, 'calls');

    writeFileSync(
        path.join(workspace, 'aws'),
        `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >>"${callLog}"
if [ "$1" = cloudformation ] && [ "$2" = list-exports ]; then
    [ -n "\${STUB_EXPORTS_FAIL:-}" ] && { echo "An error occurred (ThrottlingException)" >&2; exit 255; }
    printf '%s\\n' "\${STUB_ARN:-None}"
    exit 0
fi
if [ "$1" = stepfunctions ] && [ "$2" = list-executions ]; then
    [ -n "\${STUB_EXECUTIONS_FAIL:-}" ] && { echo "An error occurred (AccessDeniedException)" >&2; exit 255; }
    printf '%s\\n' "\${STUB_RUNNING-0}"
    exit 0
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
            ...(account.arn === undefined ? {} : { STUB_ARN: account.arn }),
            ...(account.running === undefined ? {} : { STUB_RUNNING: account.running }),
            ...(account.exportsFail === true ? { STUB_EXPORTS_FAIL: '1' } : {}),
            ...(account.executionsFail === true ? { STUB_EXECUTIONS_FAIL: '1' } : {}),
        },
    });

    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        calls: existsSync(callLog)
            ? readFileSync(callLog, 'utf8')
                  .split('\n')
                  .filter((line) => line.length > 0)
            : [],
    };
}

describe('sandboxScheduler.sh reclaim-status', () => {
    it('exits 3 while a reclaim execution is RUNNING, asking for that state machine and that status only', () => {
        const result = run(['reclaim-status', 'us-east-1'], { arn: ARN, running: '1' });

        expect(result.status).toBe(3);

        const listing = result.calls.find((call) => call.startsWith('stepfunctions list-executions'));

        expect(listing).toContain(`--state-machine-arn ${ARN}`);
        expect(listing).toContain('--status-filter RUNNING');
    });

    it('exits 0 when none is running', () => {
        expect(run(['reclaim-status', 'us-east-1'], { arn: ARN, running: '0' }).status).toBe(0);
    });

    it('exits 0 with a notice when there is no reclaim state machine to ask, and does not call Step Functions', () => {
        const result = run(['reclaim-status', 'us-east-1'], {});

        expect(result.status).toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::notice::');
        expect(result.calls.some((call) => call.startsWith('stepfunctions'))).toBe(false);
    });

    it('⛔ exits 1 — never 0 — when the export lookup FAILS, so a throttled call is not read as idle', () => {
        const result = run(['reclaim-status', 'us-east-1'], { exportsFail: true });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('::error::');
    });

    it('⛔ exits 1 — never 0 — when the executions lookup FAILS', () => {
        const result = run(['reclaim-status', 'us-east-1'], { arn: ARN, executionsFail: true });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('::error::');
    });

    it.each(['', 'None', 'null', 'one', '1.5', '-1'])(
        '⛔ exits 1 for an unreadable count %j, rather than guessing idle',
        (running) => {
            expect(run(['reclaim-status', 'us-east-1'], { arn: ARN, running }).status).toBe(1);
        },
    );

    it('treats any positive count as running', () => {
        expect(run(['reclaim-status', 'us-east-1'], { arn: ARN, running: '2' }).status).toBe(3);
    });

    it('still refuses an unknown verb with exit 2 and calls nothing', () => {
        const result = run(['reclaim', 'us-east-1']);

        expect(result.status).toBe(2);
        expect(result.calls).toEqual([]);
    });
});

describe('sandboxUp.yml asks before it starts', () => {
    interface Step {
        readonly name?: string;
        readonly uses?: string;
        readonly run?: string;
    }

    const workflow = parse(readFileSync(path.join(repoRoot, '.github/workflows/sandboxUp.yml'), 'utf8')) as {
        jobs: Record<string, { steps: Step[] }>;
    };
    const steps = workflow.jobs['start']?.steps ?? [];
    const indexOf = (predicate: (step: Step) => boolean): number => steps.findIndex(predicate);
    const asks = indexOf((step) => step.run?.includes('sandboxScheduler.sh reclaim-status') === true);
    const credentials = indexOf((step) => step.uses?.startsWith('aws-actions/configure-aws-credentials') === true);
    const headroom = indexOf((step) => step.run?.includes('sandbox_wake_headroom') === true);
    const start = indexOf((step) => step.run?.includes('sandboxScheduler.sh start') === true);

    it('has the step, in the start job', () => {
        expect(asks).toBeGreaterThanOrEqual(0);
    });

    it('⛔ runs it after the headroom check, after credentials exist, and BEFORE the start', () => {
        expect(headroom).toBeGreaterThanOrEqual(0);
        expect(asks).toBeGreaterThan(headroom);
        // The verb calls AWS, so it needs the credentials step; and it must precede the start it guards.
        expect(asks).toBeGreaterThan(credentials);
        expect(asks).toBeLessThan(start);
    });

    it('⛔ refuses the press on RUNNING (3) and on a lookup that failed, and lets only idle through', () => {
        const script = steps[asks]?.run ?? '';

        expect(script).toMatch(/\b3\)[\s\S]*exit 1/u);
        expect(script).toMatch(/\*\)[\s\S]*exit 1/u);
        expect(script).toMatch(/\b0\)/u);
        expect(script).not.toMatch(/\|\|\s*true/u);
    });
});
