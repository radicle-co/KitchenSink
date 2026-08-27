/**
 * Repo-wide guard: the per-PR **ensure-exists** deploy gate (`.github/scripts/deploy-gate.sh`).
 *
 * ## The invariant this protects (issue #124)
 *
 * Every PR preview must be a COMPLETE ecosystem — recipe-service, recipe-workers AND food-service all
 * present for `pr-{N}`. Before this gate, each deploy job was gated purely on `dorny/paths-filter`, so a
 * recipe-only PR deployed no food service at all; `RECIPE_FOOD_SERVICE_URL` then named a host that did not
 * resolve and the ingredient typeahead silently degraded to `catalogAvailability: 'unavailable'` for the whole
 * preview. "Redeploy everything on every push" would fix that by brute force — and rebuild two Docker images
 * for a README-only push. This gate encodes the cheaper semantics instead:
 *
 *   > deploy when the sources CHANGED, **or** when the per-PR stack is absent / not in a usable state,
 *   > **or** when the origin it should be serving does not answer. Skip only when it is both unchanged and
 *   > already serving.
 *
 * So a fresh docs-only PR deploys the whole ecosystem once (nothing exists yet) and every later push to it
 * skips — while a torn-down or half-rolled-back preview self-heals on the next push.
 *
 * ## Why the predicates are executed as real `bash`
 *
 * Same reason as `prScope.test.ts`: a TypeScript re-implementation would be a SECOND copy of the decision
 * that could drift from the one CI actually runs. These tests shell out to the real script.
 *
 * The decision function is PURE (`changed`/`forced`/health-code/stack statuses in, verdict out); all I/O —
 * `aws cloudformation describe-stacks`, the health probe, `$GITHUB_OUTPUT` — lives in the `evaluate`
 * subcommand and is covered by `deployGate.integration.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/deploy-gate.sh', import.meta.url));

/** One decision, as the script prints it. */
interface Decision {
    readonly deploy: boolean;
    readonly reason: string;
    readonly status: number;
}

/**
 * Run the pure `decide` subcommand.
 *
 * @param args - `<intent> <changed> <forced> <healthCode> [name=STATUS …]`.
 * @returns The parsed `deploy=` / `reason=` pair plus the exit status.
 * @sideEffect Spawns `bash`.
 */
const decide = (...args: readonly string[]): Decision => {
    const result = spawnSync('bash', [SCRIPT, 'decide', ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const stdout = result.stdout ?? '';
    const deploy = /^deploy=(.*)$/m.exec(stdout)?.[1] ?? '';
    const reason = /^reason=(.*)$/m.exec(stdout)?.[1] ?? '';

    return { deploy: deploy === 'true', reason, status: result.status ?? -1 };
};

/** Statuses CloudFormation reports for a stack that is deployed and usable as-is. */
const USABLE_STATUSES = ['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE', 'IMPORT_COMPLETE'];

/**
 * Statuses that mean "there is no usable stack here". `ABSENT` is what the script substitutes when
 * `describe-stacks` fails; the rest are real resting states a wedged per-PR stack sits in.
 */
const UNUSABLE_STATUSES = [
    'ABSENT',
    'CREATE_FAILED',
    'ROLLBACK_COMPLETE',
    'ROLLBACK_FAILED',
    'DELETE_FAILED',
    'DELETE_COMPLETE',
    'DELETE_IN_PROGRESS',
    'REVIEW_IN_PROGRESS',
    'UPDATE_ROLLBACK_FAILED',
];

describe('deploy-gate.sh — the file exists where the workflows invoke it from', () => {
    it('is present at .github/scripts/deploy-gate.sh', () => {
        expect(existsSync(SCRIPT), `expected the deploy gate at ${SCRIPT}`).toBe(true);
    });
});

describe('deploy_gate_decide — "changed" always deploys', () => {
    it('deploys when the service sources changed on the PR', () => {
        const verdict = decide('true', 'true', 'false', '200', 'kitchensink-food-service-pr-73=UPDATE_COMPLETE');

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toMatch(/changed/i);
    });

    // `changed` wins even when the stack is healthy — that is the ordinary "this PR edits the service" path,
    // and skipping it would ship a preview that does not contain the PR's own code.
    it('deploys on a change even when everything is already up and serving', () => {
        expect(decide('true', 'true', 'false', '200', 'a=UPDATE_COMPLETE', 'b=CREATE_COMPLETE').deploy).toBe(true);
    });
});

describe('deploy_gate_decide — a manual dispatch is unconditional', () => {
    // `workflow_dispatch` has no PR diff to filter on, so a dispatch must never be talked out of deploying.
    it('deploys when forced, regardless of change or health', () => {
        const verdict = decide('true', 'false', 'true', '200', 'a=UPDATE_COMPLETE');

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toMatch(/dispatch|forced/i);
    });
});

describe('deploy_gate_decide — ensure-exists: an absent or wedged stack deploys anyway', () => {
    // THE issue-#124 case: a docs-only PR changes nothing, so `changed=false`, and nothing is deployed yet.
    it('deploys an unchanged service whose stack does not exist (the fresh docs-only PR)', () => {
        const verdict = decide('true', 'false', 'false', '000', 'kitchensink-food-service-pr-73=ABSENT');

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toContain('kitchensink-food-service-pr-73');
        expect(verdict.reason).toMatch(/ABSENT/);
    });

    it.each(UNUSABLE_STATUSES)('deploys an unchanged service whose stack is %s', (status) => {
        const verdict = decide('true', 'false', 'false', '200', `kitchensink-food-service-pr-73=${status}`);

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toContain(status);
    });

    // The recipe job deploys TWO stacks (workers, then service). Either one missing makes the preview
    // incomplete, so either one missing must re-run the job.
    it('deploys when ANY of several stacks is missing', () => {
        const first = decide(
            'true',
            'false',
            'false',
            '200',
            'kitchensink-recipe-workers-pr-73=ABSENT',
            'kitchensink-recipe-service-pr-73=UPDATE_COMPLETE',
        );

        expect(first.deploy).toBe(true);
        expect(first.reason).toContain('kitchensink-recipe-workers-pr-73');

        const second = decide(
            'true',
            'false',
            'false',
            '200',
            'kitchensink-recipe-workers-pr-73=UPDATE_COMPLETE',
            'kitchensink-recipe-service-pr-73=ABSENT',
        );

        expect(second.deploy).toBe(true);
        expect(second.reason).toContain('kitchensink-recipe-service-pr-73');
    });
});

describe('deploy_gate_decide — ensure-SERVING: a stack that exists but does not answer deploys anyway', () => {
    // A converged stack is not a working service: Fargate Spot reclamation, a task that cannot pull its
    // image, or a target group with no healthy members all leave CloudFormation reporting UPDATE_COMPLETE.
    it.each(['000', '404', '502', '503'])('deploys when the origin answered %s instead of 200', (code) => {
        const verdict = decide('true', 'false', 'false', code, 'kitchensink-food-service-pr-73=UPDATE_COMPLETE');

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toContain(code);
    });

    // 000 is curl's "no response at all" — DNS failure, refused connection, TLS failure, timeout. It must
    // never be mistaken for a healthy service.
    it('names the transport failure rather than reporting a status when nothing answered', () => {
        expect(decide('true', 'false', 'false', '000', 'a=UPDATE_COMPLETE').reason).toMatch(
            /did not answer|no response/i,
        );
    });
});

describe('deploy_gate_decide — the ONLY skip: unchanged AND already serving', () => {
    it.each(USABLE_STATUSES)('skips an unchanged service whose stack is %s and origin returns 200', (status) => {
        const verdict = decide('true', 'false', 'false', '200', `kitchensink-food-service-pr-73=${status}`);

        expect(verdict.deploy).toBe(false);
        expect(verdict.reason).toMatch(/unchanged/i);
    });

    it('skips only when EVERY stack is usable', () => {
        const verdict = decide('true', 'false', 'false', '200', 'a=UPDATE_COMPLETE', 'b=CREATE_COMPLETE');

        expect(verdict.deploy).toBe(false);
    });
});

describe('deploy_gate_decide — misuse fails loudly instead of guessing', () => {
    // A gate that silently answers "skip" on bad input is how a preview ends up half-deployed with a green
    // check. Exit non-zero (and never print `deploy=false`) instead.
    it('refuses a decision with no stacks to reason about', () => {
        const verdict = decide('true', 'false', 'false', '200');

        expect(verdict.status).toBe(2);
        expect(verdict.deploy).toBe(false);
        expect(verdict.reason).toBe('');
    });

    it.each(['yes', 'TRUE', '1', ''])('refuses a non-boolean `changed` value %j', (changed) => {
        expect(decide('true', changed, 'false', '200', 'a=UPDATE_COMPLETE').status).toBe(2);
    });

    it.each(['yes', 'TRUE', '1', ''])('refuses a non-boolean `forced` value %j', (forced) => {
        expect(decide('true', 'false', forced, '200', 'a=UPDATE_COMPLETE').status).toBe(2);
    });

    it.each(['', 'ok', '20x'])('refuses a non-numeric health code %j', (code) => {
        expect(decide('true', 'false', 'false', code, 'a=UPDATE_COMPLETE').status).toBe(2);
    });

    it('refuses a stack argument that is not name=STATUS', () => {
        expect(decide('true', 'false', 'false', '200', 'kitchensink-food-service-pr-73').status).toBe(2);
    });

    it('refuses an unknown subcommand', () => {
        const result = spawnSync('bash', [SCRIPT, 'nonsense'], { encoding: 'utf8' });

        expect(result.status).toBe(2);
    });

    // ── The on-demand amendment ──────────────────────────────────────────────────────────────────
    describe('intent — a reaped sandbox must not resurrect itself', () => {
        /**
         * ADR-0010 made an ABSENT stack a reason to DEPLOY, because a preview missing one of its services
         * is broken. Under the on-demand sandbox, absent stops meaning "broken" and starts meaning
         * "deliberately torn down at midnight" — so the ensure-exists rule, left alone, would rebuild every
         * environment on the first push after the reaper ran, silently, behind a green check. That is
         * ADR-0010's own failure mode running backwards.
         *
         * `intent` is the precondition that separates the two readings: it is live only while the PR
         * carries the `sandbox-up` label the button applies and the reconciler removes. It is a REQUIRED
         * first parameter rather than a defaulted one, because a default is a position — silently asserted
         * on behalf of every caller that never considered it.
         */
        it('does not deploy an absent stack when intent is not live', () => {
            const verdict = decide('false', 'false', 'false', '000', 'kitchensink-food-service-pr-73=ABSENT');

            expect(verdict.deploy).toBe(false);
            expect(verdict.reason).toMatch(/not live|no live sandbox|torn down/i);
        });

        it('does not deploy on a source change when intent is not live', () => {
            expect(decide('false', 'true', 'false', '200', 'a=UPDATE_COMPLETE').deploy).toBe(false);
        });

        it('does not deploy on an unhealthy origin when intent is not live', () => {
            expect(decide('false', 'false', 'false', '503', 'a=UPDATE_COMPLETE').deploy).toBe(false);
        });

        it('still deploys on a manual dispatch — the button IS the intent', () => {
            const verdict = decide('false', 'false', 'true', '000', 'a=ABSENT');

            expect(verdict.deploy).toBe(true);
        });

        it('preserves every ensure-exists behaviour while intent is live', () => {
            expect(decide('true', 'false', 'false', '200', 'a=ABSENT').deploy).toBe(true);
            expect(decide('true', 'true', 'false', '200', 'a=UPDATE_COMPLETE').deploy).toBe(true);
            expect(decide('true', 'false', 'false', '503', 'a=UPDATE_COMPLETE').deploy).toBe(true);
            expect(decide('true', 'false', 'false', '200', 'a=UPDATE_COMPLETE').deploy).toBe(false);
        });

        it.each(['', 'yes', 'TRUE', '1'])('rejects a non-boolean intent (%s)', (intent) => {
            expect(decide(intent, 'false', 'false', '200', 'a=UPDATE_COMPLETE').status).toBe(2);
        });
    });
});
