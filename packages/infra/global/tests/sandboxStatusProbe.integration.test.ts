// @vitest-environment node
/**
 * Integration: `sandbox-status.sh probe` judges the shared tier once it has SETTLED, not mid-update.
 *
 * ## Why this exists
 *
 * The probe decides the whole PR pipeline's e2e branch, and it used to classify a stack by one snapshot:
 * anything but a `*_COMPLETE` status read as "not usable", and the verdict was `fail`. So an ordinary
 * concurrent deploy failed unrelated CI. Measured on run 34551502976: a push also triggered "Sandbox Identity
 * Deploy", the probe landed while `kitchensink-identity-service-sandbox` was `UPDATE_IN_PROGRESS`, and the run
 * went red with `shared tier not usable: kitchensink-identity-service-sandbox(UPDATE_IN_PROGRESS)` — a tier
 * that was `UPDATE_COMPLETE` a few minutes later.
 *
 * An in-progress stack is not an answer yet. The probe now waits, BOUNDED, for it to reach a resting state and
 * judges THAT. What must not change: a tier that is absent, or that settles into a failed/rolled-back state,
 * is still not up — and a stack that never settles inside the bound is not up either, because a probe that
 * can wait forever is a pipeline that can hang forever.
 *
 * Executed against the REAL script (and the real `sandbox-shared-tier.sh` it reads the stack list from), with
 * `aws` replaced by a stub whose answers change over successive calls.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/sandbox-status.sh');

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
    settleSeconds = 4,
): {
    readonly up: string;
    readonly reason: string;
    readonly status: number | null;
    readonly seconds: number;
    readonly calls: Readonly<Record<string, number>>;
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
    };
}

const IDENTITY = 'kitchensink-identity-service-sandbox';
const ALB = 'kitchensink-alb-sandbox';

describe('sandbox-status.sh probe — judging a SETTLED tier', () => {
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
