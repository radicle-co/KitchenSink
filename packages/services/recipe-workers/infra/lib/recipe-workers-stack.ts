import {
    CfnOutput,
    Duration,
    Stack,
    type StackProps,
    aws_cloudwatch as cloudwatch,
    aws_ec2 as ec2,
    aws_events as events,
    aws_events_targets as events_targets,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_lambda_event_sources as lambda_event_sources,
    aws_logs as logs,
    aws_s3 as s3,
    aws_sqs as sqs,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where `npm run build` (esbuild) emits the bundled handlers CDK ships via `Code.fromAsset`. */
const DIST_PATH = path.join(__dirname, '../../dist');

/** FR-007b-i: the backlog must stay under 100 rows under normal operation. */
const BACKLOG_ALARM_THRESHOLD = 100;

export interface RecipeWorkersStackProps extends StackProps {
    readonly stage: string;
    readonly vpcId: string;
    /** The shared lambda SG (already has egress to PostgreSQL) — owned by NetworkStack. */
    readonly lambdaSecurityGroupId: string;
    readonly dbEndpoint: string;
    readonly dbPort: number;
    readonly dbName: string;
    readonly dbUser: string;
    readonly dbInstanceIdentifier: string;
    readonly archiveBucketName: string;
    readonly mediaBucketName: string;
}

/**
 * Recipe workers stack (T132 / FR-007b-i) — the async version-archive path.
 *
 * Three pieces, and the shape is dictated by the outbox design:
 *
 *  1. **`archive-sweeper`**, on a schedule. `recipe-service` does NOT enqueue on save (a save must not
 *     depend on SQS, FR-007b-i), so the `recipe_version_pending_archives` row is the source of truth and
 *     this is the only thing that turns rows into messages.
 *  2. **The queue + DLQ.** The queue is a delivery optimisation, not the record — the row is. A message
 *     lost here costs a tick's latency, not a snapshot.
 *  3. **`version-archive-worker`**, subscribed to the queue: writes the snapshot to S3, then prunes the
 *     version (which cascades its outbox row away — FR-007b-i's "deleted only after a successful S3
 *     confirmation", enforced by the schema).
 *
 * **Both Lambdas are VPC-attached** (ADR-0004): they read the private RDS, and a VPC Lambda has no
 * egress without the NAT — `assignPublicIp` is a Fargate-only lever. These are exactly the DB-bound NAT
 * consumers that ADR documents, so do not "optimise" them out of the VPC.
 *
 * Alarms (T138) fire on the two conditions FR-007b-i names: backlog over 100, and a DLQ that is not
 * empty. They are wired to no SNS action here on purpose — see the alarm comments.
 */
export class RecipeWorkersStack extends Stack {
    public readonly archiveQueue: sqs.Queue;
    public readonly archiveDlq: sqs.Queue;

    public constructor(scope: Construct, id: string, props: RecipeWorkersStackProps) {
        super(scope, id, props);

        if (!existsSync(DIST_PATH)) {
            throw new Error(
                `RecipeWorkersStack: ${DIST_PATH} not found — run \`npm run build\` in packages/services/recipe-workers first.`,
            );
        }

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { vpcId: props.vpcId });
        const lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedLambdaSg',
            props.lambdaSecurityGroupId,
        );
        const archiveBucket = s3.Bucket.fromBucketName(this, 'ImportedArchiveBucket', props.archiveBucketName);
        const mediaBucket = s3.Bucket.fromBucketName(this, 'ImportedMediaBucket', props.mediaBucketName);

        const logGroup = new logs.LogGroup(this, 'RecipeWorkersLogGroup', {
            logGroupName: `/aws/lambda/kitchensink-recipe-workers-${props.stage}`,
            retention: logs.RetentionDays.TWO_WEEKS,
        });

        // ── queue + DLQ ────────────────────────────────────────────────────────────────────────────
        // visibilityTimeout must exceed the worker's timeout, or SQS redelivers a message the worker is
        // still processing and two invocations race the same archive.
        this.archiveDlq = new sqs.Queue(this, 'VersionArchiveDlq', {
            queueName: `kitchensink-recipe-archive-dlq-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14),
            visibilityTimeout: Duration.minutes(2),
        });

        this.archiveQueue = new sqs.Queue(this, 'VersionArchiveQueue', {
            queueName: `kitchensink-recipe-archive-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: Duration.minutes(2),
            deadLetterQueue: { queue: this.archiveDlq, maxReceiveCount: 5 },
        });

        // ── IAM: one least-privilege role per function (ARCH-IT-7) ─────────────────────────────────
        const vpcAccess = iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole');
        const makeRole = (roleId: string, description: string): iam.Role => {
            const role = new iam.Role(this, roleId, {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                description,
                managedPolicies: [vpcAccess],
            });
            logGroup.grantWrite(role);

            return role;
        };

        // RDS-IAM: the recipe_app role is passwordless, so each function mints a short-lived auth token
        // (`@aws-sdk/rds-signer`) instead of reading a password secret. Grant is per-DB-user.
        const rdsConnectArn = Stack.of(this).formatArn({
            service: 'rds-db',
            resource: 'dbuser',
            resourceName: `${props.dbInstanceIdentifier}/${props.dbUser}`,
        });
        const grantRdsIam = (role: iam.Role): void => {
            role.addToPolicy(new iam.PolicyStatement({ actions: ['rds-db:connect'], resources: [rdsConnectArn] }));
        };

        const commonDbEnv: Record<string, string> = {
            RECIPE_DB_HOST: props.dbEndpoint,
            RECIPE_DB_PORT: String(props.dbPort),
            RECIPE_DB_NAME: props.dbName,
            RECIPE_DB_USER: props.dbUser,
        };

        // sweeper: reads the outbox + sends to SQS. No S3, no consume.
        const sweeperRole = makeRole('ArchiveSweeperRole', 'Least-privilege role for the archive sweeper Lambda');
        grantRdsIam(sweeperRole);
        this.archiveQueue.grantSendMessages(sweeperRole);

        // worker: consumes the queue, reads + prunes the version row, writes the archive object. It does
        // NOT send to SQS.
        const workerRole = makeRole('VersionArchiveWorkerRole', 'Least-privilege role for the version-archive Lambda');
        grantRdsIam(workerRole);
        this.archiveQueue.grantConsumeMessages(workerRole);
        archiveBucket.grantPut(workerRole);

        // erasure worker: hard-deletes an owner's rows + media. Needs delete on both buckets.
        const erasureRole = makeRole('AccountErasureWorkerRole', 'Least-privilege role for the account-erasure Lambda');
        grantRdsIam(erasureRole);
        archiveBucket.grantRead(erasureRole);
        archiveBucket.grantDelete(erasureRole);
        mediaBucket.grantRead(erasureRole);
        mediaBucket.grantDelete(erasureRole);

        // ── functions ──────────────────────────────────────────────────────────────────────────────
        const runtime = lambda.Runtime.NODEJS_22_X;
        const architecture = lambda.Architecture.ARM_64;
        const vpcSubnets: ec2.SubnetSelection = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

        const workerFn = new lambda.Function(this, 'VersionArchiveWorkerFunction', {
            runtime,
            architecture,
            // Matches esbuild's outbase:src layout — see esbuild.mjs entryPoints.
            handler: 'handlers/version-archive-worker.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: workerRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 512,
            environment: { ...commonDbEnv, RECIPE_ARCHIVE_BUCKET: props.archiveBucketName },
            logGroup,
        });

        // batchSize 1: a partial-batch failure would otherwise redeliver already-archived versions. They
        // are idempotent (same key, no-op prune), but one-at-a-time keeps the DLQ signal precise — a
        // message in the DLQ is exactly one version that could not be archived.
        workerFn.addEventSource(new lambda_event_sources.SqsEventSource(this.archiveQueue, { batchSize: 1 }));

        const sweeperFn = new lambda.Function(this, 'ArchiveSweeperFunction', {
            runtime,
            architecture,
            handler: 'handlers/archive-sweeper.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: sweeperRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            environment: { ...commonDbEnv, RECIPE_ARCHIVE_QUEUE_URL: this.archiveQueue.queueUrl },
            logGroup,
        });

        // Every minute. The sweep is the archive's ONLY trigger, so the interval is the worst-case delay
        // between a version going over-retention and its snapshot reaching S3. A drained outbox costs one
        // indexed query returning zero rows (idx_pending_archives_status_next), so the tick is cheap.
        new events.Rule(this, 'ArchiveSweepSchedule', {
            ruleName: `kitchensink-recipe-archive-sweep-${props.stage}`,
            schedule: events.Schedule.rate(Duration.minutes(1)),
            targets: [new events_targets.LambdaFunction(sweeperFn)],
        });

        const erasureFn = new lambda.Function(this, 'AccountErasureWorkerFunction', {
            runtime,
            architecture,
            handler: 'handlers/account-erasure-worker.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: erasureRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.minutes(5),
            memorySize: 512,
            environment: {
                ...commonDbEnv,
                RECIPE_ARCHIVE_BUCKET: props.archiveBucketName,
                RECIPE_MEDIA_BUCKET: props.mediaBucketName,
            },
            logGroup,
        });

        // ── alarms (T138 / FR-007b-i) ──────────────────────────────────────────────────────────────
        // "a CloudWatch alarm MUST fire when the backlog exceeds 100 rows for more than 15 minutes".
        // The backlog is a DB row count, which CloudWatch cannot see — so the sweeper emits it as a
        // metric. `claimed` is bounded by the sweep batch size, so this measures "work still due",
        // which is the SLO's intent.
        const backlogMetric = new cloudwatch.Metric({
            namespace: 'Commise/RecipeArchive',
            metricName: 'PendingArchiveBacklog',
            dimensionsMap: { Stage: props.stage },
            statistic: 'Maximum',
            period: Duration.minutes(5),
        });

        new cloudwatch.Alarm(this, 'PendingArchiveBacklogAlarm', {
            alarmName: `kitchensink-recipe-archive-backlog-${props.stage}`,
            alarmDescription:
                'FR-007b-i: pending version-archive backlog above 100 for 15 minutes — S3 archiving is falling behind.',
            metric: backlogMetric,
            threshold: BACKLOG_ALARM_THRESHOLD,
            // 3 x 5-minute periods = the 15-minute sustain the requirement names.
            evaluationPeriods: 3,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // A message in the DLQ means a version exhausted its retries — the loudest signal in this path,
        // because the version row is still un-pruned and the snapshot is still not in S3.
        new cloudwatch.Alarm(this, 'VersionArchiveDlqAlarm', {
            alarmName: `kitchensink-recipe-archive-dlq-${props.stage}`,
            alarmDescription: 'FR-007b-i: a version archive exhausted its retries and landed in the DLQ.',
            metric: this.archiveDlq.metricApproximateNumberOfMessagesVisible({
                period: Duration.minutes(5),
                statistic: 'Maximum',
            }),
            threshold: 0,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        new CfnOutput(this, 'VersionArchiveQueueUrl', { value: this.archiveQueue.queueUrl });
        new CfnOutput(this, 'VersionArchiveDlqUrl', { value: this.archiveDlq.queueUrl });
        new CfnOutput(this, 'VersionArchiveWorkerName', { value: workerFn.functionName });
        new CfnOutput(this, 'ArchiveSweeperName', { value: sweeperFn.functionName });
        new CfnOutput(this, 'AccountErasureWorkerName', { value: erasureFn.functionName });
    }
}
