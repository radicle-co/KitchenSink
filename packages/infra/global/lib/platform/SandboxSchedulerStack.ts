import {
    CfnOutput,
    Duration,
    Stack,
    TimeZone,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_scheduler as scheduler,
    aws_scheduler_targets as schedulerTargets,
    type StackProps,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { NODE_LAMBDA_RUNTIME } from '@kitchensink/infra-security';

/** Props for {@link SandboxSchedulerStack}. */
export interface SandboxSchedulerStackProps extends StackProps {
    /** The stage this scheduler controls — only ever `sandbox` (guarded by `GlobalStack`). */
    readonly stage: string;
}

/**
 * Sandbox nightly-shutdown scheduler (ADR-0007, amended by ADR-0028 and its Update of 2026-09-03).
 *
 * Provisions a least-privilege Lambda plus an EventBridge Scheduler pair — STOP at 00:00 ET and START
 * at 09:00 ET, daily, `America/New_York` (DST-correct) — that stops/starts the sandbox RDS instance,
 * scales the sandbox ECS services to `0` and back to their persisted prior desired count, and
 * stops/starts the sandbox NAT EC2 instance. The Lambda's selectors touch ONLY sandbox resources, and
 * its IAM is scoped to exactly the rds/ecs/ec2/ssm actions it uses (no service-wildcard admin).
 *
 * This stack is instantiated by `GlobalStack` ONLY when `stage === 'sandbox'`, so prod/dev get
 * nothing and the prod synthesized template is unchanged (ADR-0002 no-prod-diff discipline). It is
 * persistent sandbox-CONTROL infra, so it stays tagged `Environment=global` (App-level tag) and MUST
 * survive per-PR cleanup — it is never a `pr-{N}` resource (ADR-0005).
 *
 * @implements ADR-0007
 * @implements ADR-0028
 */
export class SandboxSchedulerStack extends Stack {
    /** The scheduler Lambda's name (exported for ops/manual invocation). */
    public readonly schedulerFunctionName: string;

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

        const schedulerFn = new lambda.Function(this, 'SandboxSchedulerFunction', {
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: schedulerHandler,
            code: schedulerCode,
            timeout: Duration.seconds(300),
            memorySize: 256,
            description: `Sandbox nightly stop/start controller (${props.stage})`,
        });
        this.schedulerFunctionName = schedulerFn.functionName;

        // ADR-0028 — the on-demand button (`sandbox-up.yml`) and the hourly reconciler
        // (`sandbox-reconcile.yml`) both drive this function, so they have to find it by name.
        //
        // ⚠️ Exported rather than pattern-matched on purpose. Those two workflows must NOT reimplement
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
                    `arn:aws:ecs:${this.region}:${this.account}:service/*-pr-*/*`,
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

        // ── Nightly STOP at 00:00 ET and START at 09:00 ET, DST-correct ──────────────────────────
        //
        // ⚠️  ADR-0028 DELETED the 09:00 start; the Update of 2026-09-03 RESTORED it. Read why before
        // deleting it again — the reasoning that removed it was correct and its premise has since expired.
        //
        // ADR-0028's argument was that a daily start "would resurrect the whole tier every weekday morning
        // regardless of whether anyone wanted it". That held while the shared ALB and identity service were
        // merely STOPPED. ADR-0028's own amendment of 2026-08-30 made them DELETED STACKS, and a schedule
        // cannot create a stack — so what a start can now resurrect is exactly the two resources that were
        // only ever stoppable: the sandbox RDS instance and the NAT EC2 instance. The owner ruled on
        // 2026-09-03 that those two follow the original clock: "The RDS should still be stopped and started
        // on the original schedule."
        //
        // ⛔ The pair is EXACT INVERSES because `runStop`/`runStart` are: `runStop` records each ECS
        // service's prior desired count in SSM and `runStart` deliberately refuses to guess when that
        // parameter is missing. Scheduling one without the other leaves that bookkeeping half-applied.
        //
        // The STOP is not merely a backstop: AWS auto-restarts a stopped RDS instance after SEVEN DAYS, and
        // this catches that within a day, every time — including in the weeks when GitHub's best-effort
        // scheduled workflows do not run at all. The START carries the mirror property: a deploy landing in
        // the old 00:00-09:00 window no longer meets a stopped database, which is the ADR-0007 x ADR-0022
        // `UPDATE_ROLLBACK_FAILED` wedge that `sandbox-wake.sh` was written after.
        //
        // Supply `day` (day-of-month) only — the CDK helper rejects setting both day and weekDay, and
        // fills the unset weekDay field with `?`, yielding the intended `cron(0 0 * * ? *)`.
        const dailyAt = (hour: string): scheduler.ScheduleExpression =>
            scheduler.ScheduleExpression.cron({
                minute: '0',
                hour,
                day: '*',
                month: '*',
                year: '*',
                timeZone: TimeZone.AMERICA_NEW_YORK,
            });

        new scheduler.Schedule(this, 'SandboxStopSchedule', {
            schedule: dailyAt('0'),
            target: new schedulerTargets.LambdaInvoke(schedulerFn, {
                input: scheduler.ScheduleTargetInput.fromObject({ action: 'stop' }),
            }),
            description: 'Stop the sandbox tier nightly at 00:00 America/New_York (ADR-0007, ADR-0028)',
        });

        // ⚠️ The construct id is the ORIGINAL one this schedule carried before `ccae565f` removed it.
        // EventBridge Scheduler names the schedule from the construct path, so reintroducing it under a new
        // id would leave the old name orphaned in the account if the delete ever failed, and would make the
        // restore invisible in `cdk diff` as a rename rather than a re-creation.
        new scheduler.Schedule(this, 'SandboxStartSchedule', {
            schedule: dailyAt('9'),
            target: new schedulerTargets.LambdaInvoke(schedulerFn, {
                input: scheduler.ScheduleTargetInput.fromObject({ action: 'start' }),
            }),
            description: 'Start the sandbox tier daily at 09:00 America/New_York (ADR-0007, ADR-0028)',
        });
    }
}
