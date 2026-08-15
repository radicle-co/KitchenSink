import {
    Duration,
    Stack,
    type StackProps,
    TimeZone,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_scheduler as scheduler,
    aws_scheduler_targets as schedulerTargets,
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
 * Sandbox nightly-shutdown scheduler (ADR-0007).
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

        // ── Least-privilege IAM ─────────────────────────────────────────────────────────────────
        // Read-only discovery actions do not support resource-level scoping, so they use `*`; every
        // MUTATING action is scoped by a sandbox ARN pattern or a sandbox tag condition.
        schedulerFn.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'SandboxSchedulerDiscovery',
                actions: [
                    'rds:DescribeDBInstances',
                    'ecs:ListClusters',
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
                resources: [`arn:aws:ecs:${this.region}:${this.account}:service/*sandbox*/*`],
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

        // ── EventBridge Scheduler pair (stop 00:00 ET / start 09:00 ET, DST-correct) ─────────────
        // Supply `day` (day-of-month) only — the CDK helper rejects setting both day and weekDay, and
        // fills the unset weekDay field with `?`, yielding the intended `cron(0 0 * * ? *)`.
        const stopExpression = scheduler.ScheduleExpression.cron({
            minute: '0',
            hour: '0',
            day: '*',
            month: '*',
            year: '*',
            timeZone: TimeZone.AMERICA_NEW_YORK,
        });

        const startExpression = scheduler.ScheduleExpression.cron({
            minute: '0',
            hour: '9',
            day: '*',
            month: '*',
            year: '*',
            timeZone: TimeZone.AMERICA_NEW_YORK,
        });

        new scheduler.Schedule(this, 'SandboxStopSchedule', {
            schedule: stopExpression,
            target: new schedulerTargets.LambdaInvoke(schedulerFn, {
                input: scheduler.ScheduleTargetInput.fromObject({ action: 'stop' }),
            }),
            description: 'Stop the sandbox tier nightly at 00:00 America/New_York (ADR-0007)',
        });

        new scheduler.Schedule(this, 'SandboxStartSchedule', {
            schedule: startExpression,
            target: new schedulerTargets.LambdaInvoke(schedulerFn, {
                input: scheduler.ScheduleTargetInput.fromObject({ action: 'start' }),
            }),
            description: 'Start the sandbox tier every morning at 09:00 America/New_York (ADR-0007)',
        });
    }
}
