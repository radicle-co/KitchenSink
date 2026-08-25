/**
 * Repo-wide guard: every sandbox deploy WAKES the shared sandbox database before it deploys anything.
 *
 * ## The composition defect
 *
 * ADR-0007 stops the sandbox RDS instance 00:00–09:00 ET. ADR-0022 put schema migrations INSIDE the deploy
 * as an `aws-cdk-lib/triggers` Trigger. Neither is wrong; together they wedge stacks. A deploy that lands
 * in the shutdown window runs its migration Trigger against a STOPPED instance, gets
 * `connect ETIMEDOUT …:5432`, fails the update — and the ROLLBACK then fails for the same reason, leaving
 * `UPDATE_ROLLBACK_FAILED`. That state is not self-healing: every later sandbox deploy fails on the wedge
 * rather than on its own diff, until a human runs `continue-update-rollback --resources-to-skip`.
 *
 * `.github/scripts/sandbox-wake.sh` closes it. THIS suite is what stops the fix from being quietly removed or
 * narrowed later: the rule is stated over the workflow tree, not over the three call sites that exist
 * today, so a NEW sandbox job that deploys a stack is covered the moment it is written and has to argue its
 * way OUT via {@link EXEMPT_DEPLOY_STEPS} rather than silently in.
 *
 * ## The second class — a job that CONSUMES the sandbox rather than deploying to it
 *
 * Observed 2026-08-25 at 01:37 ET on `dcf2aaef`: every one of the eight `e2e-web` Playwright shards died in
 * ~1 minute, producing NO test results at all. Nothing deployed, so the deploy rule above could not have
 * covered it. The suite's `globalSetup` creates a Clerk user and then waits 30s for the `user.created`
 * webhook to backfill its `external_id` — and that webhook is a VPC-attached Lambda on the sandbox, which
 * reaches Secrets Manager and the Clerk API through the sandbox NAT and writes to the sandbox RDS. ADR-0007
 * stops BOTH nightly, so inside the window the backfill can never arrive and the setup fails with a message
 * that reads like a webhook outage.
 *
 * So the rule is stated over two step shapes, not one: a step that DEPLOYS a sandbox stack, and a step that
 * RUNS a suite whose fixtures depend on the sandbox identity webhook. Both must be preceded by the gate in
 * their own job.
 *
 * ⚠️ Prod is deliberately out of scope. The prod instance is never stopped, and `sandbox-wake.sh` is scoped so
 * that it cannot address a prod database at all (see `sandboxWake.test.ts`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly 'continue-on-error'?: boolean;
}

interface Job {
    readonly steps?: readonly Step[];
}

interface Doc {
    readonly jobs?: Readonly<Record<string, Job>>;
}

/** The wake gate's invocation, as it appears in a `run:` body. */
const WAKE_INVOCATION = 'sandbox-wake.sh ensure';

/**
 * A step that hands a CloudFormation stack to CDK. `infra:deploy` is included because a workspace script
 * is the other spelling already in the tree (`sandbox-router-deploy.yml`), and a rule that only knew the
 * literal `cdk deploy` would miss it.
 */
const DEPLOY_STEP = /\bcdk deploy\b|\binfra:deploy\b/;

/**
 * A step that runs a suite whose FIXTURES live on the shared sandbox — today, the web Playwright suite,
 * whose `globalSetup` blocks on the sandbox `user.created` webhook backfilling `external_id`.
 *
 * Matched on the workspace invocation rather than on a job name, so a new job (or a new workflow) that runs
 * the same suite is covered the moment it is written.
 */
const SANDBOX_FIXTURE_STEP = /npm run test:e2e --workspace=@commise\/web/;

/**
 * Deploy steps in a sandbox workflow that legitimately need no database wake, each with the reason.
 *
 * Keyed `<file>::<job>::<step name>`; a stale entry fails too, so this cannot rot into fiction.
 */
const EXEMPT_DEPLOY_STEPS: ReadonlyMap<string, string> = new Map([
    [
        'sandbox-router-deploy.yml::deploy::Deploy router stack (bundles the function, then cdk deploy)',
        'The sandbox router is a CloudFront Function + KeyValueStore (ADR-0001). It owns no database, ships no ' +
            'migration Trigger, and never opens a connection to RDS.',
    ],
]);

/** Parse every workflow, in filename order. */
const workflows = (): readonly { file: string; doc: Doc }[] =>
    readdirSync(WORKFLOW_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort()
        .map((file) => ({ file, doc: parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as Doc }));

/** A step's stable identity. */
const label = (step: Step): string => step.name ?? step.uses ?? (step.run ?? '').split('\n')[0]?.trim() ?? '(unnamed)';

/** Only the SANDBOX workflows are in scope — prod's database is never stopped. */
const isSandboxWorkflow = (file: string): boolean => file.startsWith('sandbox-');

/**
 * Every deploy step in a sandbox workflow that is NOT preceded, in its own job, by the wake gate.
 *
 * @returns Violation ids (`<file>::<job>::<step>`).
 */
function findUnwokenDeploys(): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows()) {
        if (!isSandboxWorkflow(file)) {
            continue;
        }

        for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
            let woken = false;

            for (const step of job.steps ?? []) {
                const run = step.run ?? '';

                if (run.includes(WAKE_INVOCATION)) {
                    woken = true;
                    continue;
                }

                if (!DEPLOY_STEP.test(run)) {
                    continue;
                }

                const id = `${file}::${jobName}::${label(step)}`;

                if (!woken && !EXEMPT_DEPLOY_STEPS.has(id)) {
                    violations.push(id);
                }
            }
        }
    }

    return [...violations].sort();
}

/**
 * Every step in ANY workflow that runs a sandbox-fixture suite and is NOT preceded, in its own job, by the
 * wake gate.
 *
 * ⚠️ Deliberately NOT restricted to `sandbox-*.yml`. This class lives in `_ci.yml`, which is not a sandbox
 * workflow by filename but drives the shared sandbox Clerk instance and, through it, the sandbox webhook
 * Lambda. Scoping the rule by filename is exactly what left this uncovered until 2026-08-25.
 *
 * @returns Violation ids (`<file>::<job>::<step>`).
 */
function findUnwokenSandboxFixtureSuites(): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows()) {
        for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
            let woken = false;

            for (const step of job.steps ?? []) {
                const run = step.run ?? '';

                if (run.includes(WAKE_INVOCATION)) {
                    woken = true;
                    continue;
                }

                if (!SANDBOX_FIXTURE_STEP.test(run)) {
                    continue;
                }

                if (!woken) {
                    violations.push(`${file}::${jobName}::${label(step)}`);
                }
            }
        }
    }

    return [...violations].sort();
}

/** Every step in the tree that invokes the wake gate. */
function wakeSteps(): readonly { id: string; step: Step }[] {
    const found: { id: string; step: Step }[] = [];

    for (const { file, doc } of workflows()) {
        for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
            for (const step of job.steps ?? []) {
                if ((step.run ?? '').includes(WAKE_INVOCATION)) {
                    found.push({ id: `${file}::${jobName}::${label(step)}`, step });
                }
            }
        }
    }

    return found;
}

describe('sandbox DB wake wiring — no sandbox deploy runs against a possibly-stopped database', () => {
    it('every sandbox deploy step is preceded by the wake gate in its own job', () => {
        expect(
            findUnwokenDeploys(),
            'a sandbox `cdk deploy` with no `sandbox-wake.sh ensure` before it in the same job can wedge its stack ' +
                'in UPDATE_ROLLBACK_FAILED during the ADR-0007 nightly window. Add the wake step, or add an ' +
                'EXEMPT_DEPLOY_STEPS entry stating why that stack touches no database.',
        ).toEqual([]);
    });

    // The three jobs that exist today. Named explicitly so NARROWING the fix — deleting the step from one
    // job while the generic rule above still passes for the others — is a red test, not a silent regression.
    it.each([
        'sandbox-deploy.yml::deploy-food',
        'sandbox-deploy.yml::deploy-recipe',
        'sandbox-identity-deploy.yml::deploy',
    ])('%s wakes the sandbox database', (jobId) => {
        expect(wakeSteps().map(({ id }) => id.split('::').slice(0, 2).join('::'))).toContain(jobId);
    });

    it('is wired in at least as many jobs as deploy DB-backed sandbox stacks', () => {
        expect(wakeSteps().length).toBeGreaterThanOrEqual(3);
    });
});

describe('sandbox DB wake wiring — no sandbox-fixture suite runs against a sleeping sandbox', () => {
    it('every sandbox-fixture suite step is preceded by the wake gate in its own job', () => {
        expect(
            findUnwokenSandboxFixtureSuites(),
            "the web Playwright suite's globalSetup blocks on the sandbox `user.created` webhook backfilling " +
                "`external_id`. Inside ADR-0007's 00:00–09:00 ET window the sandbox RDS and NAT are both STOPPED, " +
                'so that backfill can never arrive: every shard dies in ~1 minute with no test results at all ' +
                '(observed 2026-08-25 01:37 ET on dcf2aaef). Add `sandbox-wake.sh ensure` before the suite runs.',
        ).toEqual([]);
    });

    // Named explicitly because the generic rule above passes VACUOUSLY when nothing matches — deleting the
    // suite step, renaming the workspace, or dropping the wake would otherwise all read as green.
    it('_ci.yml::e2e-web wakes the sandbox before the Playwright shards run', () => {
        expect(wakeSteps().map(({ id }) => id.split('::').slice(0, 2).join('::'))).toContain('_ci.yml::e2e-web');
    });

    // Guards the vacuity directly: the rule above is only meaningful while the step shape it keys on still
    // exists somewhere in the tree.
    it('the sandbox-fixture step shape still matches something', () => {
        const matched = workflows().flatMap(({ doc }) =>
            Object.values(doc.jobs ?? {}).flatMap((job) =>
                (job.steps ?? []).filter((step) => SANDBOX_FIXTURE_STEP.test(step.run ?? '')),
            ),
        );

        expect(
            matched.length,
            'SANDBOX_FIXTURE_STEP matches nothing — the suite invocation was renamed and this guard has gone vacuous.',
        ).toBeGreaterThan(0);
    });
});

describe('sandbox DB wake wiring — the gate is allowed to fail the job', () => {
    // A wake that cannot fail is worse than none: the deploy proceeds against a stopped instance and wedges
    // the stack anyway, now behind a step that reported success.
    it('no wake step suppresses its own exit status', () => {
        for (const { id, step } of wakeSteps()) {
            expect(step['continue-on-error'] ?? false, `${id} must be able to fail the job`).toBe(false);
            expect(step.run ?? '', `${id} must not suppress the wake gate's exit status`).not.toMatch(
                /sandbox-wake\.sh ensure[^\n]*\|\|/,
            );
        }
    });
});

describe('sandbox DB wake wiring — every exemption is justified and live', () => {
    it('each exempt step still exists in the tree', () => {
        const deployStepIds = new Set<string>();

        for (const { file, doc } of workflows()) {
            for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
                for (const step of job.steps ?? []) {
                    if (DEPLOY_STEP.test(step.run ?? '')) {
                        deployStepIds.add(`${file}::${jobName}::${label(step)}`);
                    }
                }
            }
        }

        for (const id of EXEMPT_DEPLOY_STEPS.keys()) {
            expect(deployStepIds.has(id), `stale exemption: ${id} no longer exists`).toBe(true);
        }
    });

    it('each exemption states a substantive reason', () => {
        for (const [id, why] of EXEMPT_DEPLOY_STEPS) {
            expect(why.trim().split(/\s+/).length, `${id} needs a real reason, not a word`).toBeGreaterThan(5);
        }
    });
});
