// @vitest-environment node
/**
 * Repo-wide guard: the SHARED sandbox tier is created and destroyed in mirror order, by the two workflows
 * that own its lifecycle (ADR-0028, amended 2026-08-30).
 *
 * ## What changed, and what that breaks if it is wired wrong
 *
 * ADR-0028 made previews on-demand but kept the shared tier merely STOPPED: the scheduler Lambda scales the
 * identity service to zero and stops the RDS and NAT. An ALB cannot be stopped, so `kitchensink-alb-sandbox`
 * plus its two public IPv4 addresses kept billing ~$23.73/month for an environment live a few hours a week.
 * It is now destroyed with the tier and rebuilt by the button.
 *
 * Three orderings make that safe, and none of them is visible to `actionlint` or `zizmor` — the YAML is
 * valid and the shell is well-formed either way:
 *
 * **1. Delete AFTER the per-PR teardown.** A preview's stacks import nothing from the ALB today, but they
 * resolve through it, and reclaiming shared infrastructure while a preview teardown is still running is how
 * a half-deleted preview becomes unreachable-and-unreclaimable.
 *
 * **2. Delete BEFORE the scheduler stops the RDS and NAT.** Deleting an ECS service drains its tasks; doing
 * that after the database and the NAT are stopped means the drain happens in an environment where the tasks
 * cannot reach anything, which is the shape that produced the `NotStabilized` wedge repaired on 2026-08-30.
 *
 * **3. Create BEFORE the preview deploys are dispatched.** `identity.sandbox.commise.app` is the ONE
 * identity service every preview signs in against (ADR-0001). Dispatch the previews first and they come up,
 * their smoke tests pass, and nobody can log in — the exact failure `sandbox-up.yml` already documents for
 * the scale-up case, now reachable one step earlier because the stack itself may be absent.
 *
 * ## Why the ALB is probed by name in the deploy gate
 *
 * `sandbox-identity-deploy.yml` decides to redeploy the global-sandbox app when `kitchensink-network-sandbox`
 * is missing. That probe was written when the ALB could never be absent. Now it can, and the network stack
 * outlives it — so a missing ALB would leave `global_missing=false`, skip the deploy that creates it, and
 * fail the identity deploy on an unresolvable `SharedAlbHttpsListenerArn` import. Probing the stack that can
 * actually be gone is the fix, and this asserts it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { isSkipTolerant } from './workflowExpression.js';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));

/** One step of a workflow job, reduced to what these assertions ask about. */
interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly if?: string;
}

const workflow = (file: string): Record<string, any> =>
    parse(readFileSync(`${WORKFLOW_DIR}${file}`, 'utf8')) as Record<string, any>;

/** Every step of every job in one workflow, in file order. */
const stepsOf = (file: string): Step[] =>
    Object.values(workflow(file).jobs ?? {}).flatMap((job: any) => (job.steps ?? []) as Step[]);

/** The index of the first step whose `run:` body contains `needle`, or -1. */
const indexOfRun = (steps: readonly Step[], needle: string): number =>
    steps.findIndex((step) => (step.run ?? '').includes(needle));

describe('shared sandbox tier lifecycle (ADR-0028, amended 2026-08-30)', () => {
    describe('sandbox-reconcile.yml destroys the tier in mirror order', () => {
        const steps = stepsOf('sandbox-reconcile.yml');

        it('invokes the ONE shared-tier script rather than issuing its own delete-stack calls', () => {
            expect(indexOfRun(steps, 'sandbox-shared-tier.sh')).toBeGreaterThanOrEqual(0);
            // A second copy of "which shared stacks may be deleted" is the drift this repo keeps paying for.
            const rawDeletes = steps.filter(
                (step) =>
                    (step.run ?? '').includes('delete-stack') && !(step.run ?? '').includes('sandbox-shared-tier.sh'),
            );

            expect(rawDeletes).toEqual([]);
        });

        it('runs the delete even after an earlier step failed, so reclamation is not skipped', () => {
            const step = steps[indexOfRun(steps, 'sandbox-shared-tier.sh')];

            expect(isSkipTolerant(step?.if)).toBe(true);
        });

        it('only deletes when no sandbox is live AND no consumer is mid-flight', () => {
            const condition = steps[indexOfRun(steps, 'sandbox-shared-tier.sh')]?.if ?? '';

            expect(condition).toContain("steps.find.outputs.live == ''");
            expect(condition).toContain("steps.inuse.outputs.busy == 'false'");
        });

        it('deletes the tier AFTER the per-PR teardown and BEFORE the RDS and NAT are stopped', () => {
            const teardown = indexOfRun(steps, 'teardown-sandbox-pr.sh');
            const sharedTier = indexOfRun(steps, 'sandbox-shared-tier.sh');
            const schedulerStop = indexOfRun(steps, '"action":"stop"');

            expect(teardown).toBeGreaterThanOrEqual(0);
            expect(schedulerStop).toBeGreaterThanOrEqual(0);
            expect(sharedTier).toBeGreaterThan(teardown);
            expect(sharedTier).toBeLessThan(schedulerStop);
        });
    });

    describe('sandbox-up.yml rebuilds the tier before anything depends on it', () => {
        const steps = stepsOf('sandbox-up.yml');

        it('ensures the shared identity tier exists before dispatching the preview deploys', () => {
            const identity = indexOfRun(steps, 'sandbox-identity-deploy.yml');
            const previews = indexOfRun(steps, 'sandbox-deploy.yml');

            expect(identity).toBeGreaterThanOrEqual(0);
            expect(previews).toBeGreaterThanOrEqual(0);
            expect(identity).toBeLessThan(previews);
        });

        it('waits for that deploy rather than firing and forgetting', () => {
            const step = steps[indexOfRun(steps, 'sandbox-identity-deploy.yml')];

            // `gh workflow run` returns as soon as the dispatch is accepted. Without an explicit wait the
            // previews deploy against an identity service that does not exist yet.
            expect(step?.run ?? '').toMatch(/gh run watch|run list|--exit-status|wait/u);
        });
    });

    describe('sandbox-identity-deploy.yml can rebuild what the reconciler removed', () => {
        const steps = stepsOf('sandbox-identity-deploy.yml');

        it('probes the ALB stack, not only the network stack, when deciding to deploy global-sandbox', () => {
            const gate = steps.find((step) => (step.run ?? '').includes('global_missing=true'))?.run ?? '';

            expect(gate).toContain('kitchensink-alb-sandbox');
        });
    });
});
