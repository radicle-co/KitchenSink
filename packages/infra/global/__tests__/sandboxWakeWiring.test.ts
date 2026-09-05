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
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';

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

/** The gate script itself, read as text so the knob names can be checked against their definition. */
const WAKE_SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandbox-wake.sh', import.meta.url));

/**
 * The gate's tuning knobs. Every one of them exists ONLY so the vitest suites can drive the real loops
 * without sleeping for them, and every one of them can DEFEAT the gate if set in CI:
 * `SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS=0` restores the exact 2026-09-05 race behind a green step, and
 * `SANDBOX_WAKE_TIMEOUT_SECONDS=0` turns the instance wait into a coin flip.
 */
const TUNING_KNOBS = [
    'SANDBOX_WAKE_TIMEOUT_SECONDS',
    'SANDBOX_WAKE_POLL_SECONDS',
    'SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS',
    'SANDBOX_WAKE_STOP_SETTLE_SECONDS',
    'SANDBOX_WAKE_MAX_BOUNDARY_WAIT_SECONDS',
] as const;

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

/**
 * ⛔ THE 2026-09-05 WEDGE — and why the rule above was not enough on its own.
 *
 * `sandbox-identity-deploy.yml::deploy` HAS carried the wake step throughout, the suite above asserts it by
 * name, and on run 33943032063 it RAN and passed honestly: `available (ready)` at 03:52:52Z, which was true.
 * The scheduler stopped the instance at 04:00:07Z and CloudFormation's `ModifyDBInstance` died at 04:02:11Z
 * on `Cannot modify a stopped DB Instance`, wedging `kitchensink-data-sandbox` in `UPDATE_ROLLBACK_FAILED`.
 *
 * The gate's answer went STALE. Its replacement asks whether the instance will still be up when the caller
 * finishes, and that question is parameterised — which introduces a way to disable the fix that leaves every
 * assertion above green: set the headroom to zero in a workflow's `env:`. So the knobs are prohibited in the
 * workflow tree outright. They exist for the suites and for nothing else.
 */
describe('sandbox DB wake wiring — the headroom gate cannot be defused from a workflow', () => {
    it.each(TUNING_KNOBS)('no workflow sets %s', (knob) => {
        const offenders = readdirSync(WORKFLOW_DIR)
            .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
            .filter((file) => readFileSync(join(WORKFLOW_DIR, file), 'utf8').includes(knob));

        expect(
            offenders,
            `${knob} is a TEST seam. Setting it in a workflow defeats the gate while every wiring assertion ` +
                'above stays green — `SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS=0` restores the exact race that ' +
                'wedged kitchensink-data-sandbox on 2026-09-05. Delete it; if a caller genuinely needs a ' +
                'different headroom, change the default in the script and say why.',
        ).toEqual([]);
    });

    // Guards the vacuity directly: the prohibition above is only meaningful while these names are the ones
    // the script actually reads. A rename would otherwise leave five assertions passing about nothing.
    it.each(TUNING_KNOBS)('%s is still a knob the script reads', (knob) => {
        expect(
            readFileSync(WAKE_SCRIPT, 'utf8'),
            `${knob} no longer appears in sandbox-wake.sh — the prohibition above has gone vacuous.`,
        ).toContain(knob);
    });
});

/**
 * ⛔ THE GATE AND THE SCHEDULE MUST AGREE, and nothing but this made them.
 *
 * `sandbox-wake.sh` resolves "the next nightly stop" as 00:00 `America/New_York`. That is a COPY of a fact
 * whose original lives in `SandboxSchedulerStack` — and a copy of a fact is exactly what this repo keeps
 * getting bitten by (ADR-0025 §3: "a copy of a list cannot detect that the list is incomplete"). Move the
 * stop to 01:00, or off `America/New_York`, and the gate goes on guarding a boundary that no longer exists:
 * it would report `clear` for a deploy that is about to be stopped out from under it, which is the
 * 2026-09-05 wedge again, now with a gate that looks like it is working.
 *
 * The two are tied through BEHAVIOUR rather than through matching strings: the cron comes from the
 * SYNTHESIZED stack, and the hour it names is compared against where the gate's own `next-stop` actually
 * lands. A reworded comment cannot satisfy this, and a changed schedule cannot escape it.
 */
describe('sandbox DB wake wiring — the gate guards the boundary the scheduler actually fires at', () => {
    /** The stop schedule, read out of the synthesized stack rather than out of the source text. */
    const stopSchedule = (): { readonly expression: string; readonly timezone: string } => {
        const template = Template.fromStack(
            new SandboxSchedulerStack(new App(), 'SandboxScheduler-sandbox', {
                env: { account: '123456789012', region: 'us-east-1' },
                stage: 'sandbox',
            }),
        );
        const schedules = Object.values(template.findResources('AWS::Scheduler::Schedule')) as {
            Properties: { ScheduleExpression: string; ScheduleExpressionTimezone: string; Target: { Input: string } };
        }[];
        const stop = schedules.find(({ Properties }) => Properties.Target.Input.includes('stop'));

        if (stop === undefined) {
            throw new Error('no `stop` schedule found — SandboxSchedulerStack no longer provisions one');
        }

        return {
            expression: stop.Properties.ScheduleExpression,
            timezone: stop.Properties.ScheduleExpressionTimezone,
        };
    };

    it('resolves the next stop to the very minute the stop cron fires, in that cron`s own zone', () => {
        const { expression, timezone } = stopSchedule();
        const [minute, hour] = expression.replace(/^cron\(|\)$/g, '').split(' ');

        // An arbitrary mid-afternoon instant; the answer must be the NEXT firing of that cron.
        const boundary = spawnSync('bash', [WAKE_SCRIPT, 'next-stop', '1788616800'], {
            encoding: 'utf8',
        }).stdout.trim();

        const rendered = spawnSync('date', ['-d', `@${boundary}`, '+%H:%M'], {
            encoding: 'utf8',
            env: { ...process.env, TZ: timezone },
        }).stdout.trim();

        expect(
            rendered,
            `sandbox-wake.sh lands on ${rendered} ${timezone} but the scheduler's stop cron is ` +
                `"${expression}". The gate would guard a boundary the scheduler does not fire at, and report ` +
                '`clear` for a deploy that is about to be stopped mid-flight.',
        ).toBe(`${hour?.padStart(2, '0')}:${minute?.padStart(2, '0')}`);
    });

    it('reasons in the same timezone the stop cron is expressed in', () => {
        expect(readFileSync(WAKE_SCRIPT, 'utf8')).toContain(`SANDBOX_WAKE_SCHEDULE_TZ='${stopSchedule().timezone}'`);
    });
});
