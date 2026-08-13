import {
    ArnFormat,
    CfnOutput,
    Duration,
    Stack,
    type StackProps,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cloudwatch_actions,
    aws_ec2 as ec2,
    aws_events as events,
    aws_events_targets as events_targets,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_lambda_event_sources as lambda_event_sources,
    aws_logs as logs,
    aws_s3 as s3,
    aws_sns as sns,
    aws_sns_subscriptions as sns_subscriptions,
    aws_sqs as sqs,
    aws_ssm as ssm,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { AcceptedNagFindings, NODE_LAMBDA_RUNTIME, acceptNagFindings } from '@kitchensink/infra-security';
import { recipeDatabaseNameForStage } from '@kitchensink/recipe-core/database-name';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where `npm run build` (esbuild) emits the bundled handlers CDK ships via `Code.fromAsset`. */
const DIST_PATH = path.join(__dirname, '../../dist');

/**
 * The single key root under which ALL recipe media lives, mirroring `ownerMediaPrefix` in
 * `@kitchensink/recipe-core` (`recipes/{ownerId}/...`). Every object-level IAM statement below is scoped to
 * it, so no worker role can reach objects outside the recipe media subtree of the SHARED media bucket.
 *
 * It is the first segment only, not the whole prefix: `ownerId` is per-request and cannot be enumerated at
 * synth time, which is why an object-level wildcard is irreducible here (accepted, with evidence, via
 * `AcceptedNagFindings.ERASURE_WORKER_OBJECT_PREFIX_WILDCARD`).
 */
const RECIPE_OBJECT_ROOT = 'recipes';

/**
 * Grant a role EXACTLY the S3 authority `eraseRecipeObjects` uses, and nothing more.
 *
 * The account-erasure worker and the erasure-orphan sweeper both call that one function
 * (`account-erasure-worker.ts`), so "what S3 authority does an erasure path need" is ONE piece of knowledge
 * and lives here rather than being spelled out per role. Its whole API surface is `ListObjectsV2`
 * (`s3:ListBucket`, bucket-level) and `DeleteObjects` (`s3:DeleteObject`, object-level).
 *
 * Replaces `bucket.grantRead()` + `bucket.grantDelete()`, which expanded to `s3:GetObject*`,
 * `s3:GetBucket*`, `s3:List*` and `s3:DeleteObject*` — five `AwsSolutions-IAM5` wildcards, and a
 * read-everything grant on buckets holding every owner's photos and version archives, handed to the most
 * destructive path in the system. It lists and deletes; it never reads an object body.
 *
 * ⚠️ `s3:DeleteObjectVersion` is deliberately NOT granted: the handler never passes a `VersionId`, so it has
 * no use for it today. Both buckets are versioned, so a plain delete leaves a delete marker rather than
 * erasing prior versions — a pre-existing erasure-completeness gap recorded in ADR-0013, which this
 * narrowing neither creates nor hides. Whoever closes that gap adds the action here deliberately, and until
 * then gets an explicit `AccessDenied` rather than a silently-incomplete erasure.
 *
 * @param role - The worker role to grant.
 * @param buckets - The buckets it sweeps.
 * @sideEffect Adds IAM policy statements to `role`, and records the accepted IAM5 finding on it.
 */
function grantRecipeObjectErasure(role: iam.Role, buckets: readonly s3.IBucket[]): void {
    role.addToPolicy(
        new iam.PolicyStatement({
            actions: ['s3:ListBucket'],
            resources: buckets.map((bucket) => bucket.bucketArn),
        }),
    );
    role.addToPolicy(
        new iam.PolicyStatement({
            actions: ['s3:DeleteObject'],
            resources: buckets.map((bucket) => bucket.arnForObjects(`${RECIPE_OBJECT_ROOT}/*`)),
        }),
    );
    // The object-key wildcard that remains is irreducible (ownerId is per-request). Accepted WITH the
    // evidence above; `applyToChildren` is required because IAM5 lands on `<Role>/DefaultPolicy/Resource`.
    acceptNagFindings(role, AcceptedNagFindings.ERASURE_WORKER_OBJECT_PREFIX_WILDCARD, { applyToChildren: true });
}

/** FR-007b-i: the backlog must stay under 100 rows under normal operation. */
const BACKLOG_ALARM_THRESHOLD = 100;

/**
 * Age at which the oldest un-archived version-outbox row pages someone.
 *
 * FR-007b-i names TWO archive alarm conditions, not one: the backlog over 100 (above) AND "the oldest
 * pending row is older than 1 hour". This is the second — the same 3600s bound as the erasure path's age
 * alarm, and for the same reason: an archive row that has sat un-drained for an hour is stuck, not busy
 * (the sweep runs every minute), so it is a signal a human must see. Without it a single row can age past
 * the SLA while the count stays comfortably under 100 and nothing fires.
 */
const ARCHIVE_AGE_ALARM_THRESHOLD_SECONDS = 3600;

/**
 * CloudWatch namespace + metric name the archive sweeper emits and the age alarm watches. Mirror the
 * literals `archive-sweeper.ts` publishes (`Commise/RecipeArchive` / `OldestPendingArchiveAgeSeconds`) —
 * the same knowledge on either side of the Lambda boundary, so an alarm whose namespace or name disagrees
 * with the emitter watches a metric nobody writes.
 */
const ARCHIVE_METRIC_NAMESPACE = 'Commise/RecipeArchive';
const OLDEST_PENDING_ARCHIVE_AGE_METRIC_NAME = 'OldestPendingArchiveAgeSeconds';

/**
 * How long the erasure worker may run. Named because the erasure QUEUE is sized off it: SQS must not
 * redeliver a message while the first worker is still erasing that owner.
 */
const ERASURE_WORKER_TIMEOUT = Duration.minutes(5);

/**
 * The erasure queue's visibility timeout — strictly greater than {@link ERASURE_WORKER_TIMEOUT}.
 *
 * The archive pair's 2 minutes CANNOT be copied here: the erasure worker's timeout is 5 minutes, not the
 * archive worker's 60 seconds, so 2 minutes would have SQS redeliver mid-erasure and put two workers on
 * one owner — contending `DELETE FROM recipes` transactions, a duplicated S3 prefix sweep, and
 * double-counted `attempts` (which is the give-up evidence, so inflating it would abandon jobs early).
 *
 * One minute of headroom is enough and is deliberately not more: a Lambda invocation cannot exceed its
 * configured timeout, so the margin only has to absorb the event-source poller's dispatch overhead, which
 * is seconds. Padding it to 2x would stretch a permanently-failing erasure's trip to the DLQ (and its
 * alarm) from ~30 minutes to ~50 for no safety gain.
 */
const ERASURE_QUEUE_VISIBILITY_TIMEOUT = Duration.minutes(6);

/**
 * Age at which the oldest outstanding erasure job pages someone.
 *
 * NOT the archive's "backlog over 100": there will never be 100 concurrent erasures, so a count threshold
 * would sit unfirable forever — the same never-fires class of bug as measuring a batch-capped backlog.
 * ONE erasure stuck for an hour is already a compliance incident, and age is the metric that says so.
 * An hour is chosen as the operational bound, well inside GDPR's month, because an erasure that has not
 * completed in an hour is broken rather than busy — the happy path takes seconds.
 */
const ERASURE_AGE_ALARM_THRESHOLD_SECONDS = 3600;

/**
 * CloudWatch namespace the erasure age metric is published under. Mirrors the literal the erasure sweeper
 * emits (`erasure-sweeper.ts`) — the two are the same knowledge on either side of the Lambda boundary, and
 * an alarm whose namespace disagrees with the emitter watches a metric nobody writes.
 */
const ERASURE_METRIC_NAMESPACE = 'Commise/RecipeErasure';

/**
 * Metric name the erasure-orphan sweeper emits and the resurrection-caught alarm watches. Mirrors the
 * literal `erasure-orphan-sweeper.ts` publishes (`ORPHAN_METRIC_NAME`) — the same knowledge on either
 * side of the Lambda boundary, so an alarm whose name disagrees with the emitter watches a dead metric.
 */
const ORPHAN_METRIC_NAME = 'ErasureOrphansDeleted';

export interface RecipeWorkersStackProps extends StackProps {
    readonly stage: string;
    /**
     * The persistent platform stage this deploy rides (ADR-0006) — `prod` for prod, `sandbox` for every
     * ephemeral stage. Required, because it is what distinguishes "this deploy OWNS the shared database"
     * from "this deploy gets an isolated per-stage one".
     */
    readonly baseStage: string;
    readonly vpcId: string;
    /** The shared lambda SG (already has egress to PostgreSQL) — owned by NetworkStack. */
    readonly lambdaSecurityGroupId: string;
    readonly dbEndpoint: string;
    readonly dbPort: number;
    /**
     * The BASE logical database name — i.e. the platform's `kitchensink-data-{baseStage}:RecipeDatabaseName`
     * export value, NOT the name these Lambdas connect to. The per-stage name is derived from it inside the
     * stack via {@link recipeDatabaseNameForStage}, exactly as `RecipeServiceStack` does.
     *
     * This prop is deliberately the base name rather than the final one (#119). When the workers' CDK app
     * took the final name from `RECIPE_DB_NAME` with a `?? 'kitchensink_recipes'` fallback, a CI step that
     * simply did not pass the variable produced six Lambdas silently pointed at the SHARED database while
     * the API used the preview's own — including three destructive scheduled sweepers. Deriving here means
     * a preview cannot target the shared database without `stage === baseStage` actually being true.
     */
    readonly dbBaseName: string;
    readonly dbUser: string;
    /**
     * The RDS **DbiResourceId** (`db-XXXX…`), NOT the instance name — `rds-db:connect` ARNs are keyed on
     * the immutable resource id. CI resolves it from `kitchensink-data-{baseStage}:DatabaseResourceId`.
     */
    readonly dbInstanceIdentifier: string;
    readonly archiveBucketName: string;
    readonly mediaBucketName: string;
    /** ARN of the global handle-sync SNS topic (W8-a.2) this deployment subscribes its OWN queue to. */
    readonly handleSyncTopicArn: string;
    /**
     * CloudFront distribution id, so the account-erasure worker can invalidate an erased owner's media
     * prefix (HAZ-051/067/039). OPTIONAL — no `Distribution` construct exists in this repo's CDK; when
     * absent the worker's CDN adapter degrades to a logged no-op rather than failing erasure.
     */
    readonly cloudfrontDistributionId?: string;
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
 * Alarms (T138) fire on the conditions FR-007b-i names: backlog over 100, the oldest pending row older
 * than an hour, and a DLQ that is not empty — plus the erasure and orphan-resurrection signals. EVERY
 * alarm routes to a single per-stage SNS topic (`alarmTopic`); an alarm with no action satisfies
 * "MUST fire" on paper while paging nobody, which is how the archive path's age condition was missed
 * entirely (QE-001). Ops subscribes the topic per stage out of band, exactly as the identity and food
 * service stacks do.
 */
export class RecipeWorkersStack extends Stack {
    public readonly archiveQueue: sqs.Queue;
    public readonly archiveDlq: sqs.Queue;
    public readonly erasureQueue: sqs.Queue;
    public readonly erasureDlq: sqs.Queue;
    public readonly handleSyncQueue: sqs.Queue;
    public readonly handleSyncDlq: sqs.Queue;

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
            enforceSSL: true,
            queueName: `kitchensink-recipe-archive-dlq-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14),
            visibilityTimeout: Duration.minutes(2),
        });

        this.archiveQueue = new sqs.Queue(this, 'VersionArchiveQueue', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-archive-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: Duration.minutes(2),
            deadLetterQueue: { queue: this.archiveDlq, maxReceiveCount: 5 },
        });

        // ── account-erasure queue + DLQ (T136b / C-007 / D7) ───────────────────────────────────────
        // Per-STAGE, never shared with the base stage. A pr-{N} workers deploy points its Lambdas at the
        // pr-{N} logical database (ADR-0006), so a sandbox erasure message drained by a pr-{N} worker
        // would find no job row for that owner and — because the worker erases unconditionally — delete
        // that owner's rows out of the WRONG database while the real sandbox job stayed queued.
        this.erasureDlq = new sqs.Queue(this, 'AccountErasureDlq', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-account-erasure-dlq-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            // 14 days, as with the archive DLQ: a message here is a right-to-erasure request that failed
            // permanently, so it must survive a long weekend for an operator to redrive.
            retentionPeriod: Duration.days(14),
            visibilityTimeout: ERASURE_QUEUE_VISIBILITY_TIMEOUT,
        });

        this.erasureQueue = new sqs.Queue(this, 'AccountErasureQueue', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-account-erasure-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: ERASURE_QUEUE_VISIBILITY_TIMEOUT,
            // maxReceiveCount 5 ties to the sweeper's ERASURE_GIVE_UP_ATTEMPTS (10): one message yields at
            // most 5 claims before the DLQ alarm fires, so a job is only ever abandoned to `failed` after
            // two full DLQ cycles — i.e. never before a human has been paged.
            deadLetterQueue: { queue: this.erasureDlq, maxReceiveCount: 5 },
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
        //
        // ⚠️ `arnFormat: COLON_RESOURCE_NAME` IS THE FIX FOR #121 — DO NOT DROP IT. `Stack.formatArn`
        // defaults to `ArnFormat.SLASH_RESOURCE_NAME`, which emits `…:dbuser/{resourceId}/{dbUser}`. That
        // ARN matches no real resource, so `rds-db:connect` is implicitly DENIED — and RDS surfaces the
        // denial as `PAM authentication failed for user "recipe_app"` (SQLSTATE 28000) thrown before any
        // query runs, which reads like a credentials problem rather than an IAM one. Measured consequence:
        // every invocation of all six workers failed 100% of the time on the live pr-73 preview (540/540
        // archive sweeps in three hours), so version archive, GDPR erasure and orphan reconciliation had
        // never once run in a preview. The required shape is COLON-separated, which is precisely what CDK's
        // own `IDatabaseInstance.grantConnect` builds — and why the recipe API task and the in-VPC
        // migration Lambda (both granted through `grantConnect`) authenticate fine as this same role from
        // these same subnets. The delta was never Lambda-vs-Fargate; it was one separator.
        const rdsConnectArn = Stack.of(this).formatArn({
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            service: 'rds-db',
            resource: 'dbuser',
            resourceName: `${props.dbInstanceIdentifier}/${props.dbUser}`,
        });
        const grantRdsIam = (role: iam.Role): void => {
            role.addToPolicy(new iam.PolicyStatement({ actions: ['rds-db:connect'], resources: [rdsConnectArn] }));
        };

        // ONE derivation, shared with `RecipeServiceStack` via `@kitchensink/recipe-core` (#119). Both
        // stacks call this same function with the same (stage, baseStage), so a preview's Lambdas and its
        // API cannot disagree about which logical database they are talking to — the divergence that put
        // three destructive scheduled sweepers on the SHARED database. Pinned by the cross-stack parity
        // test in `packages/services/recipe-service/infra/__tests__/recipe-database-name-parity.test.ts`.
        const dbName = recipeDatabaseNameForStage(props.stage, props.baseStage, props.dbBaseName);

        const commonDbEnv: Record<string, string> = {
            RECIPE_DB_HOST: props.dbEndpoint,
            RECIPE_DB_PORT: String(props.dbPort),
            RECIPE_DB_NAME: dbName,
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
        // `grantPut` expands to s3:PutObject + PutObjectLegalHold/Retention/Tagging/VersionTagging AND
        // s3:Abort* (AwsSolutions-IAM5). The handler issues exactly one S3 call, `PutObjectCommand` (see
        // version-archive-worker.ts), with no tagging, no object lock and no multipart upload -- so every one
        // of those extra actions is unused authority on the bucket that holds version snapshots.
        workerRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['s3:PutObject'],
                resources: [archiveBucket.arnForObjects(`${RECIPE_OBJECT_ROOT}/*`)],
            }),
        );
        // The `recipes/*` object wildcard that remains is irreducible for the same reason as the erasure
        // roles: the snapshot key embeds a per-request ownerId. Accepted narrowly (regex-scoped to
        // `.../recipes/*`), so a future unscoped grant on this role would still report.
        acceptNagFindings(workerRole, AcceptedNagFindings.ERASURE_WORKER_OBJECT_PREFIX_WILDCARD, {
            applyToChildren: true,
        });

        // erasure worker: hard-deletes an owner's rows + media. Needs delete on both buckets, and consume
        // (never send) on the erasure queue — ARCH-IT-7, so a bug in the most destructive path in the
        // system cannot fan out erasure work; the sweeper and the recipe API are the only producers.
        const erasureRole = makeRole('AccountErasureWorkerRole', 'Least-privilege role for the account-erasure Lambda');
        grantRdsIam(erasureRole);
        // The exact S3 API surface of `eraseRecipeObjects` (account-erasure-worker.ts, also reused by the
        // orphan sweeper) is TWO calls: `ListObjectsV2` (IAM `s3:ListBucket`, a bucket-level action) and
        // `DeleteObjects` (IAM `s3:DeleteObject`). Nothing else.
        //
        // `grantRead` + `grantDelete` handed over far more (AwsSolutions-IAM5 flagged five wildcards on this
        // one role): s3:GetObject*, s3:GetBucket*, s3:List* and s3:DeleteObject*. GetObject is authority the
        // most destructive path in the system has no use for -- it lists and deletes, it never reads a body --
        // and on buckets holding every owner's photos and version archives that is a real read-everything
        // grant. So the actions are spelled out, and the object-level resource is scoped to the authoritative
        // `recipes/` key root (@kitchensink/recipe-core recipeObjectKeys), which also means these roles cannot
        // reach objects OUTSIDE the recipe media subtree in the shared media bucket.
        //
        // ⚠️ Deliberately NOT granted: s3:DeleteObjectVersion. The handler never passes a VersionId, so it
        // does not have it today. Both buckets are versioned, so a delete leaves a delete marker rather than
        // erasing prior versions -- a pre-existing erasure-completeness gap recorded in ADR-0013, NOT
        // something this narrowing introduces. Whoever closes that gap must add the action here deliberately,
        // and will get an explicit AccessDenied rather than a silently-incomplete erasure.
        grantRecipeObjectErasure(erasureRole, [archiveBucket, mediaBucket]);
        this.erasureQueue.grantConsumeMessages(erasureRole);

        // HAZ-051/067/039: least-privilege grant for the CDN-invalidation call, scoped to the ONE
        // configured distribution — never a wildcard resource. No-op (no grant added) when
        // `cloudfrontDistributionId` is unset, matching the worker's own CDN adapter degrading to a no-op
        // in that case; there is nothing to scope a grant to.
        if (props.cloudfrontDistributionId !== undefined) {
            erasureRole.addToPolicy(
                new iam.PolicyStatement({
                    actions: ['cloudfront:CreateInvalidation'],
                    resources: [`arn:aws:cloudfront::${this.account}:distribution/${props.cloudfrontDistributionId}`],
                }),
            );
        }

        // erasure sweeper: reads `account_erasure_jobs`, re-sends stale jobs, and writes the `failed`
        // give-up transition. Sends to SQS but must NOT consume (ARCH-IT-7) and touches no bucket — the
        // give-up is a row update, and the destructive work stays the worker's alone.
        const erasureSweeperRole = makeRole(
            'ErasureSweeperRole',
            'Least-privilege role for the account-erasure sweeper Lambda',
        );
        grantRdsIam(erasureSweeperRole);
        this.erasureQueue.grantSendMessages(erasureSweeperRole);

        // erasure-orphan sweeper: the resurrection backstop across BOTH object buckets. Reads
        // `account_erasure_jobs` for recently-COMPLETED owners and deletes any object a late write orphaned
        // under their prefix — a version-archive PUT in the ARCHIVE bucket, or a photo-upload presigned PUT
        // in the MEDIA bucket (a presigned URL minted just before erasure can be redeemed after the worker's
        // synchronous media sweep). Least-privilege (ARCH-IT-7): List + Delete on BOTH buckets — never
        // GetObject (it lists and deletes, it does not read bodies), and never any SQS (it neither produces
        // nor consumes).
        const orphanSweeperRole = makeRole(
            'ErasureOrphanSweeperRole',
            'Least-privilege role for the erasure-orphan (resurrection backstop) sweeper Lambda',
        );
        grantRdsIam(orphanSweeperRole);
        // Same S3 surface as the erasure worker, because it literally runs the same `eraseRecipeObjects`
        // function -- so it gets the same grant from the same place rather than a second, drifting spelling.
        // (This role already granted `s3:ListBucket` explicitly for the right reason; what it still had was
        // `grantDelete`, whose `s3:DeleteObject*` wildcard and bucket-wide object ARN it does not need.)
        grantRecipeObjectErasure(orphanSweeperRole, [archiveBucket, mediaBucket]);

        // ── functions ──────────────────────────────────────────────────────────────────────────────
        const runtime = NODE_LAMBDA_RUNTIME;
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
            // STAGE is REQUIRED, not optional: archive-sweeper.ts publishes the PendingArchiveBacklog
            // metric under `Stage=process.env['STAGE'] ?? 'unknown'`, and the T138 backlog alarm below
            // watches the `Stage=props.stage` dimension. Omitting STAGE here (the original T132 bug) made
            // the sweeper publish under `unknown` while the alarm watched `{stage}`, so the FR-007b-i
            // backlog alarm — a spec MUST — sat in INSUFFICIENT_DATA forever and could never fire. Set it
            // here (not in commonDbEnv) because only the sweeper needs it; the backlog alarm's dimension
            // MUST equal this value. Pinned by the "sets STAGE on the archive sweeper" synth test.
            environment: { ...commonDbEnv, RECIPE_ARCHIVE_QUEUE_URL: this.archiveQueue.queueUrl, STAGE: props.stage },
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

        // HAZ-051/067/039: CLOUDFRONT_DISTRIBUTION_ID is OPTIONAL passthrough (mirrors recipe-service's
        // own optional `cloudfrontDistributionId` prop) — omitted entirely rather than set to an empty
        // string when absent, so the worker's CDN adapter sees an actually-unset value and degrades to
        // its documented no-op instead of being handed a blank id to (mis)interpret.
        const erasureEnvironment: Record<string, string> = {
            ...commonDbEnv,
            RECIPE_ARCHIVE_BUCKET: props.archiveBucketName,
            RECIPE_MEDIA_BUCKET: props.mediaBucketName,
        };

        if (props.cloudfrontDistributionId !== undefined) {
            erasureEnvironment['CLOUDFRONT_DISTRIBUTION_ID'] = props.cloudfrontDistributionId;
        }

        const erasureFn = new lambda.Function(this, 'AccountErasureWorkerFunction', {
            runtime,
            architecture,
            handler: 'handlers/account-erasure-worker.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: erasureRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            // The named constant, not a bare `Duration.minutes(5)`: the erasure queue's visibility timeout
            // is derived from it (ERASURE_QUEUE_VISIBILITY_TIMEOUT), so tying the function to the same
            // symbol makes raising one without the other a compile-adjacent mistake rather than a silent
            // mid-erasure redelivery in production.
            timeout: ERASURE_WORKER_TIMEOUT,
            memorySize: 512,
            environment: erasureEnvironment,
            logGroup,
        });

        // batchSize 1: one message is one LEGAL erasure request, so a DLQ message must map to exactly one
        // owner's failed erasure. The worker also processes records serially and rethrows on the first
        // failure, so a larger batch would leave later records unattempted and could blow the 5-minute
        // timeout outright.
        erasureFn.addEventSource(new lambda_event_sources.SqsEventSource(this.erasureQueue, { batchSize: 1 }));

        // ── handle-sync: per-stack SQS queue subscribed to the GLOBAL topic + its consumer (W8-a.2) ──────
        // Each deployment subscribes its OWN queue (SNS fan-out), so a rename reaches EVERY preview/base
        // consumer — one shared queue would deliver each rename to exactly one of N previews, leaving the
        // rest stale. The queue is tagged with the stack's Environment (pr-{N} queues are swept on close;
        // prod/sandbox-baseline are global). Subscription is NOT raw-delivery — the worker unwraps the SNS
        // envelope. SQS-managed SSE bounds the display-name PII at rest (the topic is a transient pass-through).
        this.handleSyncDlq = new sqs.Queue(this, 'HandleSyncDlq', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-handle-sync-dlq-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14),
            visibilityTimeout: Duration.seconds(60),
        });
        this.handleSyncQueue = new sqs.Queue(this, 'HandleSyncQueue', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-handle-sync-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: Duration.seconds(60),
            deadLetterQueue: { queue: this.handleSyncDlq, maxReceiveCount: 5 },
        });

        const handleSyncTopic = sns.Topic.fromTopicArn(this, 'ImportedHandleSyncTopic', props.handleSyncTopicArn);
        handleSyncTopic.addSubscription(new sns_subscriptions.SqsSubscription(this.handleSyncQueue));

        const handleSyncRole = makeRole('HandleSyncWorkerRole', 'Least-privilege role for the handle-sync Lambda');
        grantRdsIam(handleSyncRole);
        this.handleSyncQueue.grantConsumeMessages(handleSyncRole);

        const handleSyncFn = new lambda.Function(this, 'HandleSyncWorkerFunction', {
            runtime,
            architecture,
            handler: 'handlers/handle-sync-worker.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: handleSyncRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            environment: { ...commonDbEnv },
            logGroup,
        });
        // Partial-batch responses: the handler returns batchItemFailures, so SQS retries only failed renames.
        handleSyncFn.addEventSource(
            new lambda_event_sources.SqsEventSource(this.handleSyncQueue, {
                batchSize: 10,
                reportBatchItemFailures: true,
            }),
        );

        // The erasure durability backstop. `ErasureService` enqueues eagerly on request, so this sweep is
        // NOT the latency path — it is what recovers a job whose send failed (SQS outage), whose message
        // was lost, or whose worker died. STAGE is set here (and NOT in commonDbEnv) because only the
        // sweeper emits the age metric, and its EMF dimension must equal the alarm's `Stage` below.
        const erasureSweeperFn = new lambda.Function(this, 'ErasureSweeperFunction', {
            runtime,
            architecture,
            handler: 'handlers/erasure-sweeper.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: erasureSweeperRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            environment: {
                ...commonDbEnv,
                ACCOUNT_ERASURE_QUEUE_URL: this.erasureQueue.queueUrl,
                STAGE: props.stage,
            },
            logGroup,
        });

        // Every 5 minutes, not the archive's 1: the eager send makes this the durability path, not the
        // latency path, and the staleness window the sweeper re-dispatches on (15 minutes) is far wider
        // than the tick. Five minutes keeps the age metric fresh for the hour-threshold alarm without
        // polling `account_erasure_jobs` every minute for work that is almost always absent.
        new events.Rule(this, 'ErasureSweepSchedule', {
            ruleName: `kitchensink-recipe-erasure-sweep-${props.stage}`,
            schedule: events.Schedule.rate(Duration.minutes(5)),
            targets: [new events_targets.LambdaFunction(erasureSweeperFn)],
        });

        // The resurrection backstop. Reconciles BOTH object buckets against recently-completed erasure
        // owners; STAGE is set here (NOT commonDbEnv) because only this sweeper emits the orphans-deleted
        // metric, and its EMF `Stage` dimension must equal the alarm's below.
        const orphanSweeperFn = new lambda.Function(this, 'ErasureOrphanSweeperFunction', {
            runtime,
            architecture,
            handler: 'handlers/erasure-orphan-sweeper.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: orphanSweeperRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            environment: {
                ...commonDbEnv,
                RECIPE_ARCHIVE_BUCKET: props.archiveBucketName,
                RECIPE_MEDIA_BUCKET: props.mediaBucketName,
                STAGE: props.stage,
            },
            logGroup,
        });

        // Hourly, not the archive sweeper's every-minute: this is a backstop-of-a-backstop for a
        // sub-millisecond, already-rare race (the version-archive guard narrows it first), not a latency
        // path. An orphan can only appear within one archive-worker invocation (≤60s) of an erasure's
        // sweep and never later, and the 24h look-back re-sweeps every completed owner across ~24 ticks —
        // so an hour between ticks still catches a PUT that landed just after the previous listing, while
        // an almost-always-empty tick stays cheap. See erasure-orphan-sweeper.ts for the full arithmetic.
        new events.Rule(this, 'ErasureOrphanSweepSchedule', {
            ruleName: `kitchensink-recipe-erasure-orphan-sweep-${props.stage}`,
            schedule: events.Schedule.rate(Duration.hours(1)),
            targets: [new events_targets.LambdaFunction(orphanSweeperFn)],
        });

        // ── alarms (T138 / FR-007b-i) ──────────────────────────────────────────────────────────────
        // ONE per-stage topic for the whole stack (QE-001 fix). Every alarm below routes to it via
        // `addAlarmAction` — an alarm with no action satisfies FR-007b-i's "MUST fire" on paper while
        // paging nobody, which is exactly how the archive age condition went missing. One topic, not
        // per-severity: it mirrors the identity and food service stacks (each owns a single alarm topic),
        // and per-severity fan-out is speculative routing nobody has asked for (YAGNI) — a subscriber that
        // wants severity routing filters on the alarm name at the subscription. No subscription is wired
        // here; ops subscribes per stage out of band, as those stacks document. There is deliberately NO
        // shared/global alerts topic to import: the only account-level SNS is cost-guardrails' billing
        // topic (a different concern, prod-guarded, unexported), so a per-stack topic is the right seam.
        // Named implicitly (displayName only) like the sibling stacks — CloudFormation derives a physical
        // name from the `kitchensink-recipe-workers-{stage}` stack, so a pr-{N} deploy's topic still
        // carries the pr-{N} stack name and is caught by the ADR-0005 tag/name cleanup.
        const alarmTopic = new sns.Topic(this, 'RecipeWorkersAlarmTopic', {
            enforceSSL: true,
            displayName: `Recipe workers alarms (${props.stage})`,
        });
        const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);

        // "a CloudWatch alarm MUST fire when the backlog exceeds 100 rows for more than 15 minutes".
        // The backlog is a DB row count, which CloudWatch cannot see — so the sweeper emits it as a
        // metric. `claimed` is bounded by the sweep batch size, so this measures "work still due",
        // which is the SLO's intent.
        const backlogMetric = new cloudwatch.Metric({
            namespace: ARCHIVE_METRIC_NAMESPACE,
            metricName: 'PendingArchiveBacklog',
            dimensionsMap: { Stage: props.stage },
            statistic: 'Maximum',
            period: Duration.minutes(5),
        });

        const backlogAlarm = new cloudwatch.Alarm(this, 'PendingArchiveBacklogAlarm', {
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
        backlogAlarm.addAlarmAction(alarmAction);

        // The SECOND half of FR-007b-i, and the gap QE-001 found: "and again when the oldest pending row is
        // older than 1 hour". A single row can age past the SLA while the backlog stays well under 100, so
        // the count alarm above cannot cover it — this one watches the age the sweeper emits every tick (0
        // when drained, so it never flaps into INSUFFICIENT_DATA). The `Stage` dimension MUST equal the
        // sweeper's STAGE env, or the alarm watches a metric nobody publishes; the "sets STAGE on the
        // archive sweeper" synth test pins that. One evaluation period: an hour-old row is already stuck.
        const oldestPendingAgeAlarm = new cloudwatch.Alarm(this, 'OldestPendingArchiveAgeAlarm', {
            alarmName: `kitchensink-recipe-archive-age-${props.stage}`,
            alarmDescription:
                'FR-007b-i: the oldest pending version-archive row has been outstanding for over an hour — the sweep runs every minute, so this row is stuck, not busy.',
            metric: new cloudwatch.Metric({
                namespace: ARCHIVE_METRIC_NAMESPACE,
                metricName: OLDEST_PENDING_ARCHIVE_AGE_METRIC_NAME,
                dimensionsMap: { Stage: props.stage },
                statistic: 'Maximum',
                period: Duration.minutes(5),
            }),
            threshold: ARCHIVE_AGE_ALARM_THRESHOLD_SECONDS,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        oldestPendingAgeAlarm.addAlarmAction(alarmAction);

        // A message in the DLQ means a version exhausted its retries — the loudest signal in this path,
        // because the version row is still un-pruned and the snapshot is still not in S3.
        const archiveDlqAlarm = new cloudwatch.Alarm(this, 'VersionArchiveDlqAlarm', {
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
        archiveDlqAlarm.addAlarmAction(alarmAction);

        // ── erasure alarms (T136b / T138) ──────────────────────────────────────────────────────────
        // AGE, not count: erasure will never have 100 concurrent jobs, so a >100 count threshold (the
        // archive path's shape) would sit unfirable forever — the never-fires class of bug. ONE erasure
        // stuck past an hour is already a compliance incident, and age is the metric that says so. The
        // sweeper emits `OldestErasureJobAgeSeconds` via EMF every tick (0 when idle), so the alarm always
        // has data instead of flapping into INSUFFICIENT_DATA the moment things recover. The `Stage`
        // dimension MUST match the sweeper's STAGE env, or this alarm watches a metric nobody publishes.
        const erasureAgeAlarm = new cloudwatch.Alarm(this, 'OldestErasureJobAgeAlarm', {
            alarmName: `kitchensink-recipe-erasure-age-${props.stage}`,
            alarmDescription:
                'A right-to-erasure job has been outstanding for over an hour — the happy path takes seconds, so this is broken, not busy.',
            metric: new cloudwatch.Metric({
                namespace: ERASURE_METRIC_NAMESPACE,
                metricName: 'OldestErasureJobAgeSeconds',
                dimensionsMap: { Stage: props.stage },
                statistic: 'Maximum',
                period: Duration.minutes(5),
            }),
            threshold: ERASURE_AGE_ALARM_THRESHOLD_SECONDS,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        erasureAgeAlarm.addAlarmAction(alarmAction);

        // A message in the erasure DLQ means a right-to-erasure request exhausted its retries — a
        // compliance incident, not a backlog. The sweeper only ever writes `failed` after a job has burned
        // TWICE this many receives, so a `failed` job always has this alarm (and a paged human) behind it.
        const erasureDlqAlarm = new cloudwatch.Alarm(this, 'AccountErasureDlqAlarm', {
            alarmName: `kitchensink-recipe-account-erasure-dlq-${props.stage}`,
            alarmDescription: 'A right-to-erasure request exhausted its retries and landed in the erasure DLQ.',
            metric: this.erasureDlq.metricApproximateNumberOfMessagesVisible({
                period: Duration.minutes(5),
                statistic: 'Maximum',
            }),
            threshold: 0,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        erasureDlqAlarm.addAlarmAction(alarmAction);

        // A NONZERO orphans-deleted count means the archive-resurrection race actually fired: a snapshot
        // was materialised under an already-erased owner and this backstop deleted it. That is a
        // right-to-erasure gap that closed itself — rare, and worth knowing every time it happens. The
        // sweeper emits the metric every tick (0 when clean) so this alarm has data instead of flapping
        // into INSUFFICIENT_DATA; the `Stage` dimension MUST match the sweeper's STAGE env above. Sum
        // (not Maximum) over the period, so several orphans caught across a window are not under-counted.
        const orphanAlarm = new cloudwatch.Alarm(this, 'ArchiveOrphansDeletedAlarm', {
            alarmName: `kitchensink-recipe-erasure-orphan-${props.stage}`,
            alarmDescription:
                'The archive-resurrection backstop deleted an archive object under an erased owner — the sub-ms race between version-archive and account-erasure actually fired.',
            metric: new cloudwatch.Metric({
                namespace: ERASURE_METRIC_NAMESPACE,
                metricName: ORPHAN_METRIC_NAME,
                dimensionsMap: { Stage: props.stage },
                statistic: 'Sum',
                period: Duration.minutes(5),
            }),
            threshold: 0,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        orphanAlarm.addAlarmAction(alarmAction);

        // ── cross-stack hand-off: erasure queue → recipe-service (T136b) ───────────────────────────
        // recipe-service's ErasureService REQUIRES ACCOUNT_ERASURE_QUEUE_URL and refuses to boot without
        // it. It reads the URL (and the ARN, to scope its sqs:SendMessage grant) from these per-STAGE SSM
        // parameters rather than a CfnOutput export.
        //
        // This is NOT a `CfnOutput`/`Fn.importValue` export ON PURPOSE. An imported export is LOCKED for as
        // long as the importer references it, and the ADR-0005 PR-close cleanup deletes a PR's stacks with
        // NO ordering guarantee — delete workers before service and CloudFormation refuses with the
        // export-in-use deadlock ADR-0002 documents, unattended, in CI. An SSM parameter carries the same
        // value with no such lock: either stack deletes in any order, and a missing parameter still fails
        // the consumer's deploy loudly rather than degrading silently. Per-stage names (never baseStage) so
        // a pr-{N} service enqueues onto its OWN queue, never the shared sandbox one (ADR-0006).
        new ssm.StringParameter(this, 'AccountErasureQueueUrlParam', {
            parameterName: `/kitchensink/${props.stage}/recipe/account-erasure-queue-url`,
            stringValue: this.erasureQueue.queueUrl,
        });
        new ssm.StringParameter(this, 'AccountErasureQueueArnParam', {
            parameterName: `/kitchensink/${props.stage}/recipe/account-erasure-queue-arn`,
            stringValue: this.erasureQueue.queueArn,
        });

        new CfnOutput(this, 'VersionArchiveQueueUrl', { value: this.archiveQueue.queueUrl });
        new CfnOutput(this, 'VersionArchiveDlqUrl', { value: this.archiveDlq.queueUrl });
        new CfnOutput(this, 'VersionArchiveWorkerName', { value: workerFn.functionName });
        new CfnOutput(this, 'ArchiveSweeperName', { value: sweeperFn.functionName });
        new CfnOutput(this, 'AccountErasureWorkerName', { value: erasureFn.functionName });
        // Diagnostic outputs only — deliberately NO `exportName`, so nothing can `Fn.importValue` them and
        // reintroduce the cross-stack lock the SSM hand-off above exists to avoid.
        new CfnOutput(this, 'AccountErasureQueueUrl', { value: this.erasureQueue.queueUrl });
        new CfnOutput(this, 'AccountErasureDlqUrl', { value: this.erasureDlq.queueUrl });
        new CfnOutput(this, 'ErasureSweeperName', { value: erasureSweeperFn.functionName });
        new CfnOutput(this, 'ErasureOrphanSweeperName', { value: orphanSweeperFn.functionName });
    }
}
