import {
    CfnOutput,
    Duration,
    Stack,
    TimeZone,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cloudwatchActions,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_scheduler as scheduler,
    aws_scheduler_targets as schedulerTargets,
    aws_sns as sns,
    aws_ssm as ssm,
    aws_stepfunctions as sfn,
    aws_stepfunctions_tasks as sfnTasks,
    type StackProps,
    aws_logs as logs,
    aws_logs_destinations as logsDestinations,
    RemovalPolicy,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { NODE_LAMBDA_RUNTIME } from '@radicle-co/infra-shared/security';

import { NIGHTLY_STOP_HOUR, NIGHTLY_TIMEZONE } from '../sandbox-scheduler/nightlyStop.js';
import { SCHEDULED_RULE_STAGE_TAG } from '../sandbox-scheduler/scheduler.js';
import { teardownGrants } from '../sandbox-scheduler/teardownGrants.js';

/**
 * How many one-minute iterations the reclaim may take (ADR-0061). Two hours: well past the slowest stack delete seen,
 * and a bound so a wedged delete ends in an announced failure rather than looping for ever.
 */
const RECLAIM_MAX_ITERATIONS = 120;

/** The pause between reclaim iterations. */
const RECLAIM_POLL_SECONDS = 60;

/** Props for {@link SandboxSchedulerStack}. */
export interface SandboxSchedulerStackProps extends StackProps {
    /**
     * The log forwarder's ARN, resolved in CI. Absent means no subscription filter is attached —
     * see `GlobalStackProps.logForwarderArn` for the cycle that makes absence a supported state.
     */
    readonly logForwarderArn?: string;

    /** The stage this scheduler controls — only ever `sandbox` (guarded by `GlobalStack`). */
    readonly stage: string;

    /** Whether this stage creates CloudWatch alarms (`alarmFeatureFlag.test.ts`). */
    readonly alarmsEnabled: boolean;

    /** The stage's alarm topic (`MessageSubstrateStack.alarmTopic`), which the failed-run alarm publishes to. */
    readonly alarmTopic: sns.ITopic;
}

/**
 * Sandbox scheduler (ADR-0007, ADR-0060).
 *
 * Provisions a least-privilege Lambda plus ONE EventBridge Scheduler schedule — STOP at 00:00 ET, daily,
 * `America/New_York` (DST-correct) — that switches every scheduled rule off, stops the sandbox RDS instance, scales
 * the sandbox and per-PR ECS services to `0` (recording each prior desired count), and stops the sandbox NAT EC2
 * instance. Nothing starts the sandbox on a clock: Sandbox Up invokes the per-PR `start` by hand, and `sync` — the
 * only writer of a scheduled rule's state — runs after anything that changes what is up. The Lambda's selectors touch
 * ONLY sandbox resources, and its IAM is scoped to exactly the rds/ecs/ec2/ssm/events actions it uses.
 *
 * This stack is instantiated by `GlobalStack` ONLY when `stage === 'sandbox'`, so prod/dev get
 * nothing and the prod synthesized template is unchanged (ADR-0002 no-prod-diff discipline). It is
 * persistent sandbox-CONTROL infra, so it stays tagged `Environment=sandbox` (the App-level tier tag) and
 * MUST survive per-PR cleanup — it is never a `pr-{N}-…` resource (ADR-0005). ⚠️ The tier word is not a
 * protection word: what protects it is that no `pr-{N}` token can produce `sandbox`, since a token carries
 * digits and that word does not.
 *
 * @implements ADR-0007
 * @implements ADR-0028
 */
export class SandboxSchedulerStack extends Stack {
    /** The scheduler Lambda's name (exported for ops/manual invocation). */
    public readonly schedulerFunctionName: string;

    /** The midnight reclaim loop (ADR-0061), exported for ops and for `sandboxScheduler.sh reclaim-status`. */
    public readonly reclaimStateMachine: sfn.StateMachine;

    public constructor(scope: Construct, id: string, props: SandboxSchedulerStackProps) {
        super(scope, id, props);

        // Bundled by esbuild.mjs to dist-lambda/ (npm run bundle:lambda, run by the deploy script).
        // A bare `cdk synth` (no bundle) falls back to an inline placeholder so synth never fails; the
        // real deploy always builds the asset.
        //
        // The placeholder must be SELF-CONSISTENT: CDK packages `fromInline` code as a CommonJS
        // `index.js`, so the inline module uses `exports.handler` (not ESM `export`) and the function
        // handler switches to `index.handler`. Otherwise an (un-bundled) deploy would create a Lambda
        // whose handler `sandbox-scheduler/handler.handler` resolves to nothing and fails to invoke.
        // With the asset present, the bundled handler path is used.
        // This module lives at lib/platform/, so the package-root dist-lambda/ is two levels up from
        // source (tsx) but three from the compiled dist/lib/platform/ (how CI deploys via
        // `node dist/bin/app.js`) — probe both so the REAL handler ships either way, not the placeholder.
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);
        const schedulerCode = hasLambdaAsset
            ? lambda.Code.fromAsset(lambdaAssetDir)
            : // THROW (don't return { ok: false }) when the bundle is missing: a returned value makes the
              // scheduled invocation succeed, so an accidentally un-bundled deploy would look healthy while
              // silently never stopping/starting the sandbox. Throwing surfaces it as a Lambda error/alarm.
              lambda.Code.fromInline(
                  'exports.handler = async () => { throw new Error("sandbox-scheduler asset not built — deploy shipped the placeholder"); };',
              );
        const schedulerHandler = hasLambdaAsset ? 'sandbox-scheduler/handler.handler' : 'index.handler';
        const reclaimCode = hasLambdaAsset
            ? lambda.Code.fromAsset(lambdaAssetDir)
            : lambda.Code.fromInline(
                  'exports.handler = async () => { throw new Error("sandbox-reclaim asset not built — deploy shipped the placeholder"); };',
              );
        const reclaimHandler = hasLambdaAsset ? 'sandbox-scheduler/reclaimHandler.handler' : 'index.handler';

        // ⛔ THE PLATFORM DSN, resolved at DEPLOY time, exactly as `DataStack` resolves it for the bootstrap and the
        // reaper. This stack exists only at the sandbox stage, so the base stage is `sandbox`. Both functions report
        // through it (`announceSilentNoOp`): the sandbox alarm topic has no subscriber, so a failed stop or a reclaim
        // that ended with stacks left behind is a Sentry issue or it is nothing (ADR-0061).
        //
        // ⚠️ A MISSING PARAMETER FAILS THE DEPLOY, the intended behaviour: a function that silently cannot report
        // is the failure this exists to prevent.
        const drainBaseStage = props.stage === 'prod' ? 'prod' : 'sandbox';
        const platformSentryDsn = ssm.StringParameter.valueForStringParameter(
            this,
            `/kitchensink/${drainBaseStage}/sentry/platform-dsn`,
        );

        // ── An EXPLICIT log group, drained and registered (plan U18, ADR-0042) ──
        //
        // ⛔ THIS FUNCTION WROTE TO AN IMPLICIT GROUP. A Lambda with no declared group gets one created by
        // the service on first invocation — outside CloudFormation, so it exists in no template, is deleted
        // by no teardown, and has NO RETENTION: it keeps every line forever, and the cost of that is
        // invisible because nothing in the repository names the resource. Declaring it puts it under the
        // stack that owns the function, gives it the repo's retention, and — the reason this unit exists —
        // makes it something a subscription filter can attach to.
        //
        // ⚠️ NO `logGroupName`. CDK generates one from the construct path, which is what every other group
        // in this repository does. Naming it explicitly would require naming the FUNCTION explicitly too,
        // and changing a Lambda's name from generated to explicit REPLACES it — a needless replacement of
        // the function that migrates the production database.
        const schedulerLogGroup = new logs.LogGroup(this, 'SandboxSchedulerLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // ⛔ ONLY WHEN THE ARN IS KNOWN. This was `Fn.importValue` against the webhooks app's export, which
        // made the two apps mutually dependent: `WebhooksStack` imports this app's `HandleSyncTopicArn`, so
        // neither could go first and every global deploy failed with "No export named … LogForwarderArn
        // found". The ARN now arrives as a CI-resolved input; absent, the filter is skipped and the
        // synth says so.
        //
        // ⚠️ IT ATTACHES ON THE NEXT DEPLOY OF THIS APP, WHICH IS NOT THE NEXT PIPELINE RUN. Nothing
        // arms `deploy_global` when the export APPEARS: it is a `workflow_dispatch`, a change under
        // `packages/infra/global/**`, or — on sandbox only — an absent platform stack. So on a fresh
        // account, where this app necessarily deploys before the webhooks app publishes the ARN, the
        // window stays open until one of those happens. ADR-0042 records it as a residual rather than
        // closing it here, because arming a prod deploy off a probe is a larger change than the gap.
        if (props.logForwarderArn !== undefined) {
            new logs.SubscriptionFilter(this, 'SandboxSchedulerLogDrain', {
                logGroup: schedulerLogGroup,
                destination: new logsDestinations.LambdaDestination(
                    lambda.Function.fromFunctionArn(this, 'ImportedLogForwarder', props.logForwarderArn),
                    { addPermissions: false },
                ),
                filterPattern: logs.FilterPattern.literal('-START -END -REPORT -"_aws"'),
                filterName: 'forward-app-logs',
            });
        }

        // ── The reclaim's own explicit log group and function (ADR-0061, ADR-0042) ──
        //
        // Drained like the scheduler's, and DELETED with the stack. No `logGroupName`, for the reason above.
        const reclaimLogGroup = new logs.LogGroup(this, 'SandboxReclaimLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        if (props.logForwarderArn !== undefined) {
            new logs.SubscriptionFilter(this, 'SandboxReclaimLogDrain', {
                logGroup: reclaimLogGroup,
                destination: new logsDestinations.LambdaDestination(
                    lambda.Function.fromFunctionArn(this, 'ImportedLogForwarderForReclaim', props.logForwarderArn),
                    { addPermissions: false },
                ),
                filterPattern: logs.FilterPattern.literal('-START -END -REPORT -"_aws"'),
                filterName: 'forward-app-logs',
            });
        }

        const reclaimFn = new lambda.Function(this, 'SandboxReclaimFunction', {
            logGroup: reclaimLogGroup,
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: reclaimHandler,
            code: reclaimCode,
            // ⛔ NOT in a VPC (ADR-0004): it reaches only public AWS endpoints, so attaching it would make it a NAT consumer.
            timeout: Duration.seconds(300),
            memorySize: 256,
            environment: { SENTRY_DSN: platformSentryDsn },
            description: `Sandbox midnight reclaim: deletes the stacks nothing uses, one step per call (${props.stage})`,
        });

        const schedulerFn = new lambda.Function(this, 'SandboxSchedulerFunction', {
            logGroup: schedulerLogGroup,
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: schedulerHandler,
            code: schedulerCode,
            timeout: Duration.seconds(300),
            memorySize: 256,
            // `RECLAIM_STATE_MACHINE_ARN` is added below, once the state machine exists. The state machine does not
            // reference this function, so there is no cycle.
            environment: { SENTRY_DSN: platformSentryDsn },
            description: `Sandbox midnight stop, per-PR start and scheduled-rule sync (${props.stage})`,
        });
        this.schedulerFunctionName = schedulerFn.functionName;

        // ADR-0060 — Sandbox Up, Sandbox Down, the PR-close cleanup and every non-prod deploy drive this function
        // (`.github/scripts/sandboxScheduler.sh`), so they have to find it by name.
        //
        // ⚠️ Exported rather than pattern-matched on purpose. Those workflows must NOT reimplement
        // stop/start with raw `aws ecs update-service` calls — `runStop` records each service's prior
        // desired count in SSM and `runStart` refuses to guess when it is missing, so a caller that skips
        // the bookkeeping strands the shared sandbox identity service at zero and kills sign-in for every
        // preview. Making the function easy to invoke is what makes doing it correctly the easy path.
        new CfnOutput(this, 'SchedulerFunctionName', {
            value: schedulerFn.functionName,
            exportName: `${this.stackName}:SchedulerFunctionName`,
        });

        // ── Least-privilege IAM ─────────────────────────────────────────────────────────────────
        // Read-only discovery actions do not support resource-level scoping, so they use `*`; every
        // MUTATING action is scoped by a sandbox ARN pattern or a sandbox tag condition.
        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerDiscovery',
                actions: [
                    'rds:DescribeDBInstances',
                    'ecs:ListClusters',
                    'ecs:DescribeClusters',
                    'ecs:ListServices',
                    'ecs:DescribeServices',
                    'ec2:DescribeInstances',
                ],
                resources: ['*'],
            }),
        );

        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerRds',
                actions: ['rds:StopDBInstance', 'rds:StartDBInstance'],
                resources: [`arn:aws:rds:${this.region}:${this.account}:db:*sandbox*`],
            }),
        );

        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerEcs',
                actions: ['ecs:UpdateService'],
                // ⛔ TWO PATTERNS, AND PROD MATCHES NEITHER. The shared tier's services live under a
                // cluster named `*sandbox*`; a per-PR preview's live under `*-pr-{N}-*`, which the first
                // pattern cannot reach — so before this the scheduler could SELECT a per-PR service and
                // then be denied by IAM, which is why the selector fix alone would have been inert.
                //
                // ⚠️ `*-pr-*` requires the literal `-pr-`. Production clusters are named `…-prod-…`,
                // which contains `-pro`, never `-pr-`, so prod is excluded by the pattern itself and not
                // merely by convention. `schedulerScope.test.ts` asserts that in both directions against
                // the SYNTHESIZED policy, because this is the boundary between "scale a preview down" and
                // "scale production down".
                resources: [
                    `arn:aws:ecs:${this.region}:${this.account}:service/*sandbox*/*`,
                    // ⛔ `kitchensink-` too (ADR-0061 review): the account also hosts another application, and a bare
                    // `*-pr-*` matched its clusters as well.
                    `arn:aws:ecs:${this.region}:${this.account}:service/kitchensink-*-pr-*/*`,
                ],
            }),
        );

        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerEc2',
                actions: ['ec2:StartInstances', 'ec2:StopInstances'],
                resources: [`arn:aws:ec2:${this.region}:${this.account}:instance/*`],
                conditions: {
                    StringLike: { 'ec2:ResourceTag/Name': '*sandbox*' },
                },
            }),
        );

        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerSsm',
                actions: ['ssm:GetParameter', 'ssm:PutParameter'],
                resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/kitchensink/sandbox-scheduler/*`],
            }),
        );

        // ── Scheduled rules (ADR-0060): `sync` is the ONLY writer of a scheduled rule's state ─────────────────
        //
        // `ListRules` has no resource type in the service authorization reference, so `*` is its only valid scope;
        // it reveals names and schedules, not the power to change them.
        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerRuleDiscovery',
                actions: ['events:ListRules'],
                resources: ['*'],
            }),
        );

        // `kitchensink-` is the start of every rule this repository deploys (CloudFormation truncates a generated name
        // but keeps the stack name it begins with), and the account also hosts another application.
        const repositoryRules = `arn:aws:events:${this.region}:${this.account}:rule/kitchensink-*`;

        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerRuleTags',
                actions: ['events:ListTagsForResource'],
                resources: [repositoryRules],
            }),
        );

        // ⛔ THE TAG IS THE BOUNDARY. `EnableRule`/`DisableRule` act on the `rule-on-default-event-bus` resource
        // type, whose condition keys include `aws:ResourceTag/${TagKey}` (Service Authorization Reference for
        // `events`). Only a NON-PROD stack's gate stamps `SandboxStage`, so a production rule — which never carries
        // it — cannot be toggled by this role, whatever the code above it decides.
        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerRuleToggle',
                actions: ['events:EnableRule', 'events:DisableRule'],
                resources: [repositoryRules],
                conditions: {
                    StringLike: { [`aws:ResourceTag/${SCHEDULED_RULE_STAGE_TAG}`]: ['sandbox', 'pr-*'] },
                },
            }),
        );

        // ⛔ …and production is refused outright, as a second, independent layer: an explicit Deny wins over any
        // Allow, so a production rule that somehow acquired a stage tag still cannot be switched.
        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerNeverProduction',
                effect: iam.Effect.DENY,
                actions: ['events:EnableRule', 'events:DisableRule'],
                resources: ['*'],
                conditions: { StringEquals: { 'aws:ResourceTag/Environment': 'production' } },
            }),
        );

        // ── The reclaim role: THE BOUNDARY (ADR-0061) ──────────────────────────────────────────────────────────
        //
        // ⛔ What it may delete is `teardownGrants`, the ONE definition CI's non-prod role also attaches (ADR-0063). The
        // planner (`reclaim.ts`) repeats the rule so that it never sends a call IAM would refuse, but if the planner is
        // wrong, THIS is what stops it. Held by set equality in `SandboxSchedulerStack.test.ts`.
        reclaimFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxReclaimDiscovery',
                actions: [
                    'cloudformation:DescribeStacks',
                    'rds:DescribeDBInstances',
                    'ec2:DescribeInstances',
                    'ecs:ListClusters',
                    'ecs:DescribeClusters',
                    'ecs:ListServices',
                    'ecs:DescribeServices',
                    'ecs:ListTasks',
                    'ecs:DescribeTasks',
                ],
                resources: ['*'],
            }),
        );

        for (const statement of teardownGrants({ account: this.account, region: this.region }, 'SandboxReclaim')) {
            reclaimFn.addToRolePolicy(statement);
        }

        // ── The loop: wait, reclaim, decide (ADR-0061) ─────────────────────────────────────────────────────────
        //
        // The state machine owns the sequence, the timer, the bound and the failure route, and DECIDES NOTHING: every
        // decision is in the Lambda's answer. A Standard machine, because it runs for up to two hours.
        //
        // ⛔ NO EXECUTION-LEVEL TIMEOUT. A timed-out execution cannot run its Catch, so the one timeout that would end
        // a wedged night would also end it silently. The bound is the iteration count instead, and it ends in `Fail`
        // after the Lambda has announced.
        //
        // Every state that ends in `Fail` is reached after an announcement: the Choice's failed branch only follows a
        // step whose handler announced `stacks-left-behind`, and `Report` announces `reclaim-crashed`. The sandbox
        // alarm topic has no subscriber, so a `Fail` with no announcement would be silent.
        const waitAMinute = new sfn.Wait(this, 'WaitAMinute', {
            time: sfn.WaitTime.duration(Duration.seconds(RECLAIM_POLL_SECONDS)),
        });
        const reclaimStep = new sfnTasks.LambdaInvoke(this, 'ReclaimStep', {
            lambdaFunction: reclaimFn,
            payload: sfn.TaskInput.fromObject({
                kind: 'step',
                'iteration.$': '$.iteration',
                maxIterations: RECLAIM_MAX_ITERATIONS,
            }),
            payloadResponseOnly: true,
            resultPath: '$.reclaim',
        });
        // A handler that threw (an AWS outage, an unobservable tier) gets two more tries before it is a crash. Every step
        // is a reconciler pass, so repeating one is safe.
        reclaimStep.addRetry({
            errors: ['States.TaskFailed'],
            maxAttempts: 2,
            interval: Duration.seconds(20),
            backoffRate: 2,
        });
        const reportCrash = new sfnTasks.LambdaInvoke(this, 'ReportCrash', {
            lambdaFunction: reclaimFn,
            payload: sfn.TaskInput.fromObject({ kind: 'report', 'error.$': '$.error' }),
            payloadResponseOnly: true,
            resultPath: sfn.JsonPath.DISCARD,
        });
        // ⚠️ The report runs in the SAME function as the step, so it shares the step's failure domain: a function that
        // fails at INIT (a bad bundle, a missing module) fails both, and nothing is announced. Retrying narrows that
        // window for a transient fault, and no more. ADR-0061 records the limit, and why the forced-failure proof at
        // deploy time must include a failure at init.
        reportCrash.addRetry({
            errors: ['States.TaskFailed'],
            maxAttempts: 3,
            interval: Duration.seconds(20),
            backoffRate: 2,
        });
        const crashed = new sfn.Fail(this, 'ReclaimCrashed', {
            error: 'ReclaimCrashed',
            cause: 'A reclaim step failed after its retries; the report step announced it.',
        });
        const leftBehind = new sfn.Fail(this, 'StacksLeftBehind', {
            error: 'StacksLeftBehind',
            cause: 'The reclaim reached its bound with work left; the final step announced it.',
        });
        const finished = new sfn.Succeed(this, 'ReclaimFinished');
        const nextIteration = new sfn.Pass(this, 'NextIteration', {
            parameters: { 'iteration.$': 'States.MathAdd($.iteration, 1)' },
        });

        reclaimStep.addCatch(reportCrash.next(crashed), { errors: ['States.ALL'], resultPath: '$.error' });
        nextIteration.next(waitAMinute);

        waitAMinute.next(reclaimStep).next(
            new sfn.Choice(this, 'Decide')
                .when(
                    sfn.Condition.and(
                        sfn.Condition.booleanEquals('$.reclaim.complete', true),
                        sfn.Condition.booleanEquals('$.reclaim.failed', true),
                    ),
                    leftBehind,
                )
                .when(sfn.Condition.booleanEquals('$.reclaim.complete', true), finished)
                .otherwise(nextIteration),
        );

        const reclaimLoopLogGroup = new logs.LogGroup(this, 'ReclaimStateMachineLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        this.reclaimStateMachine = new sfn.StateMachine(this, 'ReclaimStateMachine', {
            stateMachineType: sfn.StateMachineType.STANDARD,
            definitionBody: sfn.DefinitionBody.fromChainable(waitAMinute),
            logs: { destination: reclaimLoopLogGroup, level: sfn.LogLevel.ALL, includeExecutionData: false },
            tracingEnabled: true,
        });

        // The scheduler's stop starts the loop, and may do nothing else with it. Not an input to the loop's own
        // definition, so adding the ARN to the scheduler's environment closes no cycle.
        this.reclaimStateMachine.grantStartExecution(schedulerFn);
        schedulerFn.addEnvironment('RECLAIM_STATE_MACHINE_ARN', this.reclaimStateMachine.stateMachineArn);

        // Exported for ops, and for `sandboxScheduler.sh reclaim-status`, which Sandbox Up asks before it starts the
        // tier a running reclaim is about to delete from under it.
        new CfnOutput(this, 'ReclaimStateMachineArn', {
            value: this.reclaimStateMachine.stateMachineArn,
            exportName: `${this.stackName}:ReclaimStateMachineArn`,
        });

        // ── The midnight STOP, DST-correct — the ONLY scheduled job (ADR-0060) ────────────────────────────────
        //
        // ⛔ THERE IS NO START SCHEDULE, AND THE ABSENCE IS THE DECISION. The owner ruled on 2026-10-12: "no automatic
        // or scheduled tasks or jobs except for the single one to check if the sandbox is running at midnight and
        // bringing every single sandbox down." The sandbox starts when Sandbox Up is pressed for ONE PR, through this
        // function's `{ action: 'start', stage: 'pr-<N>' }`. Do not restore a daily start: it resurrected the
        // database and the NAT every morning for nobody (ADR-0060 supersedes the start half of ADR-0007 §2).
        //
        // The STOP is not merely a backstop: AWS auto-restarts a stopped RDS instance after SEVEN DAYS, and this
        // catches that within a day, every time. It also switches every scheduled rule off FIRST, so no sweeper or
        // queue check runs against a database that is shutting down underneath it.
        //
        // Supply `day` (day-of-month) only — the CDK helper rejects setting both day and weekDay, and fills the
        // unset weekDay field with `?`, yielding the intended `cron(0 0 * * ? *)`.
        //
        // A failed run fails its invocation (`assertRunSucceeded`). Two retries within the hour give a brief AWS
        // refusal a second chance; repeating a stop is safe, since a service already at zero keeps its recorded count.
        new scheduler.Schedule(this, 'SandboxStopSchedule', {
            schedule: scheduler.ScheduleExpression.cron({
                minute: '0',
                hour: String(NIGHTLY_STOP_HOUR),
                day: '*',
                month: '*',
                year: '*',
                timeZone: TimeZone.of(NIGHTLY_TIMEZONE),
            }),
            target: new schedulerTargets.LambdaInvoke(schedulerFn, {
                // The schedule's own time becomes the reclaim execution's name (ADR-0061): a retried invocation carries the
                // same time, so it names the same night and cannot start a second loop.
                input: scheduler.ScheduleTargetInput.fromObject({
                    action: 'stop',
                    scheduledTime: scheduler.ContextAttribute.scheduledTime,
                }),
                retryAttempts: 2,
                maxEventAge: Duration.hours(1),
            }),
            description: 'Stop every sandbox at 00:00 America/New_York (ADR-0007, ADR-0060)',
        });

        // A refused start or stop, or a rule `sync` could not write, would otherwise leave the sandbox in the wrong
        // state with nothing to say so (Oct 6–7 2026, `InsufficientDBInstanceCapacity`). The run fails its
        // invocation, and this alarm reports it on the stage's existing alarm topic, which already carries the alert
        // email and the CloudWatch publish grant.
        if (props.alarmsEnabled) {
            new cloudwatch.Alarm(this, 'SandboxSchedulerRunFailedAlarm', {
                alarmDescription:
                    'A sandbox stop, start or rule sync failed: a resource or scheduled rule did not transition (for example the database start was refused for capacity). See the scheduler log.',
                metric: schedulerFn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
                threshold: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                evaluationPeriods: 1,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            }).addAlarmAction(new cloudwatchActions.SnsAction(props.alarmTopic));
        }
    }
}
