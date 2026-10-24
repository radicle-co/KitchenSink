// @vitest-environment node
/**
 * Integration: `sandboxStatus.sh probe` judges the shared tier once it has SETTLED, not mid-update.
 *
 * ## Why this exists
 *
 * The probe decides the whole PR pipeline's e2e branch. Classifying a stack by one snapshot — anything but a
 * `*_COMPLETE` status read as "not usable", verdict `fail` — lets an ordinary concurrent deploy fail unrelated
 * CI: a probe landing while `kitchensink-identity-service-sandbox` is `UPDATE_IN_PROGRESS` goes red with
 * `shared tier not usable: …(UPDATE_IN_PROGRESS)` over a tier that is `UPDATE_COMPLETE` minutes later.
 *
 * An in-progress stack is not an answer yet. The probe waits, BOUNDED, for it to reach a resting state and
 * judges THAT. What must not change: a tier that is absent, or that settles into a failed/rolled-back state,
 * is still not up — and a stack that never settles inside the bound is not up either, because a probe that
 * can wait forever is a pipeline that can hang forever.
 *
 * ## The second question: are the database and the NAT up?
 *
 * Healthy stacks say nothing about RDS and the NAT: the nightly stop leaves every stack `UPDATE_COMPLETE` while
 * the database and the NAT under them are stopped (2026-10-12 plan, finding 2). So after the stacks the probe
 * asks `sandboxWake.sh check`, and a stopped database or NAT reads `up=false`, which the verdict turns into a
 * SKIP. A check that ERRORS is not "down": the probe exits non-zero rather than call it a skip.
 *
 * Executed against the REAL script (and the real `sandboxSharedTier.sh` and `sandboxWake.sh` it calls), with
 * `aws` replaced by a stub whose answers change over successive calls.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/sandboxStatus.sh');

/**
 * The settle bound for every case that must complete several polls. The probe's deadline is bash's whole-second
 * `$SECONDS` and each `aws` stub call spawns node, so a tight bound races the polls under CPU load; only the
 * never-settles case is ABOUT the deadline, and it passes its own short one.
 */
const SETTLE_SECONDS = 60;

let scratch = '';

afterEach(() => {
    if (scratch !== '') {
        rmSync(scratch, { recursive: true, force: true });
        scratch = '';
    }
});

/**
 * Run the probe with a stubbed `aws`.
 *
 * @param answers - Per stack, the successive statuses `describe-stacks` returns; the last one repeats.
 *                  A stack absent from the map answers as a missing stack (non-zero exit).
 * @returns The probe's parsed output, its exit status, how long it took, and how often each stack was asked.
 * @sideEffect Creates a temp directory and runs bash in it.
 */
function probe(
    answers: Readonly<Record<string, readonly string[]>>,
    settleSeconds = SETTLE_SECONDS,
    resources: { readonly database?: string; readonly nat?: string } = {},
): {
    readonly up: string;
    readonly reason: string;
    readonly status: number | null;
    readonly seconds: number;
    readonly calls: Readonly<Record<string, number>>;
    readonly output: string;
    readonly awsVerbs: readonly string[];
} {
    scratch = mkdtempSync(path.join(tmpdir(), 'sandbox-status-probe-'));
    const bin = path.join(scratch, 'bin');
    const state = path.join(scratch, 'state');

    spawnSync('mkdir', ['-p', bin, state]);
    writeFileSync(path.join(scratch, 'answers.json'), JSON.stringify(answers));
    // The stub: finds `--stack-name <s>`, bumps that stack's call counter, and answers the Nth status.
    writeFileSync(
        path.join(bin, 'aws'),
        `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${path.join(state, 'verbs.log')}"
# The status check's describes. Discovery has no per-resource flag; the per-resource call does.
case "$*" in
    *"rds describe-db-instances"*"--db-instance-identifier"*) echo "${resources.database ?? 'available'}"; exit 0 ;;
    *"rds describe-db-instances"*) echo 'kitchensink-data-sandbox-databaseb269d8bb-p76w6xmz1xlk'; exit 0 ;;
    *"ec2 describe-instances"*"--instance-ids"*) echo "${resources.nat ?? 'running'}"; exit 0 ;;
    *"ec2 describe-instances"*)
        printf 'i-0b126b357d15b35fd\\tGlobal-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance\\n'
        exit 0
        ;;
esac
stack=''
while [ $# -gt 0 ]; do
    if [ "$1" = '--stack-name' ]; then stack="$2"; fi
    shift
done
n=$(( $(cat "${state}/$stack" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "${state}/$stack"
node -e '
const a = require(process.argv[1])[process.argv[2]];
if (!a) { process.exit(254); }
process.stdout.write(a[Math.min(Number(process.argv[3]) - 1, a.length - 1)] + "\\n");
' "${path.join(scratch, 'answers.json')}" "$stack" "$n"
`,
    );
    chmodSync(path.join(bin, 'aws'), 0o755);

    const started = Date.now();
    const result = spawnSync('bash', [SCRIPT, 'probe', 'us-east-1', 'sandbox'], {
        encoding: 'utf8',
        timeout: 60_000,
        env: {
            ...process.env,
            PATH: `${bin}:${process.env['PATH'] ?? ''}`,
            SANDBOX_STATUS_SETTLE_SECONDS: String(settleSeconds),
            SANDBOX_STATUS_POLL_SECONDS: '0.2',
            // Zero headroom: the verdict must not depend on the hour the suite runs at (it would say DOWN
            // in the 45 minutes before 00:00 ET). The headroom rule has its own suite.
            SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS: '0',
            SANDBOX_WAKE_POLL_SECONDS: '0',
        },
    });
    const field = (name: string): string =>
        new RegExp(`^${name}=(.*)$`, 'mu').exec(result.stdout)?.[1] ?? `<no ${name}: ${result.stderr}>`;
    const calls = Object.fromEntries(
        Object.keys(answers).map((stack) => {
            try {
                return [stack, Number(readFileSync(path.join(state, stack), 'utf8'))];
            } catch {
                return [stack, 0];
            }
        }),
    );

    return {
        up: field('up'),
        reason: field('reason'),
        status: result.status,
        seconds: (Date.now() - started) / 1000,
        calls,
        output: `${result.stdout}${result.stderr}`,
        awsVerbs: readFileSync(path.join(state, 'verbs.log'), 'utf8')
            .split('\n')
            .filter((line) => line !== ''),
    };
}

const IDENTITY = 'kitchensink-identity-service-sandbox';
const ALB = 'kitchensink-alb-sandbox';

describe('sandboxStatus.sh probe — judging a SETTLED tier', () => {
    it('reads a healthy tier as up, without waiting (the positive control)', () => {
        const result = probe({ [IDENTITY]: ['UPDATE_COMPLETE'], [ALB]: ['CREATE_COMPLETE'] });

        expect(result).toMatchObject({ up: 'true', status: 0 });
        expect(result.calls[IDENTITY]).toBe(1);
    });

    it('⛔ WAITS for an in-progress stack and judges where it LANDS — the concurrent-deploy race', () => {
        const result = probe({
            [IDENTITY]: [
                'UPDATE_IN_PROGRESS',
                'UPDATE_IN_PROGRESS',
                'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
                'UPDATE_COMPLETE',
            ],
            [ALB]: ['UPDATE_COMPLETE'],
        });

        expect(result).toMatchObject({ up: 'true', status: 0 });
        // It asked again rather than judging the first snapshot.
        expect(result.calls[IDENTITY]).toBeGreaterThanOrEqual(4);
    });

    it('⛔ still reads NOT up when the in-progress stack settles into a FAILED state', () => {
        const result = probe({
            [IDENTITY]: ['UPDATE_IN_PROGRESS', 'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_FAILED'],
            [ALB]: ['UPDATE_COMPLETE'],
        });

        expect(result.up).toBe('false');
        expect(result.reason).toContain(`${IDENTITY}(UPDATE_ROLLBACK_FAILED)`);
    });

    it('⛔ gives up after the bound — a stack that never settles is NOT up, and the probe does not hang', () => {
        const result = probe({ [IDENTITY]: ['UPDATE_IN_PROGRESS'], [ALB]: ['UPDATE_COMPLETE'] }, 2);

        expect(result.up).toBe('false');
        expect(result.reason).toContain(`${IDENTITY}(UPDATE_IN_PROGRESS`);
        expect(result.seconds).toBeLessThan(15);
    });

    it('does not wait on an ABSENT stack — absence is already an answer', () => {
        const result = probe({ [IDENTITY]: ['UPDATE_COMPLETE'] }, 30);

        expect(result.up).toBe('false');
        expect(result.reason).toContain(`${ALB}(ABSENT)`);
        expect(result.seconds).toBeLessThan(10);
    });
});

describe('sandboxStatus.sh probe — healthy stacks over a STOPPED database or NAT', () => {
    const healthy = { [IDENTITY]: ['UPDATE_COMPLETE'], [ALB]: ['UPDATE_COMPLETE'] };

    it('⛔ answers DOWN when every stack is healthy but the database is stopped', () => {
        const result = probe(healthy, SETTLE_SECONDS, { database: 'stopped' });

        expect(result.up).toBe('false');
        expect(result.status).toBe(0);
        expect(result.reason).toContain('database or NAT');
    });

    it('⛔ answers DOWN when every stack is healthy but the NAT is stopped', () => {
        const result = probe(healthy, SETTLE_SECONDS, { nat: 'stopped' });

        expect(result.up).toBe('false');
        expect(result.status).toBe(0);
    });

    it('answers up when the stacks, the database and the NAT are all up (the positive control)', () => {
        expect(probe(healthy)).toMatchObject({ up: 'true', status: 0 });
    });

    it('does not ask the status check about a tier whose stacks are already down', () => {
        const result = probe({ [IDENTITY]: ['UPDATE_COMPLETE'] });

        expect(result.up).toBe('false');
        expect(result.awsVerbs.filter((verb) => verb.startsWith('rds ') || verb.startsWith('ec2 '))).toEqual([]);
    });

    it('⛔ an ERROR from the status check is not "down": the probe exits non-zero', () => {
        const result = probe(healthy, SETTLE_SECONDS, { database: 'failed' });

        expect(result.status).not.toBe(0);
        expect(result.up).not.toBe('false');
        expect(result.output).toContain('::error::');
    });

    it('⛔ issues only read calls, whatever the answer', () => {
        const result = probe(healthy, SETTLE_SECONDS, { database: 'stopped', nat: 'stopped' });

        expect(
            result.awsVerbs.filter(
                (verb) => !/^(cloudformation describe-stacks|rds describe-|ec2 describe-)/u.test(verb),
            ),
        ).toEqual([]);
    });
});
