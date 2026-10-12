/**
 * Repo-wide guard: NOTHING IN CI STARTS THE SANDBOX, and every sandbox deploy first LOOKS at whether it is up.
 *
 * ## The ruling this file used to contradict (owner, 2026-10-12)
 *
 * This suite was written as the opposite: "every sandbox deploy WAKES the shared sandbox database before it
 * deploys anything", enforced over the workflow tree so the wake could not be quietly removed. The owner ruled
 * that wake out: "no automatic or scheduled tasks or jobs except for the single one to check if the sandbox is
 * running at midnight and bringing every single sandbox down. There should not be a wake of CI push. I never
 * authorized that." (docs/plans/2026-10-12-001-fix-sandbox-manual-start-plan.md, D2/D3.) The sandbox starts ONLY
 * through the Sandbox Up workflow, for one PR. So the rules are INVERTED here, not weakened:
 *
 *   1. No workflow step and no script passes `ensure` to `sandboxWake.sh` (the subcommand is deleted).
 *   2. The scheduler's `start` is invoked from `sandboxUp.yml` and nowhere else in `.github/`.
 *   3. The stubbed-API Playwright job in `_ci.yml` and `deployedE2eTiers.yml` do not reference the script at
 *      all: the stubbed job needs no sandbox resource (it makes one Clerk Backend API lookup), and a deployed
 *      tier that has no target SKIPS rather than conjuring one.
 *   4. What remains of the old guard: a sandbox deploy step is still preceded, in its own job, by a
 *      `sandboxWake.sh check` — a deploy into a stopped sandbox wedges stacks (2026-09-05) — and the check is
 *      still not allowed to swallow its own failure.
 *
 * ## The composition defect behind rule 4
 *
 * ADR-0007 stops the sandbox RDS and NAT 00:00-09:00 ET (the stop remains; the 09:00 start is gone). A deploy
 * that runs against a stopped instance fails its migration or its `ModifyDBInstance`, and the rollback fails the
 * same way, leaving `UPDATE_ROLLBACK_FAILED`. That state is not self-healing. The check answers "down" before
 * the deploy starts, and a down sandbox deploys nothing.
 *
 * ⚠️ Prod is deliberately out of scope. The prod instance is never stopped, and `sandboxWake.sh` is scoped so
 * that it cannot address a prod database at all (see `sandboxWake.test.ts`).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Stack, aws_sns as sns } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';
import { testApp } from './testApp.js';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));
const SCRIPT_DIR = fileURLToPath(new URL('../../../../.github/scripts/', import.meta.url));

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly 'continue-on-error'?: boolean;
    readonly 'timeout-minutes'?: unknown;
}

interface Job {
    readonly steps?: readonly Step[];
    readonly 'timeout-minutes'?: unknown;
}

interface Doc {
    readonly jobs?: Readonly<Record<string, Job>>;
}

/** The status check's invocation, as it appears in a `run:` body. */
const CHECK_INVOCATION = 'sandboxWake.sh check';

/** The retired subcommand, in any spelling a step might pass it. */
const ENSURE_INVOCATION = /sandboxWake\.sh["']?\s+ensure\b/u;

/** The status check script itself, read as text so the knob names can be checked against their definition. */
const WAKE_SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandboxWake.sh', import.meta.url));

/**
 * The check's tuning knobs. Every one of them exists ONLY so the vitest suites can drive the real loops without
 * sleeping for them, and every one of them can DEFEAT the check if set in CI:
 * `SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS=0` restores the exact 2026-09-05 race behind a green step.
 */
const TUNING_KNOBS = [
    'SANDBOX_WAKE_TIMEOUT_SECONDS',
    'SANDBOX_WAKE_POLL_SECONDS',
    'SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS',
] as const;

/**
 * Knobs the script used to read and no longer does, so a workflow that still sets one is setting nothing.
 * They went with the boundary wait, which only existed to precede a wake.
 */
const RETIRED_KNOBS = ['SANDBOX_WAKE_STOP_SETTLE_SECONDS', 'SANDBOX_WAKE_MAX_BOUNDARY_WAIT_SECONDS'] as const;

/**
 * A step that hands a CloudFormation stack to CDK. `infra:deploy` is included because a workspace script
 * is the other spelling already in the tree (`sandbox-router-deploy.yml`), and a rule that only knew the
 * literal `cdk deploy` would miss it.
 */
// ⚠️ `run deploy --prefix` is the third spelling: CDK left the npm workspace, so a package's deploy
// script is no longer addressable as `--workspace=` and is invoked from its own directory. Without it
// the router's deploy step stopped being seen as a deploy at all — and its exemption then read as
// stale, which is the guard reporting the wrong problem.
const DEPLOY_STEP = /\bcdk deploy\b|\binfra:deploy\b|\brun deploy --prefix\b/;

/**
 * Deploy steps in a sandbox workflow that legitimately need no status check, each with the reason.
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

/** Every script under `.github/scripts`, as `{ file, text }`. */
const scripts = (): readonly { file: string; text: string }[] =>
    readdirSync(SCRIPT_DIR)
        .filter((file) => file.endsWith('.sh'))
        .sort()
        .map((file) => ({ file, text: readFileSync(join(SCRIPT_DIR, file), 'utf8') }));

/** A step's stable identity. */
const label = (step: Step): string => step.name ?? step.uses ?? (step.run ?? '').split('\n')[0]?.trim() ?? '(unnamed)';

/** Only the SANDBOX workflows are in scope for the deploy rule — prod's database is never stopped. */
const isSandboxWorkflow = (file: string): boolean => file.startsWith('sandbox-');

/** Every step in the tree that invokes the status check. */
function checkSteps(): readonly { id: string; step: Step }[] {
    const found: { id: string; step: Step }[] = [];

    for (const { file, doc } of workflows()) {
        for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
            for (const step of job.steps ?? []) {
                if ((step.run ?? '').includes(CHECK_INVOCATION)) {
                    found.push({ id: `${file}::${jobName}::${label(step)}`, step });
                }
            }
        }
    }

    return found;
}

/**
 * Every deploy step in a sandbox workflow that is NOT preceded, in its own job, by the status check.
 *
 * @returns Violation ids (`<file>::<job>::<step>`).
 */
function findUncheckedDeploys(): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows()) {
        if (!isSandboxWorkflow(file)) {
            continue;
        }

        for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
            let checked = false;

            for (const step of job.steps ?? []) {
                const run = step.run ?? '';

                if (run.includes(CHECK_INVOCATION)) {
                    checked = true;
                    continue;
                }

                if (!DEPLOY_STEP.test(run)) {
                    continue;
                }

                const id = `${file}::${jobName}::${label(step)}`;

                if (!checked && !EXEMPT_DEPLOY_STEPS.has(id)) {
                    violations.push(id);
                }
            }
        }
    }

    return [...violations].sort();
}

describe('⛔ nothing in CI starts the sandbox (owner ruling 2026-10-12)', () => {
    it('no workflow step passes `ensure` to sandboxWake.sh', () => {
        const offenders = workflows().flatMap(({ file, doc }) =>
            Object.entries(doc.jobs ?? {}).flatMap(([jobName, job]) =>
                (job.steps ?? [])
                    .filter((step) => ENSURE_INVOCATION.test(step.run ?? ''))
                    .map((step) => `${file}::${jobName}::${label(step)}`),
            ),
        );

        expect(
            offenders,
            '`sandboxWake.sh ensure` started a stopped RDS instance and NAT before a deploy or a test run. The ' +
                'subcommand is deleted: the sandbox starts only through the Sandbox Up workflow. Use `check`, which ' +
                'only describes, and SKIP when it answers 3.',
        ).toEqual([]);
    });

    it('no SCRIPT passes `ensure` to sandboxWake.sh either', () => {
        // Scripts are invoked from workflows and by hand, so a wake hidden in one escapes the workflow rule above.
        // `teardownSandboxPr.sh` §0c was exactly that.
        const offenders = scripts()
            .filter(({ text }) => ENSURE_INVOCATION.test(text))
            .map(({ file }) => file);

        expect(offenders).toEqual([]);
    });

    it('no script or workflow names an RDS or EC2 start verb', () => {
        const offenders = [
            ...scripts().map(({ file, text }) => ({ file: `scripts/${file}`, text })),
            ...readdirSync(WORKFLOW_DIR)
                .filter((file) => file.endsWith('.yml'))
                .map((file) => ({ file: `workflows/${file}`, text: readFileSync(join(WORKFLOW_DIR, file), 'utf8') })),
        ]
            .filter(({ text }) => /\b(start-db-instance|start-instances)\b/u.test(text))
            .map(({ file }) => file);

        expect(
            offenders,
            "CI starts nothing directly. The one start is the scheduler Lambda's `start` action, invoked from " +
                'sandboxUp.yml; a bare `aws rds start-db-instance` or `aws ec2 start-instances` bypasses it (and its ' +
                'prod interlock).',
        ).toEqual([]);
    });

    // The scheduler's start payload, in the spellings a shell step or a script would write it.
    const SCHEDULER_START_PAYLOAD = /action\\?["']?\s*:\s*\\?["']start\\?["']/u;
    /** The ONE driver for the scheduler Lambda, and the verb that starts the tier. */
    const DRIVER = 'sandboxScheduler.sh';
    const DRIVER_START = /sandboxScheduler\.sh["']?\s+start\b/u;

    /** Script text with whole-line comments removed, so prose about the verb is not mistaken for a call. */
    const withoutCommentLines = (text: string): string => text.replace(/^\s*#.*$/gmu, '');

    it('the scheduler `start` is requested from sandboxUp.yml and from NO other workflow or script', () => {
        const callers = [
            ...workflows().flatMap(({ file, doc }) =>
                Object.values(doc.jobs ?? {}).some((job) =>
                    (job.steps ?? []).some((step) => DRIVER_START.test(step.run ?? '')),
                )
                    ? [`workflows/${file}`]
                    : [],
            ),
            ...scripts()
                .filter(({ file, text }) => file !== DRIVER && DRIVER_START.test(withoutCommentLines(text)))
                .map(({ file }) => `scripts/${file}`),
        ];

        expect(
            callers,
            'Sandbox Up is the only thing that may start the sandbox. A second caller is a second way to bring ' +
                'the paid tier up with nobody pressing the button.',
        ).toEqual(['workflows/sandboxUp.yml']);
    });

    it('the raw `start` payload is written in ONE place: the scheduler driver script', () => {
        const holders = [
            ...workflows().flatMap(({ file, doc }) =>
                Object.values(doc.jobs ?? {}).some((job) =>
                    (job.steps ?? []).some((step) => SCHEDULER_START_PAYLOAD.test(step.run ?? '')),
                )
                    ? [`workflows/${file}`]
                    : [],
            ),
            ...scripts()
                .filter(({ text }) => SCHEDULER_START_PAYLOAD.test(withoutCommentLines(text)))
                .map(({ file }) => `scripts/${file}`),
        ];

        expect(
            holders,
            '`aws lambda invoke` exits 0 when the function THREW, so an inline copy that forgets `FunctionError` ' +
                'reports a scheduler that never ran as a success. Every caller goes through sandboxScheduler.sh.',
        ).toEqual([`scripts/${DRIVER}`]);
    });

    it('the stubbed-API Playwright job and deployedE2eTiers.yml do not reference the status script', () => {
        const ci = readFileSync(join(WORKFLOW_DIR, '_ci.yml'), 'utf8');
        const tiers = readFileSync(join(WORKFLOW_DIR, 'deployedE2eTiers.yml'), 'utf8');
        const stubbedJob = parse(ci).jobs['integration-web-playwright'] as Job | undefined;

        expect(stubbedJob, 'the stubbed-API job was renamed — update this guard').toBeDefined();
        expect(JSON.stringify(stubbedJob)).not.toContain('sandboxWake');
        expect(JSON.stringify(stubbedJob)).not.toContain('sandboxStatus');
        // The whole files, comments included: the notes that remain say WHY the reference is gone without naming
        // the script's start verb, and a re-added step would name it.
        expect(ci.split('\n').filter((line) => /sandboxWake\.sh\s+(check|ensure)/u.test(line))).toEqual([]);
        expect(tiers.split('\n').filter((line) => /sandboxWake\.sh\s+(check|ensure)/u.test(line))).toEqual([]);
    });

    // Guards the vacuity directly: the assertion above is only meaningful while the job still runs the suite.
    it('the stubbed-API job still runs the web Playwright suite', () => {
        const job = parse(readFileSync(join(WORKFLOW_DIR, '_ci.yml'), 'utf8')).jobs[
            'integration-web-playwright'
        ] as Job;

        expect(
            (job.steps ?? []).some((step) => /npm run test:e2e --workspace=@commise\/web/u.test(step.run ?? '')),
        ).toBe(true);
    });
});

describe('sandbox status check wiring — no sandbox deploy runs against a possibly-stopped database', () => {
    it('every sandbox deploy step is preceded by the status check in its own job', () => {
        expect(
            findUncheckedDeploys(),
            'a sandbox `cdk deploy` with no `sandboxWake.sh check` before it in the same job can wedge its stack ' +
                'in UPDATE_ROLLBACK_FAILED against a stopped instance. Add the check step (and skip the deploy when ' +
                'it answers 3), or add an EXEMPT_DEPLOY_STEPS entry stating why that stack touches no database.',
        ).toEqual([]);
    });

    // The jobs that exist today. Named explicitly so NARROWING the check — deleting the step from one job while
    // the generic rule above still passes for the others — is a red test, not a silent regression.
    it.each(['sandboxPreview.yml::gate', 'sandbox-identity-deploy.yml::deploy'])('%s checks the sandbox', (jobId) => {
        expect(checkSteps().map(({ id }) => id.split('::').slice(0, 2).join('::'))).toContain(jobId);
    });

    // ⛔ The check is only a precondition of the deploy if the deploying job cannot start without it. A `needs:`
    // edge across two jobs is asserted rather than assumed — without this, deleting the edge would leave every
    // preview deploy free to run against a stopped database with the suite still green.
    it('⛔ the preview deploy cannot start before the job that checks the sandbox', () => {
        const preview = workflows().find(({ file }) => file === 'sandboxPreview.yml');
        const jobs = (preview?.doc.jobs ?? {}) as Record<string, { needs?: unknown }>;

        expect(jobs, 'the gate job was renamed or removed — update this guard').toHaveProperty('gate');
        expect(jobs, 'the deploy job was renamed or removed — update this guard').toHaveProperty('deploy');
        expect(jobs['deploy']?.needs).toEqual(['gate']);
    });

    // A check that cannot fail the job is worse than none, but a check whose exit 3 (down) ENDS the step is
    // worse in the other direction: GitHub's default shell is `bash -e`. So the status is captured with `||`,
    // and what is forbidden is swallowing it (`|| true`) or marking the step `continue-on-error`.
    it('no check step suppresses its own exit status', () => {
        for (const { id, step } of checkSteps()) {
            expect(step['continue-on-error'] ?? false, `${id} must be able to fail the job`).toBe(false);
            expect(step.run ?? '', `${id} must not swallow the check's exit status`).not.toMatch(
                /sandboxWake\.sh check[^\n]*\|\|\s*(true|:)(\s|$)/u,
            );
        }
    });

    it('is wired in at least as many jobs as deploy DB-backed sandbox stacks', () => {
        expect(checkSteps().length).toBeGreaterThanOrEqual(2);
    });
});

describe('sandbox status check wiring — the check cannot be defused from a workflow', () => {
    it.each(TUNING_KNOBS)('no workflow sets %s', (knob) => {
        const offenders = readdirSync(WORKFLOW_DIR)
            .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
            .filter((file) => readFileSync(join(WORKFLOW_DIR, file), 'utf8').includes(knob));

        expect(
            offenders,
            `${knob} is a TEST seam. Setting it in a workflow defeats the check while every wiring assertion ` +
                'above stays green — `SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS=0` restores the exact race that ' +
                'wedged kitchensink-data-sandbox on 2026-09-05. Delete it; if a caller genuinely needs a ' +
                'different headroom, change the default in the script and say why.',
        ).toEqual([]);
    });

    // Guards the vacuity directly: the prohibition above is only meaningful while these names are the ones
    // the script actually reads. A rename would otherwise leave assertions passing about nothing.
    it.each(TUNING_KNOBS)('%s is still a knob the script reads', (knob) => {
        expect(
            readFileSync(WAKE_SCRIPT, 'utf8'),
            `${knob} no longer appears in sandboxWake.sh — the prohibition above has gone vacuous.`,
        ).toContain(knob);
    });

    it.each(RETIRED_KNOBS)('%s is gone from the script and from every workflow', (knob) => {
        expect(readFileSync(WAKE_SCRIPT, 'utf8')).not.toContain(knob);
        expect(
            readdirSync(WORKFLOW_DIR)
                .filter((file) => file.endsWith('.yml'))
                .filter((file) => readFileSync(join(WORKFLOW_DIR, file), 'utf8').includes(knob)),
        ).toEqual([]);
    });
});

/**
 * ⛔ THE CHECK AND THE SCHEDULE MUST AGREE, and nothing but this made them.
 *
 * `sandboxWake.sh` resolves "the next nightly stop" as 00:00 `America/New_York`. That is a COPY of a fact
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
describe('sandbox status check wiring — the check guards the boundary the scheduler actually fires at', () => {
    /** The stop schedule, read out of the synthesized stack rather than out of the source text. */
    const stopSchedule = (): { readonly expression: string; readonly timezone: string } => {
        const template = Template.fromStack(
            ((app) =>
                new SandboxSchedulerStack(app, 'SandboxScheduler-sandbox', {
                    env: { account: '123456789012', region: 'us-east-1' },
                    stage: 'sandbox',
                    alarmsEnabled: false,
                    alarmTopic: sns.Topic.fromTopicArn(
                        new Stack(app, 'AlarmTopicHost'),
                        'AlarmTopic',
                        'arn:aws:sns:us-east-1:123456789012:kitchensink-alarms-sandbox',
                    ),
                }))(testApp()),
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
            `sandboxWake.sh lands on ${rendered} ${timezone} but the scheduler's stop cron is ` +
                `"${expression}". The gate would guard a boundary the scheduler does not fire at, and report ` +
                '`clear` for a deploy that is about to be stopped mid-flight.',
        ).toBe(`${hour?.padStart(2, '0')}:${minute?.padStart(2, '0')}`);
    });

    it('reasons in the same timezone the stop cron is expressed in', () => {
        expect(readFileSync(WAKE_SCRIPT, 'utf8')).toContain(`SANDBOX_WAKE_SCHEDULE_TZ='${stopSchedule().timezone}'`);
    });
});

/** GitHub's job limit when a job states none. */
const RUNNER_DEFAULT_TIMEOUT_MINUTES = 360;

/**
 * The longest `check` can run, from the script's own default: it waits for a STARTING database and then for a
 * STARTING NAT, each bounded by the timeout. (It no longer waits for the nightly boundary: there is no wake to
 * follow it.) Pure.
 *
 * @param script - The text of `sandboxWake.sh`.
 * @returns Seconds.
 */
function checkWorstCaseSeconds(script: string): number {
    const value = /^SANDBOX_WAKE_DEFAULT_TIMEOUT_SECONDS=(\d+)$/mu.exec(script)?.[1];

    if (value === undefined) {
        throw new Error(
            'sandboxWake.sh no longer defines SANDBOX_WAKE_DEFAULT_TIMEOUT_SECONDS; the worst case cannot be derived.',
        );
    }

    return 2 * Number(value);
}

/**
 * Every job that runs the check but would be killed inside it: a job limit that leaves no time after the check's
 * worst case, or a limit on the check step itself below that worst case. Pure.
 *
 * @param docs - Parsed workflows.
 * @param worstCase - {@link checkWorstCaseSeconds}.
 * @returns Violation ids (`<file>::<job>`).
 */
function jobsTooShortForTheCheck(docs: readonly { file: string; doc: Doc }[], worstCase: number): readonly string[] {
    const minutes = (value: unknown, fallback: number): number => (value === undefined ? fallback : Number(value));
    const violations: string[] = [];

    for (const { file, doc } of docs) {
        for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
            const gate = (job.steps ?? []).find((step) => (step.run ?? '').includes(CHECK_INVOCATION));

            if (gate === undefined) {
                continue;
            }

            const jobSeconds = minutes(job['timeout-minutes'], RUNNER_DEFAULT_TIMEOUT_MINUTES) * 60;
            const gateSeconds = minutes(gate['timeout-minutes'], Infinity) * 60;

            if (!(jobSeconds > worstCase) || !(gateSeconds >= worstCase)) {
                violations.push(`${file}::${jobName}`);
            }
        }
    }

    return violations.sort();
}

/**
 * Run 37173553902 (2026-10-04): six Playwright shards started 40 minutes before the 00:00 ET stop, and a 45-minute
 * job limit killed every shard inside a gate that was WAITING for the boundary, so no test ran and the check read
 * "cancelled". The wait is gone, but the lesson is not: a job limit must be sized on the check's own bounds, so the
 * check's bounds are the ones that fire.
 */
describe('sandbox status check wiring — a job that runs the check outlives the check', () => {
    const checkStep = { run: `bash .github/scripts/${CHECK_INVOCATION} us-east-1` };
    const WORST = 1800;

    it.each([
        ['a 20-minute job with the check', { 'timeout-minutes': 20, steps: [checkStep] }, true],
        ['a job with the check and no limit (the runner default)', { steps: [checkStep] }, false],
        ['a job long enough for the check and its own work', { 'timeout-minutes': 60, steps: [checkStep] }, false],
        [
            'a job limit equal to the check, which leaves no time for the work',
            { 'timeout-minutes': 30, steps: [checkStep] },
            true,
        ],
        [
            'a long job whose check step has its own short limit',
            { 'timeout-minutes': 60, steps: [{ ...checkStep, 'timeout-minutes': 10 }] },
            true,
        ],
        ['a 20-minute job without the check', { 'timeout-minutes': 20, steps: [{ run: 'npm test' }] }, false],
    ] as const)('%s', (_label, job, flagged) => {
        expect(jobsTooShortForTheCheck([{ file: 'w.yml', doc: { jobs: { j: job } } }], WORST)).toEqual(
            flagged ? ['w.yml::j'] : [],
        );
    });

    it('derives the worst case from the script: a starting database, then a starting NAT', () => {
        expect(checkWorstCaseSeconds(readFileSync(WAKE_SCRIPT, 'utf8'))).toBeGreaterThan(0);
        expect(readFileSync(WAKE_SCRIPT, 'utf8')).not.toContain('MAX_BOUNDARY_WAIT');
    });

    it('no job that runs the check can be killed inside it', () => {
        expect(
            jobsTooShortForTheCheck(workflows(), checkWorstCaseSeconds(readFileSync(WAKE_SCRIPT, 'utf8'))),
            "raise the job limit to the check's worst case plus the job's own work, and say so beside it",
        ).toEqual([]);
    });
});
