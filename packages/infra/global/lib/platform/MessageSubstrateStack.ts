import {
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    type StackProps,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cloudwatchActions,
    aws_dynamodb as dynamodb,
    aws_sns as sns,
    aws_ssm as ssm,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import {
    messageTableArnParameter,
    messageTableNameForStage,
    messageTableNameParameter,
} from '@kitchensink/infra-messaging';
import { subscribeAlarmEmail } from '@kitchensink/infra-security';

/** Props for {@link MessageSubstrateStack}. */
export interface MessageSubstrateStackProps extends StackProps {
    /** The BASE deploy stage this substrate serves (`prod` or `sandbox`). */
    readonly stage: string;
    /**
     * Email that receives this stack's alarms (R3.2 / plan U11). Per-stage configuration, never a literal —
     * this repository is public. Absent = topic with no subscription, never a synth failure.
     */
    readonly alertEmail?: string;
}

/**
 * The durable per-group message substrate for a BASE stage (R1.1–R1.7, KTD-1/KTD-2, plan U5).
 *
 * Producers write progress messages fire-and-forget through `@kitchensink/messaging`; a consumer (feature
 * 014) is woken by the stream and re-queries the group. This stack owns the store for `prod` and `sandbox`
 * only — see _Ownership_ below.
 *
 * ## Why DynamoDB and not the Valkey cache ADR-0016 chose
 *
 * ADR-0016 held DynamoDB as its **escalation**, "if a loss is ever judged unacceptable". R1.3 judges exactly
 * that. Two facts settle it independently of price: **ElastiCache is VPC-only**, which R1.1 forbids for
 * producers, and **Valkey pub/sub drops a message when no listener is connected**, which R1.3 forbids — and
 * PR 91 ships the producer half with no consumer at all, so "no listener" is the normal state for an entire
 * release. See ADR-0016's 2026-08-16 amendment.
 *
 * ## Ownership — why a base stage and a `pr-{N}` preview are built in DIFFERENT stacks
 *
 * This stack serves base stages ONLY. A per-PR table is created inside the **producer's own service stack**
 * instead, and the reason is mechanical rather than stylistic: `packages/infra/global/bin/app.ts` applies
 * `Tags.of(app).add('Environment', 'global')` to the entire app, and `sandbox-deploy.yml` never deploys the
 * global app with `stage=pr-{N}`. A per-PR table added here would therefore never be created — and if it
 * somehow were, it would carry `Environment=global`, which is precisely the tag ADR-0005's teardown uses to
 * decide what NOT to delete. It would leak one table per closed pull request, forever.
 *
 * The producer's stack is already deployed per-PR and already tagged `Environment=pr-{N}`, so a table
 * created there is torn down with it. This mirrors `foodDatabaseNameForStage`, which branches on
 * `stage === baseStage` for the same reason.
 *
 * ## ⚠️ What cannot be changed after the first deploy
 *
 * The partition key, the sort key and the stream view type are **immutable**. Changing any of them replaces
 * the table — losing every message and re-pointing two producer stacks — and nothing in PR 91 exercises the
 * read path these choices serve, because the first consumer arrives with feature 014. The choices are
 * pinned by `__tests__/MessageSubstrateStack.test.ts`; read KTD-2 before touching them.
 */
export class MessageSubstrateStack extends Stack {
    /** The per-group message table. */
    public readonly table: dynamodb.Table;

    /** The topic this stack's alarms publish to. */
    public readonly alarmTopic: sns.Topic;

    public constructor(scope: Construct, id: string, props: MessageSubstrateStackProps) {
        super(scope, id, props);

        const { stage } = props;

        this.table = new dynamodb.Table(this, 'MessageTable', {
            tableName: messageTableNameForStage(stage),
            // `PK = <groupType>#<groupId>` (KTD-2). TWO fields composed, not a bare food id: the named
            // producers are food's resolution pipeline AND the recipe import processors, and an import job
            // has no food id. Keeping the type explicit also makes "all import messages" a queryable prefix.
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            // `SK = <ISO-8601 ms>#<ULID>`. The ULID suffix is load-bearing: `PutItem` REPLACES on an
            // identical PK+SK and returns success, so a bare timestamp silently destroys two messages
            // written in the same millisecond — invisible to a fire-and-forget producer.
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            // ⚠️ The TTL attribute must hold a NUMBER (epoch seconds). DynamoDB silently IGNORES a
            // string-typed TTL — nothing expires, nothing errors, and the table grows forever while every
            // test that only checks "TTL is enabled" keeps passing. The adapter enforces the type (U6).
            timeToLiveAttribute: 'ttl',
            // Enabled now, deliberately unattached. Turning a stream on later is a table update this
            // account cannot safely perform on a live substrate, so 014 must be able to attach without one.
            stream: dynamodb.StreamViewType.KEYS_ONLY,
            // The messages are 3-day-TTL progress signals, not a system of record; a base stage's table is
            // recreated by the next deploy. RETAIN would leave an orphan blocking that recreation by name.
            removalPolicy: RemovalPolicy.DESTROY,
            pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
        });

        this.alarmTopic = new sns.Topic(this, 'MessageSubstrateAlarmTopic', {
            enforceSSL: true,
            displayName: `Message substrate alarms (${stage})`,
        });

        // R3.2 / U11 — an alarm that publishes to a topic nobody listens to is not an alarm.
        subscribeAlarmEmail(this.alarmTopic, props.alertEmail);

        const alarmAction = new cloudwatchActions.SnsAction(this.alarmTopic);

        // A write that DynamoDB rejects is a message nobody will ever read, and the producer that wrote it
        // was told nothing (fire-and-forget). This alarm is the only way that becomes visible.
        const writeThrottleAlarm = new cloudwatch.Alarm(this, 'MessageWriteThrottleAlarm', {
            alarmName: `kitchensink-messages-write-throttled-${stage}`,
            metric: this.table.metric('WriteThrottleEvents', {
                period: Duration.minutes(5),
                statistic: 'Sum',
            }),
            threshold: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        writeThrottleAlarm.addAlarmAction(alarmAction);

        const systemErrorAlarm = new cloudwatch.Alarm(this, 'MessageSystemErrorAlarm', {
            alarmName: `kitchensink-messages-system-errors-${stage}`,
            metric: this.table.metricSystemErrorsForOperations({
                operations: [dynamodb.Operation.PUT_ITEM],
                period: Duration.minutes(5),
                statistic: 'Sum',
            }),
            threshold: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        systemErrorAlarm.addAlarmAction(alarmAction);

        // Producers read these at DEPLOY time, never a hardcoded name (plan U6). SSM rather than a CFN
        // export because a per-PR substrate export IS deleted on PR close, and `RecipeServiceStack` already
        // documents what that costs: PR-close deletes a PR's stacks in no fixed order, so an importing
        // stack can hold an export hostage and deadlock the teardown, unattended, in CI.
        new ssm.StringParameter(this, 'MessageTableNameParameter', {
            parameterName: messageTableNameParameter(stage),
            stringValue: this.table.tableName,
            description: 'The message-substrate table name producers publish to (plan U5/U6)',
        });

        new ssm.StringParameter(this, 'MessageTableArnParameter', {
            parameterName: messageTableArnParameter(stage),
            stringValue: this.table.tableArn,
            description: 'The message-substrate table ARN producers are granted PutItem on (plan U5/U6)',
        });

        new CfnOutput(this, 'MessageTableName', {
            value: this.table.tableName,
            exportName: `${this.stackName}:MessageTableName`,
        });

        new CfnOutput(this, 'MessageTableStreamArn', {
            // Feature 014 attaches its consumer here. Exported now so the stream's existence is visible to
            // whoever builds that, rather than rediscovered.
            value: this.table.tableStreamArn ?? '',
            exportName: `${this.stackName}:MessageTableStreamArn`,
        });
    }
}
