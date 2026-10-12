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
 * **2. The reconciler does not stop the RDS and NAT AT ALL** (owner ruling, 2026-09-03). It used to invoke
 * the scheduler Lambda with `{"action":"stop"}` as its last step, which took the shared DATABASE down every
 * time no preview happened to be live. The owner's ruling is that per-PR cleanup reclaims the per-PR
 * databases and nothing else — so the database's lifecycle belongs entirely to the scheduler: its midnight stop,
 * and the per-PR start only Sandbox Up issues (ADR-0060, which deleted the 09:00 start). This workflow must not
 * carry a second, differently-triggered copy of either.
 *
 * The ordering constraint that step used to carry is not lost, it is DISCHARGED: the reason the delete had
 * to precede the stop was that draining ECS tasks into an environment with no database produced the
 * `NotStabilized` wedge repaired on 2026-08-30. With no stop in this workflow, the delete can no longer be
 * followed by one.
 *
 * **3. Create BEFORE the preview deploys.** `identity.sandbox.commise.app` is the ONE
 * identity service every preview signs in against (ADR-0001). Dispatch the previews first and they come up,
 * their smoke tests pass, and nobody can log in — the exact failure `sandboxUp.yml` already documents for
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
    describe('sandboxReconcile.yml destroys the tier in mirror order', () => {
        const steps = stepsOf('sandboxReconcile.yml');

        it('invokes the ONE shared-tier script rather than issuing its own delete-stack calls', () => {
            expect(indexOfRun(steps, 'sandboxSharedTier.sh')).toBeGreaterThanOrEqual(0);
            // A second copy of "which shared stacks may be deleted" is the drift this repo keeps paying for.
            const rawDeletes = steps.filter(
                (step) =>
                    (step.run ?? '').includes('delete-stack') && !(step.run ?? '').includes('sandboxSharedTier.sh'),
            );

            expect(rawDeletes).toEqual([]);
        });

        it('runs the delete even after an earlier step failed, so reclamation is not skipped', () => {
            const step = steps[indexOfRun(steps, 'sandboxSharedTier.sh')];

            expect(isSkipTolerant(step?.if)).toBe(true);
        });

        it('only deletes when no sandbox is live AND no consumer is mid-flight — through the ONE idle verb', () => {
            // REWRITTEN for ADR-0060. The two probes were workflow steps whose outputs gated this delete; they moved
            // into `sandboxSharedTier.sh release-if-idle`, which Sandbox Down shares, so "idle" has one definition.
            // That verb's refusals (a preview left, a start in flight, an unanswerable question) are EXECUTED by
            // `sandboxSharedTierRelease.integration.test.ts`; what this asserts is that the reconciler goes through
            // it and never calls the unconditional `down`.
            const run = steps[indexOfRun(steps, 'sandboxSharedTier.sh')]?.run ?? '';

            expect(run).toMatch(/sandboxSharedTier\.sh\s+release-if-idle/u);
            expect(run).not.toMatch(/sandboxSharedTier\.sh\s+down\b/u);
        });

        it('does NOT tear down a per-PR preview itself', () => {
            // ⚠️ NO per-PR teardown step in this workflow. Reaping a preview has exactly ONE owner
            // (`sandboxReap.yml`, which presses `Sandbox Down`), and a second implementation of "which
            // sandbox is finished" living here is precisely the drift the pinned invoker set in
            // `sandboxReclamationReachability.test.ts` exists to prevent.
            //
            // The tier must still outlive the previews using it. That ORDERING CONCERN is discharged by the
            // verb asserted directly above: `release-if-idle` deletes only when no `pr-{N}` stack exists, i.e.
            // only when no preview exists to be using it. That is a stronger guarantee than sequencing two
            // steps in one job, because it holds no matter who reaped the preview or when.
            expect(indexOfRun(steps, 'teardownSandboxPr.sh')).toBe(-1);
        });

        it('NEVER stops the shared RDS or NAT — that clock belongs to the scheduler alone', () => {
            // ⛔ The owner's ruling of 2026-09-03, asserted rather than described. The reconciler used to end
            // by invoking the scheduler Lambda with `{"action":"stop"}` whenever no preview was live, which
            // is what "took all of RDS down" on a preview's teardown. The stop is ONE decision, expressed once, in
            // `SandboxSchedulerStack`'s midnight schedule (ADR-0060), and the start is Sandbox Up's alone.
            //
            // Matched on the ACTION, not on the function name: a future step could rediscover the scheduler
            // by a different route, and what is forbidden is the stop, not the lookup.
            expect(steps.filter((step) => (step.run ?? '').includes('"action":"stop"'))).toEqual([]);

            // The mirror direction, so this cannot be satisfied by reimplementing the stop by hand — the
            // exact defect ADR-0028 records in the reconciler's first draft, where a raw
            // `aws ecs update-service --desired-count 0` skipped the SSM bookkeeping `runStart` needs.
            for (const step of steps) {
                expect(step.run ?? '').not.toMatch(/stop-db-instance|stop-instances|--desired-count[= ]+0/u);
            }
        });
    });

    describe('sandboxUp.yml rebuilds the tier before anything depends on it', () => {
        // REWRITTEN for ADR-0060: the button is a job graph that CALLS its workflows, so "before" is a `needs:` edge
        // and "waits" is what a called workflow does by construction (`sandboxUpVerification.test.ts`).
        const jobs = (workflow('sandboxUp.yml').jobs ?? {}) as Record<string, { uses?: string; needs?: string[] }>;
        const jobCalling = (file: string): string | undefined =>
            Object.entries(jobs).find(([, job]) => (job.uses ?? '').endsWith(`/${file}`))?.[0];

        it('ensures the shared identity tier exists before the preview deploys', () => {
            const identity = jobCalling('sandbox-identity-deploy.yml');
            const previews = jobCalling('sandboxPreview.yml');

            expect(identity).toBeDefined();
            expect(previews).toBeDefined();
            expect(jobs[previews ?? '']?.needs ?? []).toContain(identity);
        });
    });

    describe('sandboxDown.yml releases the tier only for the LAST preview (ADR-0060 D9)', () => {
        const steps = stepsOf('sandboxDown.yml');

        it('releases it through the ONE idle verb, never the unconditional `down`', () => {
            const release = steps[indexOfRun(steps, 'sandboxSharedTier.sh')];

            expect(release?.run ?? '').toMatch(/sandboxSharedTier\.sh\s+release-if-idle/u);
            expect(release?.run ?? '').not.toMatch(/sandboxSharedTier\.sh\s+down\b/u);
        });

        it('AFTER the PR teardown and AFTER `sync`, and only when the teardown came back clean', () => {
            const teardown = indexOfRun(steps, 'teardownSandboxPr.sh');
            const sync = indexOfRun(steps, 'sandboxScheduler.sh sync');
            const release = indexOfRun(steps, 'sandboxSharedTier.sh');

            expect(teardown).toBeGreaterThanOrEqual(0);
            expect(sync).toBeGreaterThan(teardown);
            expect(release).toBeGreaterThan(sync);
            expect(steps[release]?.if ?? '').toContain("steps.teardown.outcome == 'success'");
        });

        it('NEVER stops the shared RDS or NAT', () => {
            for (const step of steps) {
                expect(step.run ?? '').not.toMatch(/"action":"stop"|stop-db-instance|stop-instances/u);
            }
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
