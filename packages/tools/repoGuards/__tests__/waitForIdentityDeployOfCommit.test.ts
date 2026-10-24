/**
 * Repo-wide guard: the PURE half of `.github/scripts/waitForIdentityDeployOfCommit.sh`.
 *
 * ## The invariant this protects
 *
 * A push to a PR starts two workflows from one event: `sandbox-identity-deploy.yml` redeploys the SHARED sandbox
 * identity service, and `_ci.yml` runs the deployed e2e tiers against it. A workflow cannot `needs:` another
 * workflow, so nothing ordered them, and a tier whose e2e-seed reset calls an endpoint the push just added hit the
 * OLD identity server (a 404 and a red build) or one mid-rollout. The script closes that by making the tiers wait
 * for the identity run of the SAME commit; `decide` is its verdict, with no I/O so every run state can be pinned.
 *
 * The tests execute the real script as `bash` (a TypeScript copy of the verdict could drift from the one CI runs).
 * The polling, the `gh` call and the timeout are covered by `tests/waitForIdentityDeployOfCommit.integration.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/waitForIdentityDeployOfCommit.sh', import.meta.url));

interface Verdict {
    readonly verdict: string;
    readonly reason: string;
    readonly status: number;
}

/**
 * Run `decide` over runs given NEWEST FIRST, each as `<status>,<conclusion>,<url>`.
 *
 * @sideEffect Spawns `bash`.
 */
const decide = (...runs: readonly string[]): Verdict => {
    const result = spawnSync('bash', [SCRIPT, 'decide', ...runs], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const stdout = result.stdout ?? '';

    return {
        verdict: /^verdict=(.*)$/m.exec(stdout)?.[1] ?? '',
        reason: /^reason=(.*)$/m.exec(stdout)?.[1] ?? '',
        status: result.status ?? -1,
    };
};

const URL_A = 'https://github.com/o/r/actions/runs/1';
const URL_B = 'https://github.com/o/r/actions/runs/2';

describe('waitForIdentityDeployOfCommit decide', () => {
    it('proceeds when the push started no identity run: identity is not part of it', () => {
        expect(decide()).toMatchObject({ verdict: 'proceed', status: 0 });
    });

    it.each(['queued', 'in_progress', 'pending', 'waiting', 'requested'])('waits while a run is %s', (state) => {
        expect(decide(`${state},,${URL_A}`)).toMatchObject({ verdict: 'wait', status: 0 });
    });

    it('proceeds on a completed success', () => {
        expect(decide(`completed,success,${URL_A}`)).toMatchObject({ verdict: 'proceed', status: 0 });
    });

    it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'neutral', 'stale', ''])(
        'fails on a completed run that concluded %j, naming the run',
        (conclusion) => {
            const result = decide(`completed,${conclusion},${URL_A}`);

            expect(result).toMatchObject({ verdict: 'fail', status: 0 });
            expect(result.reason).toContain(URL_A);
        },
    );

    it('proceeds on a completed run whose jobs were all skipped: it had nothing to deliver', () => {
        expect(decide(`completed,skipped,${URL_A}`)).toMatchObject({ verdict: 'proceed' });
    });

    it('waits when ANY run is still going, even if a newer one already succeeded', () => {
        expect(decide(`completed,success,${URL_B}`, `in_progress,,${URL_A}`).verdict).toBe('wait');
    });

    it('judges the NEWEST run: a later success supersedes an earlier failure', () => {
        expect(decide(`completed,success,${URL_B}`, `completed,failure,${URL_A}`).verdict).toBe('proceed');
    });

    it('judges the NEWEST run: a later failure is not hidden by an earlier success', () => {
        const result = decide(`completed,failure,${URL_B}`, `completed,success,${URL_A}`);

        expect(result.verdict).toBe('fail');
        expect(result.reason).toContain(URL_B);
    });

    it('refuses a malformed run rather than reading it as "nothing running"', () => {
        expect(decide('garbage').status).toBe(2);
        expect(decide(`completed,success`).status).toBe(2);
    });
});
