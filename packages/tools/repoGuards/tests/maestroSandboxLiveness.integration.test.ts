/**
 * The Maestro flow loop attributes a red to ABSENCE only when the sandbox is proven down at the moment of the red.
 *
 * ## The defect (CI run 38996739152)
 *
 * Each shard probes liveness once, at its START. The sandbox's midnight stop (04:00 UTC) can land MID-shard: iOS
 * shard 1 started at 03:44 with the sandbox up, `recipes/detailBack` failed at 04:02, and the shard went red for
 * absence. Android shard 1 of the same run had two REAL failures at 03:55, while the sandbox was still up, and
 * those must stay red. So the loop attributes per flow: after a failed flow, or a failed reset, it asks the probe
 * named by `MAESTRO_SANDBOX_LIVENESS` (a command printing `live=true|false`). Only a confirmed `live=false`
 * turns that failure into a skip; an earlier failure, recorded while the probe still answered live, stays a failure.
 *
 * ## What is real here
 *
 * The REAL `runMaestroFlows.sh` runs under real bash through its `run-one` seam. `adb`, `maestro`, `node` and `npx`
 * are stubs on PATH, and the probe is a stub command that pops one scripted answer per call. A skip claims nothing,
 * so what matters is exactly which flows were driven, the exit status, and the notice text.
 *
 * Mutation lens: dropping the probe call on the flow-failure path reds (a) and (b); dropping it on the reset path
 * reds (c); treating a probe error as down reds (d); making the unset case probe anyway reds (e); counting the
 * flow that failed into the outage reds (a) (exit 1); forgetting earlier live failures reds (b).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');

/** Scripted answers: `live=true`, `live=false`, `ERROR` (the probe itself fails) or `garbage` (no verdict). */
type ProbeAnswer = 'live=true' | 'live=false' | 'ERROR' | 'garbage';

interface Scenario {
    /** Flows (by name) whose `maestro test` exits 1. */
    readonly failFlows?: readonly string[];
    /** The 1-based index of the reset call that fails, if any. */
    readonly failResetAt?: number;
    /** One answer per probe call, in order. Absent means the env var is UNSET (a local run). */
    readonly probe?: readonly ProbeAnswer[];
}

interface Outcome {
    readonly status: number;
    readonly log: string;
    /** The flow names `maestro test` was driven for, in order. */
    readonly driven: readonly string[];
    readonly probeCalls: number;
}

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maestro-liveness-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function executable(name: string, body: string): void {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`, 'utf8');
    chmodSync(join(dir, name), 0o755);
}

/** Run `run-one` over `flows` with the scenario's stubs. */
function run(flows: readonly string[], scenario: Scenario): Outcome {
    const driven = join(dir, 'driven.log');
    const resets = join(dir, 'resets.count');
    const probeQueue = join(dir, 'probe.queue');
    const probeCalls = join(dir, 'probe.calls');

    writeFileSync(driven, '', 'utf8');
    writeFileSync(resets, '0', 'utf8');
    writeFileSync(probeCalls, '0', 'utf8');
    writeFileSync(probeQueue, `${(scenario.probe ?? []).join('\n')}\n`, 'utf8');

    executable('adb', 'exit 0');
    executable('node', 'exit 0');
    // `maestro test … <path>.yaml`: the LAST argument names the flow.
    executable(
        'maestro',
        `last="\${@: -1}"; name="\${last#packages/apps/commise/mobile/.maestro/}"; name="\${name%.yaml}"
echo "$name" >> "${driven}"
case " ${(scenario.failFlows ?? []).join(' ')} " in *" $name "*) exit 1 ;; esac
exit 0`,
    );
    // The per-flow reset is `npx tsx …/reset.ts`; fail the Nth one.
    executable(
        'npx',
        `n=$(( $(cat "${resets}") + 1 )); echo "$n" > "${resets}"
[ "$n" = "${scenario.failResetAt ?? 0}" ] && exit 1
exit 0`,
    );
    executable(
        'probe',
        `echo $(( $(cat "${probeCalls}") + 1 )) > "${probeCalls}"
answer=$(head -n 1 "${probeQueue}"); sed -i '1d' "${probeQueue}"
[ "$answer" = ERROR ] && { echo 'probe exploded' >&2; exit 3; }
echo "reason=scripted"; echo "$answer"`,
    );

    const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        PATH: `${dir}:${process.env['PATH'] ?? ''}`,
    };

    delete env['MAESTRO_SANDBOX_LIVENESS'];

    if (scenario.probe !== undefined) {
        env['MAESTRO_SANDBOX_LIVENESS'] = join(dir, 'probe');
    }

    const result = spawnSync('bash', [SCRIPT, 'run-one', ...flows], { encoding: 'utf8', env, cwd: REPO_ROOT });

    return {
        status: result.status ?? -1,
        log: `${result.stdout}${result.stderr}`,
        driven: readFileSync(driven, 'utf8').split('\n').filter(Boolean),
        probeCalls: existsSync(probeCalls) ? Number(readFileSync(probeCalls, 'utf8')) : 0,
    };
}

/** The mid-shard notice line, if the loop printed one. */
function stoppedNotice(log: string): string | undefined {
    return log.split('\n').find((line) => line.startsWith('::notice::') && /stopped/u.test(line));
}

const FLOWS = ['a/one', 'a/two', 'a/three'] as const;

describe('a red is attributed to absence only when the probe confirms the sandbox is down', () => {
    it('(a) a flow fails and the probe says DOWN: exit 0, a notice names it and the flows not run, none is driven after', () => {
        const outcome = run(FLOWS, { failFlows: ['a/two'], probe: ['live=false'] });
        const notice = stoppedNotice(outcome.log);

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.driven).toEqual(['a/one', 'a/two']);
        expect(notice, outcome.log).toBeDefined();
        expect(notice).toContain('a/two');
        expect(notice).toContain('a/three');
        expect(notice).not.toContain('a/one');
    });

    it('(b) a flow fails while LIVE, a later one fails after the stop: exit 1, the live failure stays red', () => {
        const outcome = run(FLOWS, { failFlows: ['a/one', 'a/two'], probe: ['live=true', 'live=false'] });

        expect(outcome.status, outcome.log).toBe(1);
        expect(outcome.driven).toEqual(['a/one', 'a/two']);
        expect(stoppedNotice(outcome.log)).toBeDefined();
    });

    it('(b2) every failure while live: all flows are driven and the shard is red', () => {
        const outcome = run(FLOWS, { failFlows: ['a/one', 'a/three'], probe: ['live=true', 'live=true'] });

        expect(outcome.status, outcome.log).toBe(1);
        expect(outcome.driven).toEqual([...FLOWS]);
        expect(stoppedNotice(outcome.log)).toBeUndefined();
    });

    it('(c) a reset fails and the probe says DOWN: exit 0 with the notice, the flow is not driven', () => {
        const outcome = run(FLOWS, { failResetAt: 2, probe: ['live=false'] });
        const notice = stoppedNotice(outcome.log);

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.driven).toEqual(['a/one']);
        expect(notice, outcome.log).toBeDefined();
        expect(notice).toContain('a/two');
        expect(notice).toContain('a/three');
    });

    it('(c2) a reset fails while the probe says LIVE: still the stage failing, so red', () => {
        const outcome = run(FLOWS, { failResetAt: 2, probe: ['live=true'] });

        expect(outcome.status, outcome.log).toBe(1);
        expect(outcome.driven).toEqual(['a/one']);
    });

    it('(c3) an earlier live failure survives a later reset that fails into the outage', () => {
        const outcome = run(FLOWS, { failFlows: ['a/one'], failResetAt: 2, probe: ['live=true', 'live=false'] });

        expect(outcome.status, outcome.log).toBe(1);
    });

    it('(d) the probe itself errors: unknown, so the failure stays red (fail safe)', () => {
        const outcome = run(FLOWS, { failFlows: ['a/two'], probe: ['ERROR'] });

        expect(outcome.status, outcome.log).toBe(1);
        expect(outcome.driven).toEqual([...FLOWS]);
    });

    it('(d2) a probe that prints no live= verdict is unknown too', () => {
        const outcome = run(FLOWS, { failFlows: ['a/two'], probe: ['garbage'] });

        expect(outcome.status, outcome.log).toBe(1);
    });

    it('(e) env var UNSET: today’s behaviour - a failure is red, the loop continues, the probe is never run', () => {
        const outcome = run(FLOWS, { failFlows: ['a/two'] });

        expect(outcome.status, outcome.log).toBe(1);
        expect(outcome.driven).toEqual([...FLOWS]);
        expect(outcome.probeCalls).toBe(0);
    });

    it('does not probe when nothing failed', () => {
        const outcome = run(FLOWS, { probe: [] });

        expect(outcome.status, outcome.log).toBe(0);
        expect(outcome.probeCalls).toBe(0);
    });
});
