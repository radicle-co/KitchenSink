import {
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cloudwatchActions,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_lambda_destinations as lambdaDestinations,
    aws_logs as logs,
    aws_logs_destinations as logsDestinations,
    aws_sns as sns,
    aws_sqs as sqs,
    aws_ssm as ssm,
    type StackProps,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { NODE_LAMBDA_RUNTIME, subscribeAlarmEmail } from '@radicle-co/infra-shared/security';

import { ALARM_RELAY_EXPORT, relayAlarmTransitions } from './alarmRelaySubscription.js';

/** Props for {@link AlarmRelayStack}. */
export interface AlarmRelayStackProps extends StackProps {
    /** The BASE deploy stage this relay serves (`prod` or `sandbox`). */
    readonly stage: string;
    /** Email that receives this stack's own alarm (R3.2 / plan U11). Absent = no subscription, never a synth failure. */
    readonly alertEmail?: string;
    /**
     * Whether this stack creates its CloudWatch alarm and subscribes the relay to its own topic. Resolved at SYNTH time
     * from `ALARMS_ENABLED`; default OFF (`alarmFeatureFlag.test.ts`).
     */
    readonly alarmsEnabled: boolean;
    /** The log forwarder's ARN, resolved in CI. Absent means no subscription filter is attached (ADR-0042). */
    readonly logForwarderArn?: string;
}

/**
 * THE ALARM RELAY (ADR-0062): one Lambda per base stage that every alarm topic delivers to, turning an ALARM into a
 * Sentry issue.
 *
 * Sentry has no integration that ingests an SNS topic or a CloudWatch alarm, and no alarm topic in this repository had a
 * subscriber, so a page reached nobody. This stack owns the missing piece. It is PERSISTENT infrastructure (tier tag
 * `production` or `sandbox`, never a `pr-{N}` value), and it exports its function ARN so each service's alarm topic can
 * subscribe it (`alarmRelaySubscription.ts`).
 *
 * ⛔ NOT in a VPC. It reaches Sentry over the public internet, so a VPC attachment would make it a consumer of the NAT
 * instance (ADR-0004, whose consumer list is asserted in both directions) for no reason.
 *
 * ⛔ AN EVENT THAT COULD NOT BE DELIVERED IS KEPT. Lambda retries an asynchronous invocation twice and then discards it
 * unless a failure destination holds it; the queue below is that destination, its depth is alarmed, and the handler
 * throws on any delivery failure precisely so that this path is taken.
 *
 * ⚠️ NO `logGroupName` on the group and no explicit function name: CDK generates names from the construct path, and an
 * explicit function name would make a later rename a REPLACEMENT of a function other stacks hold an import of.
 *
 * @implements ADR-0062
 */
export class AlarmRelayStack extends Stack {
    /** The relay function. */
    public readonly relayFunction: lambda.Function;
    /** Where an alarm the relay could not deliver is kept. */
    public readonly failureQueue: sqs.Queue;
    /** This stack's own alarm topic, which the failure-queue depth alarm publishes to. */
    public readonly alarmTopic: sns.Topic;

    public constructor(scope: Construct, id: string, props: AlarmRelayStackProps) {
        super(scope, id, props);

        const { stage } = props;

        // Bundled by esbuild.mjs to dist-lambda/ (npm run bundle:lambda). A bare `cdk synth` with no bundle falls back to
        // a placeholder that THROWS when invoked, so an un-bundled deploy fails loudly instead of looking healthy while
        // delivering nothing. Both source (tsx) and compiled (`dist/lib/platform`) layouts are probed.
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);

        // ⛔ THE PLATFORM DSN, resolved at DEPLOY time as `DataStack` and the scheduler resolve it. A missing parameter
        // fails the deploy, the intended behaviour: a relay that silently cannot report is the failure this exists to
        // prevent.
        const platformSentryDsn = ssm.StringParameter.valueForStringParameter(
            this,
            `/kitchensink/${stage === 'prod' ? 'prod' : 'sandbox'}/sentry/platform-dsn`,
        );

        // An EXPLICIT log group (ADR-0042): an implicit one is created outside CloudFormation with no retention, and cannot
        // carry a subscription filter. The relay logs one structured line per transition, which is how an OK is recorded.
        const logGroup = new logs.LogGroup(this, 'AlarmRelayLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        if (props.logForwarderArn !== undefined) {
            new logs.SubscriptionFilter(this, 'AlarmRelayLogDrain', {
                logGroup,
                destination: new logsDestinations.LambdaDestination(
                    lambda.Function.fromFunctionArn(this, 'ImportedLogForwarder', props.logForwarderArn),
                    { addPermissions: false },
                ),
                filterPattern: logs.FilterPattern.literal('-START -END -REPORT -"_aws"'),
                filterName: 'forward-app-logs',
            });
        }

        // ⛔ AN EXPLICIT ROLE, not the managed basic-execution policy (cdk-nag IAM4): it may write to its own log group and,
        // through the failure destination below, send to its own queue — and nothing else.
        const role = new iam.Role(this, 'AlarmRelayRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: `Alarm relay (${stage}): writes its own logs and parks undeliverable alarms`,
        });

        logGroup.grantWrite(role);

        this.failureQueue = new sqs.Queue(this, 'AlarmRelayFailureQueue', {
            enforceSSL: true,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14),
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // The single authority on the failure queue (`queueProducerRegister.test.ts`). The failure destination below adds the
        // same grant itself; stating it keeps the authority visible instead of a side effect of a construct option.
        this.failureQueue.grantSendMessages(role);

        this.relayFunction = new lambda.Function(this, 'AlarmRelayFunction', {
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: hasLambdaAsset ? 'alarmRelay/handler.handler' : 'index.handler',
            code: hasLambdaAsset
                ? lambda.Code.fromAsset(lambdaAssetDir)
                : lambda.Code.fromInline(
                      'exports.handler = async () => { throw new Error("alarm-relay asset not built — deploy shipped the placeholder"); };',
                  ),
            role,
            logGroup,
            // ⛔ NOT in a VPC (ADR-0004): it reaches only the public internet.
            timeout: Duration.seconds(30),
            memorySize: 128,
            environment: { SENTRY_DSN: platformSentryDsn, STAGE: stage },
            // The default for an asynchronous invocation is two retries; stated rather than inherited, because the
            // failure path is only reached after them and the queue's alarm is calibrated to that.
            retryAttempts: 2,
            onFailure: new lambdaDestinations.SqsDestination(this.failureQueue),
            description: `Delivers every alarm topic's transitions to Sentry (${stage}, ADR-0062)`,
        });

        // This stack's own topic, for the one alarm it owns. Created ungated, like every alarm topic: a topic nothing
        // publishes to costs nothing, and gating it would thread an optional through the alarm for no saving.
        this.alarmTopic = new sns.Topic(this, 'AlarmRelayAlarmTopic', {
            enforceSSL: true,
            displayName: `Alarm relay alarms (${stage})`,
        });
        subscribeAlarmEmail(this.alarmTopic, props.alertEmail);

        // ⛔ WITHOUT THIS THE ALARM BELOW FIRES AND REACHES NOBODY: `enforceSSL` makes CDK attach a topic policy that
        // REPLACES the SNS default document, and the statement it replaces is the implicit account `Allow` that lets a
        // same-account CloudWatch alarm publish at all (`alarmTopicPublishGrant.test.ts`).
        this.alarmTopic.addToResourcePolicy(
            new iam.PolicyStatement({
                sid: 'AllowCloudWatchAlarmPublish',
                effect: iam.Effect.ALLOW,
                principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
                actions: ['sns:Publish'],
                resources: [this.alarmTopic.topicArn],
                conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
            }),
        );

        if (props.alarmsEnabled) {
            // ANYTHING in the queue is an alarm that never reached Sentry: the handler throws on every delivery failure so
            // that this is the only place it can end up. One message is already a missed page, so the threshold is one.
            //
            // ⚠️ This alarm reports through the relay too. When Sentry is the thing that is down, the relay cannot deliver
            // it, so the topic's email subscription is the route that still works — which is why the relay is a SECOND
            // subscriber on the topic, never the only one.
            const failureQueueAlarm = new cloudwatch.Alarm(this, 'AlarmRelayFailureQueueAlarm', {
                alarmName: `kitchensink-alarm-relay-failures-${stage}`,
                alarmDescription:
                    'An alarm could not be delivered to Sentry after Lambda’s retries and is parked in the relay’s failure queue. Read the queue, then redrive it once Sentry is reachable.',
                metric: this.failureQueue.metricApproximateNumberOfMessagesVisible({
                    period: Duration.minutes(5),
                    statistic: cloudwatch.Stats.MAXIMUM,
                }),
                threshold: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                evaluationPeriods: 1,
                datapointsToAlarm: 1,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });

            failureQueueAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
            relayAlarmTransitions(this, this.alarmTopic, this.relayFunction.functionArn);
        }

        // ⛔ EVERY CONSUMER IMPORTS THIS. Once a stack imports an export it cannot be deleted or changed, so the relay
        // function cannot be REPLACED without detaching every subscriber first; an in-place update is fine.
        new CfnOutput(this, 'AlarmRelayFunctionArnOutput', {
            value: this.relayFunction.functionArn,
            exportName: `${this.stackName}:${ALARM_RELAY_EXPORT}`,
        });
    }
}
