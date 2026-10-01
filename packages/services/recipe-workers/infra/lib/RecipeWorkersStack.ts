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
    aws_rds as rds,
    aws_lambda as lambda,
    aws_lambda_event_sources as lambda_event_sources,
    aws_logs as logs,
    aws_logs_destinations as logsDestinations,
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

import {
    AcceptedNagFindings,
    NODE_LAMBDA_RUNTIME,
    acceptNagFindings,
    subscribeAlarmEmail,
} from '@radicle-co/infra-shared/security';
import { recipeDatabaseNameParameter } from '@radicle-co/infra-shared/database';
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import { consumerConcurrencyFor } from './consumerConcurrency.js';
import {
    BEDROCK_MODEL_REGISTRY,
    DEFAULT_MONTHLY_CEILING_MICROS,
    NOVA_MICRO_MODEL_ID,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';

import { bedrockInvokeStatements } from './bedrockInvokePolicy.js';

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
 * (`accountErasureWorker.ts`), so "what S3 authority does an erasure path need" is ONE piece of knowledge
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
 * ⛔ The LIST grant is conditioned on `s3:prefix`, because `s3:ListBucket` is a BUCKET-level action and the
 * buckets are SHARED: an unconditioned allow authorizes `ListObjectsV2` over every prefix, including other
 * tenants' media — enumeration the object-level `recipes/*` scope on the delete statement never intended,
 * and enumeration is still disclosure. `s3:prefix` is the request's own `Prefix` parameter, and
 * `eraseRecipeObjects` always sends `recipes/{ownerId}/{recipeId}/`, so `recipes/*` admits exactly what the
 * handler issues and denies a bare or foreign-prefix listing outright. ⚠️ The `*` here is a CONDITION value,
 * not a resource — cdk-nag's IAM5 reads resources and actions and raises nothing for it.
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
            conditions: { StringLike: { 's3:prefix': [`${RECIPE_OBJECT_ROOT}/*`] } },
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
 * alarm, and for the same reason: an archive row that has sat un-drained for an hour is stuck, not busy,
 * so it is a signal a human must see. Without it a single row can age past the SLA while the count stays
 * comfortably under 100 and nothing fires.
 *
 * ⚠️ THIS THRESHOLD IS COUPLED TO THE SWEEP CADENCE, which is currently ONE DAY (see
 * `ArchiveSweepSchedule`, a temporary cost posture). "Un-drained for an hour ⇒ stuck" is only a valid
 * inference while the sweep is faster than an hour. The bound is deliberately left at 3600s rather than
 * relaxed to match the slow cadence, because it is an FR-007b-i MUST and moving it would weaken a spec
 * guarantee to accommodate a temporary setting. It does not misfire today only because no pending rows
 * exist and the alarm is `treatMissingData: NOT_BREACHING`. Whoever restores real traffic MUST restore
 * the one-minute cadence in the same change, or this alarm becomes permanent noise.
 */
const ARCHIVE_AGE_ALARM_THRESHOLD_SECONDS = 3600;

/**
 * CloudWatch namespace + metric name the archive sweeper emits and the age alarm watches. Mirror the
 * literals `archiveSweeper.ts` publishes (`Commise/RecipeArchive` / `OldestPendingArchiveAgeSeconds`) —
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
 * How long one verification may take: ONE `Converse` call plus two single-row SQL statements.
 *
 * Sized against what the call actually is — Bedrock `Converse` on a micro model at ~660 input / ~80 output
 * tokens is roughly a second — with an order of magnitude of headroom for a cold pool or a slow region.
 *
 * ⚠️ IT IS ALSO A SPEND BOUND, which is why it is not generous. The function holds a worst-case reservation
 * for its whole invocation; a timeout kills it between the response and the settlement, and ADR-0024 accepts
 * that as an over-count. A long timeout makes that window longer for no benefit — nothing here retries, so
 * waiting cannot rescue a call.
 */
const VERIFICATION_WORKER_TIMEOUT = Duration.seconds(60);

/**
 * How long a `running` test reset may sit before the backstop calls it stuck (plan U12).
 *
 * ⚠️ UNLIKE EVERY OTHER BOUND THIS STACK PASSES THE CHECK, this one is not a consumer's configuration
 * read back. ADR-0040's self-purge runs IN-PROCESS inside recipe-service, which holds no lease this side
 * can see — so the number is the backstop's own judgement about what no honest purge exceeds. Recorded
 * rather than hidden: a runner that legitimately took longer would be reported as stuck.
 */
const TEST_RESET_STALE = Duration.minutes(15);

/**
 * How often the scheduled backstop runs.
 *
 * ⛔ THIS AND `QUEUE_CHECK_INTERVAL_MINUTES` IN `src/common/queueEscalation.ts` ARE ONE CADENCE. The
 * handler upserts its cron monitor with that interval on every check-in, so a rule firing less often than
 * the monitor expects reports a missed check-in every interval — a permanently-failing monitor for a check
 * running exactly as designed, which is how a real alert gets muted.
 *
 * ⚠️ Not imported, because `infra/` and `src/` are separate TypeScript programs here and a runtime module
 * must not depend on a CDK app. Held together the way this package already holds the CRF pin: a guard
 * READS both sides (`src/common/__tests__/queueCheckCadence.test.ts`) rather than either copying the other.
 */
const QUEUE_CHECK_INTERVAL = Duration.minutes(5);

/**
 * The longest a non-prod stage's database is deliberately unreachable: ADR-0007's nightly shutdown, 00:00 to
 * 09:00 America/New_York.
 *
 * ⛔ IT SIZES `maxReceiveCount`, and the reason is R2. A consumer whose RDS is stopped fails every delivery,
 * and each failure spends a receive — so over a nine-hour window a message is redelivered
 * `window / visibilityTimeout` times having never once been given a chance to succeed. Below that, a
 * perfectly healthy message dead-letters because the stage was asleep, and the DLQ depth ADR-0024 layer 4
 * alarms on fills with work nothing was wrong with.
 *
 * ⚠️ This does NOT inflate the U6/U7 attempt allowances, and the distinction is the whole reason those are a
 * separate counter. A receive is spent whenever SQS hands the message over; an ATTEMPT is recorded only by a
 * claim, which needs the database. During this window the claim cannot run at all, so the receive count
 * climbs while the attempt count does not — an outage costs redeliveries and never a line's allowance.
 */
const NIGHTLY_STOP_WINDOW = Duration.hours(9);

/**
 * Redeliveries a queue must tolerate to survive {@link NIGHTLY_STOP_WINDOW}, given its visibility timeout.
 *
 * @param visibilityTimeout - The queue's visibility timeout.
 * @returns The smallest `maxReceiveCount` that outlasts a full nightly stop, with one delivery to spare.
 */
function receivesSurvivingTheNightlyStop(visibilityTimeout: Duration): number {
    return Math.ceil(NIGHTLY_STOP_WINDOW.toSeconds() / visibilityTimeout.toSeconds()) + 1;
}

/**
 * Deliveries one unit of work may CLAIM before its consumer stops trying (U6/U7).
 *
 * ⛔ DELIBERATELY NOT `maxReceiveCount`, and the two were briefly conflated. A RECEIVE is spent whenever SQS
 * hands a message over — including when the consumer cannot reach its database at all, which in non-prod is
 * nine hours out of every twenty-four. An ATTEMPT is recorded only by a successful CLAIM, which needs that
 * database. So an outage spends receives and never an allowance, and the two numbers answer different
 * questions: `maxReceiveCount` asks "how long may this message survive an outage", this asks "how many real
 * tries does one line get before we stop and say so".
 *
 * Twenty real attempts is generous for work whose transient failures are engine outages and ceiling
 * denials; past it, continuing to retry costs the same and learns nothing.
 */
const CLAIM_ATTEMPT_ALLOWANCE = 20;

/**
 * The verification queue's visibility timeout — strictly longer than the worker's, as the archive and erasure
 * queues are. A message redelivered while its worker is still running would take a SECOND reservation and
 * make a SECOND billed call for one line.
 */
const VERIFICATION_QUEUE_VISIBILITY_TIMEOUT = Duration.seconds(90);

/** Redeliveries the verification queue permits — sized to outlast a nightly stop (R2). */
const VERIFICATION_QUEUE_MAX_RECEIVES = receivesSurvivingTheNightlyStop(VERIFICATION_QUEUE_VISIBILITY_TIMEOUT);

/**
 * How long the handle-sync worker may run: up to ten renames, each one short transaction.
 *
 * Named for the same reason {@link ERASURE_WORKER_TIMEOUT} is — the queue's visibility timeout is derived
 * from it below, so raising one without the other is a mistake a reader can see rather than a silent
 * redelivery in production.
 */
const HANDLE_SYNC_WORKER_TIMEOUT = Duration.seconds(60);

/**
 * The handle-sync queue's visibility timeout — strictly greater than {@link HANDLE_SYNC_WORKER_TIMEOUT}.
 *
 * ⛔ THIS PAIR USED TO BE EQUAL (60s against 60s), which is the one thing this stack's archive queue says
 * outright must not happen. The failure it admits is not data corruption — `applyHandleRename`'s monotonic
 * `ON CONFLICT … WHERE source_timestamp < EXCLUDED.source_timestamp` makes a duplicate delivery a no-op, and
 * a concurrent one serializes on the row lock — it is RECEIVE-COUNT BURN on work that is succeeding. With
 * `batchSize: 10` and `reportBatchItemFailures`, a batch that runs to the wall clock has its messages become
 * visible again at the same instant Lambda kills the invocation, so the whole batch is redelivered and every
 * message spends a receive; at `maxReceiveCount: 5` a consistently-slow batch dead-letters renames that were
 * applied, and the DLQ depth alarm pages someone about work that succeeded.
 *
 * 30 seconds of headroom, matching {@link VERIFICATION_QUEUE_VISIBILITY_TIMEOUT} — whose worker timeout is
 * identically 60 seconds — and following the reasoning stated at {@link ERASURE_QUEUE_VISIBILITY_TIMEOUT}:
 * an invocation cannot exceed its configured timeout, so the margin only has to absorb the event-source
 * poller's dispatch overhead. ⚠️ AWS's own guidance for SQS event sources is six times the function timeout,
 * and it is deliberately not taken here: that recommendation buys headroom for THROTTLED deliveries, which is
 * a hazard for a consumer pinned at one concurrent execution (this one is not pinned) and which this stack
 * answers with `maxReceiveCount` where it applies. Padding to six minutes would instead stretch a
 * permanently-failing rename's trip to its DLQ alarm from ~10 minutes to ~30 for no safety gain.
 */
const HANDLE_SYNC_QUEUE_VISIBILITY_TIMEOUT = Duration.seconds(90);

/**
 * The EMF namespace the verification gate publishes under (ADR-0024 layer 4).
 *
 * ⛔ MUST EQUAL `VERIFICATION_METRIC_NAMESPACE` in `src/handlers/verifyLine.ts`. The alarms extract by exact
 * namespace, dimension and metric name, so a divergence here does not fail anything — it leaves every alarm
 * below in permanent INSUFFICIENT_DATA, watching a metric nobody publishes. That is the same never-fires class
 * of defect the archive backlog alarm shipped with (its `Stage` dimension did not match the sweeper's env),
 * and `RecipeWorkersStack.test.ts` pins the pairing.
 */
const VERIFICATION_METRIC_NAMESPACE = 'Commise/RecipeVerification';

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
 * emits (`erasureSweeper.ts`) — the two are the same knowledge on either side of the Lambda boundary, and
 * an alarm whose namespace disagrees with the emitter watches a metric nobody writes.
 */
const ERASURE_METRIC_NAMESPACE = 'Commise/RecipeErasure';

/**
 * Metric name the erasure-orphan sweeper emits and the resurrection-caught alarm watches. Mirrors the
 * literal `erasureOrphanSweeper.ts` publishes (`ORPHAN_METRIC_NAME`) — the same knowledge on either
 * side of the Lambda boundary, so an alarm whose name disagrees with the emitter watches a dead metric.
 */
const ORPHAN_METRIC_NAME = 'ErasureOrphansDeleted';

/**
 * The EMF namespace + metric name the parse leg's CRF adapter publishes its availability gauge under.
 *
 * ⛔ MUST EQUAL `PARSE_METRIC_NAMESPACE` / `CRF_UNAVAILABLE_METRIC_NAME` in `src/parsing/crfInvoke.ts`. The
 * alarm extracts by exact namespace, dimension and metric name, so a divergence here fails nothing at deploy
 * time — it leaves the alarm below watching a metric nobody publishes, which under
 * `treatMissingData: NOT_BREACHING` is a permanent, confident `OK`. `serviceInfraWiringInvariants` W3 catches
 * a metric NAME the runtime never mentions; nothing catches a namespace, so this comment is the pairing.
 */
const PARSE_METRIC_NAMESPACE = 'Commise/RecipeParse';
const CRF_UNAVAILABLE_METRIC_NAME = 'CrfEngineUnavailable';

/**
 * The parse-landing discard gauge and the parse-job stall gauge.
 *
 * ⛔ MUST EQUAL `PARSE_LANDING_DISCARDED_METRIC_NAME` in `src/handlers/parseLine.ts` and
 * `PARSE_JOB_STALL_METRIC_NAME` in `src/handlers/bandDrain.ts`. Same pairing rule, same failure mode as
 * {@link CRF_UNAVAILABLE_METRIC_NAME}: a divergence fails nothing at deploy time and leaves the alarm
 * watching a metric nobody publishes. `serviceInfraWiringInvariants` W3 asserts the name against the
 * runtime sources; the namespace is asserted only by this comment and the one beside it.
 */
const PARSE_LANDING_DISCARDED_METRIC_NAME = 'ParseLandingDiscarded';
const PARSE_JOB_STALL_METRIC_NAME = 'OldestRunningParseJobAgeSeconds';

/**
 * The percentage of landing attempts that may be discarded before somebody is paged.
 *
 * ⛔ FIFTY, and the number is bounded on both sides by measurement rather than picked. A discard is a
 * NORMAL outcome: R17 guards the landing on the stored digest, so a line edited after enqueue discards the
 * message its edit superseded, and that ran at roughly ELEVEN percent of landings in steady state. The
 * incident ran at 99.9%. Fifty is the midpoint of an order-of-magnitude gap — comfortably above a busy
 * editing session and far below the failure — and there is no plausible traffic mix in which more than half
 * of all landings are superseded edits.
 */
const PARSE_DISCARD_RATE_THRESHOLD_PERCENT = 50;

/**
 * Landing attempts a five-minute window must contain before its discard rate is judged at all.
 *
 * ⛔ A RATE WITHOUT A FLOOR IS A PAGE WAITING FOR A QUIET TUESDAY: one landing, one discard, 100%. Twenty
 * is set against the measured incident, which sustained ~780 discards an hour — about 65 attempts per
 * five-minute window at 99.9% — so the floor is three times below the traffic the alarm must catch and well
 * above the handful of landings a near-idle stage produces. Below it the expression answers a definite `0`
 * rather than no datapoint: "not enough evidence to judge" should read the same as healthy, and should not
 * depend on how CloudWatch treats a missing else-branch.
 */
const PARSE_DISCARD_MIN_ATTEMPTS = 20;

/**
 * How long the oldest still-running parse job may run before somebody is paged.
 *
 * ⛔ Derived against a hard bound, not chosen by feel. `PARSE_JOB_TTL_HOURS` is 24 and the expiry sweep
 * discards the job at that deadline — so the whole window in which anybody can act is one day, and a
 * detector set anywhere near it would page at the same time as the discard it exists to pre-empt. The happy
 * path is SECONDS: a line is claimed, parsed by two engines and landed inside one Lambda invocation. An
 * hour is therefore three orders of magnitude past normal while still leaving twenty-three hours of lead
 * time, and it is the same number `ERASURE_AGE_ALARM_THRESHOLD_SECONDS` reasons its way to on the same
 * ground ("broken rather than busy — the happy path takes seconds").
 *
 * ⚠️ THIS IS THE ONLY DECLARATION. `parseJobExpiry.ts` used to export a `PARSE_JOB_STALL_SECONDS` twin
 * under a `MUST EQUAL` comment that no guard enforced — and nothing in the runtime ever read it, because a
 * threshold is an ALARM concern: the gauge publishes the age and the alarm decides what is too old. One
 * rule, one representation, and no cross-file equality left to police.
 */
const PARSE_JOB_STALL_THRESHOLD_SECONDS = 3600;

/**
 * How many absent CRF invocations inside five minutes page someone.
 *
 * ⛔ A COUNT, over ONE period — and both halves are corrections of an earlier draft that could not have
 * fired. That draft alarmed on `Average >= 1` (the failure RATIO) sustained across consecutive periods, which
 * is unfirable HERE for a reason specific to this series: `runParsePipeline` asks the CRF only about lines
 * that MISSED the cache, so the series is gappy by construction, and a warm cache emits nothing at all. Every
 * consecutive-period design needs each window to contain traffic; the one alarm in this stack that uses three
 * periods watches a sweeper that emits unconditionally on a schedule. This is the never-fires class of defect
 * the erasure-age comment above already records once.
 *
 * ⚠️ `Sum` is the failure COUNT precisely because the emitter publishes 0 on success — the healthy datapoints
 * add nothing — so the ratio needs no expression and the alarm stays inside the AST that
 * `serviceInfraWiringInvariants` W3/W4 can read (a `MathExpression` resolves to no namespace and is skipped
 * by both gates).
 *
 * ⚠️ ONE is the threshold, not zero: a single self-healing invoke failure now RETRIES, and paging on it would
 * make the alarm a report of Lambda-service weather. Two inside five minutes is not weather — the series
 * counts only systemic absence, never a line the engine read and declined.
 *
 * ⚠️ ACCEPTED BLIND SPOT, stated rather than papered over: a stage whose ONLY traffic in the window is one
 * uncached line does not reach two. That case is the DLQ alarm's, which needs no traffic at all and latches
 * until a human drains it.
 */
const CRF_UNAVAILABLE_THRESHOLD = 1;

export interface RecipeWorkersStackProps extends StackProps {
    /**
     * The log forwarder's ARN, resolved in CI. Absent means no subscription filter is attached —
     * see the drain comment in the body for the deadlock that makes absence a supported state (ADR-0042).
     */
    readonly logForwarderArn?: string;

    /**
     * Email that receives this stack's alarms (R3.2 / plan U11). Supplied per-stage from
     * `COST_ALERT_EMAIL` / the `costAlertEmail` context in `infra/bin/app.ts`; when omitted the topic is
     * created with NO subscription, so no address is ever baked into a committed template (this repo is
     * public).
     */
    readonly alertEmail?: string;

    /**
     * Whether this stack creates its CloudWatch alarms. Resolved at SYNTH time from `ALARMS_ENABLED`, which
     * the deploy pipeline reads from `/kitchensink/{stage}/observability/alarms-enabled`; the default is OFF,
     * so a sandbox or `pr-{N}` preview provisions none.
     *
     * ⛔ REQUIRED rather than optional — an optional prop lets a call site keep the old behaviour by saying
     * nothing. And never read from SSM inside CDK: `valueForStringParameter` resolves at DEPLOY time and
     * returns a token, so gating on it compiles, deploys, and does nothing. Both rules are enforced by
     * `packages/infra/global/__tests__/alarmFeatureFlag.test.ts`.
     */
    readonly alarmsEnabled: boolean;

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

        // ── Sentry, for all ten functions (plan U16/U22) ──
        //
        // ⛔ Per-STAGE parameter, per-SERVICE key. The DSN lives in SSM at the BASE stage — a `pr-{N}`
        // preview has no Sentry project of its own and resolves sandbox's, separating itself by the
        // `environment` tag instead. That is what keeps previews from costing a project each.
        //
        // ⚠️ `SENTRY_RELEASE` falls back to the STAGE outside CI rather than being omitted: these are Lambda
        // env vars, and an absent one reads the same as an unset one, so a hand-deploy would silently lose
        // the release. The stage is a poor release and a visible one.
        const sentryEnv: Record<string, string> = {
            SENTRY_DSN: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${props.baseStage}/sentry/recipe-workers-dsn`,
            ),
            SENTRY_TRACES_SAMPLE_RATE: props.stage === 'prod' ? '0.1' : '1.0',
            SENTRY_RELEASE: process.env['SENTRY_RELEASE'] ?? props.stage,
        };

        // ── Drain this group to Sentry (plan U15, ADR-0042) ──
        //
        // ⛔ THE FILTER LIVES HERE, in the stack that OWNS the group, because a subscription filter is a
        // property of the group: attaching from elsewhere means importing another stack's resource, which is
        // how `WebhooksStack` once pinned a reclaimable stack and blocked its deletion. So the forwarder's
        // ARN travels instead of the group.
        //
        // ⚠️ `addPermissions: false` — the `lambda:InvokeFunction` grant for `logs.amazonaws.com` is made
        // ONCE in `WebhooksStack`, scoped by `sourceAccount`. An imported function cannot carry a resource
        // policy from here anyway, so asking CDK to add one would be a silent no-op rather than a second
        // grant.
        //
        // ⚠️ The filter pattern excludes Lambda platform lines and EMF metric payloads, matching the webhook
        // stack's own filters — an EMF line forwarded as a log is a metric turned into noise.
        //
        // ⛔ ONLY WHEN THE ARN IS KNOWN. `Fn.importValue` on the webhooks app's export made this stack wait
        // for a stack the same pipeline deploys LATER, which is a deadlock rather than a race: a sandbox
        // deploy died in `UPDATE_ROLLBACK_IN_PROGRESS` with "No export named
        // kitchensink-identity-webhooks-sandbox:LogForwarderArn found". The ARN now arrives as a CI-resolved
        // input, the same form `DataStack` and `SandboxSchedulerStack` already take it in.
        //
        // ⚠️ ABSENT IS A SUPPORTED STATE, not a failure: a fresh account has no forwarder to point at, and
        // a hard failure here would leave it with no way to bootstrap. The filter attaches on the next
        // deploy of this app — ADR-0042 records the convergence window as a residual.
        const logForwarder =
            props.logForwarderArn === undefined
                ? undefined
                : lambda.Function.fromFunctionArn(this, 'ImportedLogForwarder', props.logForwarderArn);

        if (logForwarder !== undefined) {
            new logs.SubscriptionFilter(this, 'RecipeWorkersLogDrain', {
                logGroup: logGroup,
                destination: new logsDestinations.LambdaDestination(logForwarder, { addPermissions: false }),
                filterPattern: logs.FilterPattern.literal('-START -END -REPORT -"_aws"'),
                filterName: 'forward-app-logs',
            });
        }

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

        // RDS-IAM: the service role is passwordless, so each function mints a short-lived auth token
        // (`@aws-sdk/rds-signer`) instead of reading a password secret. Grant is per-DB-user, through CDK's own
        // `grantConnect` and the registry's role name (`dbUserGrantRegister.test.ts`).
        //
        // ⚠️ #121 IS WHY THIS IS `grantConnect` AND NOT A HAND-BUILT ARN. `Stack.formatArn`'s default
        // `SLASH_RESOURCE_NAME` emits `…:dbuser/{resourceId}/{dbUser}` — an ARN matching no real resource, so
        // `rds-db:connect` is implicitly DENIED and RDS reports it as `PAM authentication failed for user
        // "recipe_app"` (SQLSTATE 28000), failing every invocation of every worker. The required shape is
        // COLON-separated, which is exactly what `grantConnect` builds; the stack test pins it.
        const database = rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedRecipeDatabase', {
            instanceIdentifier: props.dbInstanceIdentifier,
            instanceResourceId: props.dbInstanceIdentifier,
            instanceEndpointAddress: props.dbEndpoint,
            port: props.dbPort,
            securityGroups: [],
        });

        const grantRdsIam = (role: iam.Role): void => {
            database.grantConnect(role, DATABASE_ROLES.recipe.app);
        };

        // ONE derivation, shared with `RecipeServiceStack` via `@kitchensink/recipe-core` (#119). Both
        // stacks call this same function with the same (stage, baseStage), so a preview's Lambdas and its
        // API cannot disagree about which logical database they are talking to — the divergence that put
        // three destructive scheduled sweepers on the SHARED database. Pinned by the cross-stack parity
        // test in `packages/services/recipe-service/infra/__tests__/recipeDatabaseNameParity.test.ts`.
        const dbName = ssm.StringParameter.valueForStringParameter(this, recipeDatabaseNameParameter(props.stage));

        const commonDbEnv: Record<string, string> = {
            RECIPE_DB_HOST: props.dbEndpoint,
            RECIPE_DB_PORT: String(props.dbPort),
            RECIPE_DB_NAME: dbName,
            RECIPE_DB_USER: DATABASE_ROLES.recipe.app,
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
        // versionArchiveWorker.ts), with no tagging, no object lock and no multipart upload -- so every one
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
        // The exact S3 API surface of `eraseRecipeObjects` (accountErasureWorker.ts, also reused by the
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

        // band drain: the revocation backlog's scheduled sender (plan U3, R14). Reads the band tables and
        // the spend counter, sends stored messages to the verification queue, and marks them drained. Sends
        // to SQS but must NOT consume (ARCH-IT-7); ⛔ NO bedrock permission of any kind — it feeds the gate,
        // and the gate's role stays the only InvokeModel grantee (ADR-0024 §4b).
        const bandDrainRole = makeRole('BandDrainRole', 'Least-privilege role for the band revocation drain Lambda');
        grantRdsIam(bandDrainRole);

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

        // analytics retention sweeper (analytics plan U6, origin R10): deletes analytics_events rows past
        // the 6-month window, daily. Database only — no S3, no SQS, no CDN: least-privilege is RDS-IAM
        // and nothing else (ARCH-IT-7).
        const retentionSweeperRole = makeRole(
            'AnalyticsRetentionSweeperRole',
            'Least-privilege role for the analytics retention sweeper Lambda',
        );
        grantRdsIam(retentionSweeperRole);

        // ── functions ──────────────────────────────────────────────────────────────────────────────
        const runtime = NODE_LAMBDA_RUNTIME;
        const architecture = lambda.Architecture.ARM_64;
        const vpcSubnets: ec2.SubnetSelection = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

        const workerFn = new lambda.Function(this, 'VersionArchiveWorkerFunction', {
            runtime,
            architecture,
            // Matches esbuild's outbase:src layout — see esbuild.mjs entryPoints.
            handler: 'handlers/versionArchiveWorker.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: workerRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 512,
            environment: { ...commonDbEnv, ...sentryEnv, RECIPE_ARCHIVE_BUCKET: props.archiveBucketName },
            logGroup,
        });

        // batchSize 1: a partial-batch failure would otherwise redeliver already-archived versions. They
        // are idempotent (same key, no-op prune), but one-at-a-time keeps the DLQ signal precise — a
        // message in the DLQ is exactly one version that could not be archived.
        workerFn.addEventSource(new lambda_event_sources.SqsEventSource(this.archiveQueue, { batchSize: 1 }));

        const sweeperFn = new lambda.Function(this, 'ArchiveSweeperFunction', {
            runtime,
            architecture,
            handler: 'handlers/archiveSweeper.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: sweeperRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            // STAGE is REQUIRED, not optional: archiveSweeper.ts publishes the PendingArchiveBacklog
            // metric under `Stage=process.env['STAGE'] ?? 'unknown'`, and the T138 backlog alarm below
            // watches the `Stage=props.stage` dimension. Omitting STAGE here (the original T132 bug) made
            // the sweeper publish under `unknown` while the alarm watched `{stage}`, so the FR-007b-i
            // backlog alarm — a spec MUST — sat in INSUFFICIENT_DATA forever and could never fire. Set it
            // here (not in commonDbEnv) because only the sweeper needs it; the backlog alarm's dimension
            // MUST equal this value. Pinned by the "sets STAGE on the archive sweeper" synth test.
            environment: {
                ...commonDbEnv,
                ...sentryEnv,
                RECIPE_ARCHIVE_QUEUE_URL: this.archiveQueue.queueUrl,
                STAGE: props.stage,
            },
            logGroup,
        });

        // Once a day. The sweep is the archive's ONLY trigger, so this interval IS the worst-case delay
        // between a version going over-retention and its snapshot reaching S3 — now a day, not a minute.
        //
        // ⚠️ DELIBERATE AND TEMPORARY — a cost posture, not a design (owner ruling, 2026-08-15). At one
        // minute this fired ~43k times/month in EVERY stage (prod + one per open PR) against a system
        // with no production traffic, where a drained outbox costs one indexed query returning zero rows
        // (idx_pending_archives_status_next). Cheap per tick, but bought nothing 1440 times a day.
        //
        // ⛔ RESTORE TO ONE MINUTE BEFORE REAL TRAFFIC ARRIVES — and not only for archive latency.
        // ARCHIVE_AGE_ALARM_THRESHOLD_SECONDS (3600s, an FR-007b-i MUST) encodes "un-drained for
        // an hour ⇒ stuck, not busy", and that inference holds ONLY while the sweep is fast. Under a
        // daily sweep WITH traffic, a pending row legitimately waits up to 24h, so that alarm would sit
        // in permanent ALARM and mail a human on every ordinary archive. It stays quiet today purely
        // because no pending rows exist and the alarm is `treatMissingData: NOT_BREACHING` — i.e. the
        // same absence of traffic that makes a daily sweep safe is what is muting the alarm. Restoring
        // traffic without restoring this cadence turns an FR-007b-i safety alarm into inbox noise.
        new events.Rule(this, 'ArchiveSweepSchedule', {
            ruleName: `kitchensink-recipe-archive-sweep-${props.stage}`,
            schedule: events.Schedule.rate(Duration.days(1)),
            targets: [new events_targets.LambdaFunction(sweeperFn)],
        });

        // HAZ-051/067/039: CLOUDFRONT_DISTRIBUTION_ID is OPTIONAL passthrough (mirrors recipe-service's
        // own optional `cloudfrontDistributionId` prop) — omitted entirely rather than set to an empty
        // string when absent, so the worker's CDN adapter sees an actually-unset value and degrades to
        // its documented no-op instead of being handed a blank id to (mis)interpret.
        const erasureEnvironment: Record<string, string> = {
            ...commonDbEnv,
            ...sentryEnv,
            RECIPE_ARCHIVE_BUCKET: props.archiveBucketName,
            RECIPE_MEDIA_BUCKET: props.mediaBucketName,
        };

        if (props.cloudfrontDistributionId !== undefined) {
            erasureEnvironment['CLOUDFRONT_DISTRIBUTION_ID'] = props.cloudfrontDistributionId;
        }

        const erasureFn = new lambda.Function(this, 'AccountErasureWorkerFunction', {
            runtime,
            architecture,
            handler: 'handlers/accountErasureWorker.handler',
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
            visibilityTimeout: HANDLE_SYNC_QUEUE_VISIBILITY_TIMEOUT,
        });
        this.handleSyncQueue = new sqs.Queue(this, 'HandleSyncQueue', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-handle-sync-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: HANDLE_SYNC_QUEUE_VISIBILITY_TIMEOUT,
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
            handler: 'handlers/handleSyncWorker.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: handleSyncRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            // The symbol the queue's visibility timeout is derived from — see HANDLE_SYNC_WORKER_TIMEOUT.
            timeout: HANDLE_SYNC_WORKER_TIMEOUT,
            memorySize: 256,
            environment: { ...commonDbEnv, ...sentryEnv },
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
            handler: 'handlers/erasureSweeper.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: erasureSweeperRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            environment: {
                ...commonDbEnv,
                ...sentryEnv,
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
            schedule: events.Schedule.rate(QUEUE_CHECK_INTERVAL),
            targets: [new events_targets.LambdaFunction(erasureSweeperFn)],
        });

        // The resurrection backstop. Reconciles BOTH object buckets against recently-completed erasure
        // owners; STAGE is set here (NOT commonDbEnv) because only this sweeper emits the orphans-deleted
        // metric, and its EMF `Stage` dimension must equal the alarm's below.
        const orphanSweeperFn = new lambda.Function(this, 'ErasureOrphanSweeperFunction', {
            runtime,
            architecture,
            handler: 'handlers/erasureOrphanSweeper.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: orphanSweeperRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            environment: {
                ...commonDbEnv,
                ...sentryEnv,
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
        // an almost-always-empty tick stays cheap. See erasureOrphanSweeper.ts for the full arithmetic.
        new events.Rule(this, 'ErasureOrphanSweepSchedule', {
            ruleName: `kitchensink-recipe-erasure-orphan-sweep-${props.stage}`,
            schedule: events.Schedule.rate(Duration.hours(1)),
            targets: [new events_targets.LambdaFunction(orphanSweeperFn)],
        });

        // Analytics retention (analytics plan U6, origin R10/AE5): ages raw analytics_events past the
        // 6-month window out of the store, provably after folding — counts fold at INSERT and 0043 ships
        // no DELETE trigger, so this sweep moves no lifetime count (the recipe-service and worker
        // integration suites both pin it). Batched + bounded per tick; see retentionSweeper.ts.
        const retentionSweeperFn = new lambda.Function(this, 'AnalyticsRetentionSweeperFunction', {
            runtime,
            architecture,
            handler: 'handlers/retentionSweeper.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: retentionSweeperRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            environment: {
                ...commonDbEnv,
                ...sentryEnv,
                STAGE: props.stage,
            },
            logGroup,
        });

        // DAILY, not hourly: retention has a six-MONTH horizon, so the tightest freshness anyone can
        // observe is "rows disappear within a day of aging out" — more ticks buy nothing, and the
        // batch-bounded sweep drains any backlog across successive days regardless.
        new events.Rule(this, 'AnalyticsRetentionSweepSchedule', {
            ruleName: `kitchensink-recipe-analytics-retention-${props.stage}`,
            schedule: events.Schedule.rate(Duration.days(1)),
            targets: [new events_targets.LambdaFunction(retentionSweeperFn)],
        });

        // ── verification gate: queue + DLQ + the ONE Bedrock caller (plan U11, ADR-0024) ────────────
        //
        // ⛔ LAYER 0 OF ADR-0024's SIX, and the ADR calls it "the cheapest and highest-value control in the
        // stack": SQS `maxReceiveCount` + a DLQ stop a retry loop BEFORE it becomes cost. Everything else in
        // this block is a layer above it.
        //
        // ⛔ THE PERSONAL-DATA HALF OF THIS PARAGRAPH WAS SUPERSEDED FOUR DAYS AFTER IT WAS WRITTEN, and the
        // correction is left standing rather than deleted because the repealed claim is the one a reader will
        // otherwise carry to the parse pair below. It read: `sourceLine` is user-authored, neither the erasure
        // worker nor the orphan sweeper purges SQS, so a message in this DLQ is "a copy of personal data
        // outside every erasure path". ADR-0027 (2026-08-25) records the owner's ruling that an ingredient
        // phrase is NOT personal data — and this queue's contract no longer carries an owner id at all
        // (§7 removed `ownerId` from `verificationMessage.ts`), so what sits here is a phrase and a key.
        //
        // ⚠️ The SECOND argument survives, and it still sets this queue apart from the fourteen days every
        // other DLQ here keeps: a redrive is a quality signal, not a compliance obligation. An un-redriven
        // message costs one unverified line — which publishes, exactly as it did before this gate existed.
        // Retention is also how long this DLQ's depth alarm keeps paging (the metric only breaches while
        // messages are retained), and roughly three days of paging is proportionate to that consequence where
        // fourteen is not. SSE at rest is the stack-wide baseline, not a mitigation specific to this queue.
        //
        // ⛔ THE NUMBER IS SEVEN, NOT THREE, AND THE DIFFERENCE IS ARRIVAL-EXPIRY RATHER THAN PAGING. On a
        // STANDARD queue "expiration of a message is always based on its original enqueue timestamp" (SQS
        // dead-letter-queue guide): moving to a DLQ does NOT restart the clock. A message that exhausted its
        // twenty receives late in the source queue's four days therefore arrived here ALREADY older than three
        // days and was deleted on arrival — no depth to alarm on, no redrive to offer, and indistinguishable
        // from a queue that never received anything. Seven days keeps the paging window this paragraph argues
        // for (four days of source life, then ~three days here) while removing the silent deletion.
        // `RecipeWorkersStack.test.ts` derives the rule from the redrive graph rather than pinning this
        // number: every DLQ must retain at least as long as the queue that feeds it.
        //
        // ⛔ Do NOT propagate the three days to the parse DLQ on either half. The privacy half is repealed,
        // and the surviving half is about THIS queue's consequence-of-loss, which the parse leg does not
        // share — see the argument recorded at `RecipeParseDlq`.
        const verificationDlq = new sqs.Queue(this, 'IngredientVerificationDlq', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-verification-dlq-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(7),
            visibilityTimeout: VERIFICATION_QUEUE_VISIBILITY_TIMEOUT,
        });

        const verificationQueue = new sqs.Queue(this, 'IngredientVerificationQueue', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-verification-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: VERIFICATION_QUEUE_VISIBILITY_TIMEOUT,
            // ⛔ 20, NOT the 5 every other queue here uses, and the reason is a Lambda behaviour rather than a
            // preference. This function runs at `reservedConcurrentExecutions: 1` (below). When the SQS poller
            // outruns that reservation Lambda THROTTLES the invocation — and a throttled delivery still
            // increments `ApproximateReceiveCount`. At 5, a backlog would send messages to the DLQ having
            // NEVER EXECUTED, and the bake-off (2,432 messages, ~40 minutes serialized at ~1s per call) is
            // exactly that scenario: it would look like a catastrophic model failure and be a queue setting.
            // The event source's own `maxConcurrency` cannot express 1 (its documented minimum is 2), and
            // raising the reserved concurrency would break ADR-0024 layer 2 and the guard test that pins it.
            // `VerificationThrottlesAlarm` below is what makes throttle-induced redelivery visible rather than
            // a silent drain. ⚠️ Both AWS behaviours here should be re-verified against current documentation
            // before this number is tuned again.
            deadLetterQueue: { queue: verificationDlq, maxReceiveCount: VERIFICATION_QUEUE_MAX_RECEIVES },
        });

        // ⛔ ADR-0024 LAYER 4b — THE BYPASS CONTROL. `bedrock:InvokeModel` is granted to EXACTLY ONE execution
        // role, and `packages/infra/global/__tests__/llmSpendGuards.test.ts` asserts that by set equality over
        // the whole infra tree. (This used to cite a `bedrockInvokeGrantees.test.ts` that has never existed —
        // a citation to a guard nobody can find reads as a guard nobody has.)
        // Layer 4's EMF dollar metric CANNOT detect a bypass: it is emitted BY the gated path, so a caller
        // that skips the gate emits nothing. A permission nobody else holds cannot be bypassed; a metric
        // nobody else emits cannot notice. ⛔ Adding a second grantee — for an embedding model, for a
        // tier-4 rewrite in another service, for a one-off script — puts that spend OUTSIDE the $100 ceiling
        // and reds the guard by construction. U11's own tier-4 rewrite runs under THIS role for that reason.
        const verificationRole = makeRole(
            'IngredientVerificationRole',
            'Least-privilege role for the ingredient verification gate (the ONLY bedrock:InvokeModel grantee)',
        );
        grantRdsIam(verificationRole);
        verificationQueue.grantConsumeMessages(verificationRole);

        // ⛔ THE GRANT FOLLOWS THE REGISTRY (U35) — ALL of it, and nothing else. Every ARN this role may
        // invoke is derived from `BEDROCK_MODEL_REGISTRY`: an on-demand model by its own name in this region, a
        // profile-only model through its account-scoped `inference-profile` ARN plus a conditioned fan-out to
        // the foundation model in every region that profile routes to. The registry is already the authority
        // for which models may be CALLED (membership is authorization; every runtime caller refuses an id
        // outside it before any call), so deriving the permission from it is what keeps IAM and the caller
        // from disagreeing about which models exist.
        //
        // ⛔ There is NO `foundation-model/*` any more. It stood here justified as irreducible — "the model id
        // comes from SSM and cannot be resolved at synth time" — and ADR-0024 §4b retracted that reasoning:
        // the registry IS resolvable at synth time, and an SSM value outside it is refused as `unpriced` before
        // Bedrock is reached. The wildcard therefore authorized only models the runtime could never call, and
        // carried an IAM5 acceptance (`VERIFICATION_BEDROCK_MODEL_WILDCARD`, now deleted) whose reason had
        // already been withdrawn. Rostering a model is a registry edit plus a deploy of this stack — exactly
        // what pricing it already required. `Converse` is authorized by `bedrock:InvokeModel`;
        // `InvokeModelWithResponseStream` is deliberately absent because this gate never streams, and a
        // streamed response would defeat the single-response settlement.
        //
        // ⚠️ TWO statements per profile, which is AWS's documented least-privilege shape and NOT a layer-4b
        // breach: that gate's invariant is over GRANTEES and ACTIONS, never statement count. See
        // `infra/lib/bedrockInvokePolicy.ts` for why the `bedrock:InferenceProfileArn` condition is
        // load-bearing rather than decoration. ⚠️ The literal `actions: ['bedrock:InvokeModel']` and the
        // `verificationRole` reference below are what `llmSpendGuards.test.ts`'s source parser reads.
        //
        // ⛔ AND RESIDENCY IS NOW PART OF THAT DERIVATION (ADR-0024 §4b, owner ruling 2026-09-04). An entry
        // whose inference profile leaves this region with no `residencyApproval` is granted NOTHING, by the
        // SAME `residencyRefusal` `planReservation` calls — so the policy stopped naming
        // `us.amazon.nova-2-lite-v1:0`, `us.anthropic.claude-haiku-4-5-…` and the us-east-2/us-west-2
        // foundation models behind them. The region comes from `Stack.of(this)` and nowhere else: `formatArn`
        // already defaults the profile ARN's region from the same stack, so a second source (a prop, the
        // stage) could put the ARN's region and the residency region out of step.
        for (const statement of bedrockInvokeStatements(
            BEDROCK_MODEL_REGISTRY,
            (parts) => Stack.of(this).formatArn({ service: 'bedrock', ...parts }),
            Stack.of(this).region,
        )) {
            verificationRole.addToPolicy(
                new iam.PolicyStatement({
                    actions: ['bedrock:InvokeModel'],
                    resources: [...statement.resources],
                    ...(statement.throughInferenceProfileArns === undefined
                        ? {}
                        : {
                              conditions: {
                                  StringLike: {
                                      'bedrock:InferenceProfileArn': [...statement.throughInferenceProfileArns],
                                  },
                              },
                          }),
                }),
            );
        }

        // ⛔ NO nag acceptance on this role, deliberately. Every statement above enumerates the ARNs it grants,
        // so none raises an IAM5 wildcard finding — and an acceptance here would silence the one a future
        // registry entry written with a `*` WOULD raise. A finding on this role is a finding.

        // ⛔ TWO EXACT PARAMETER ARNs, not a prefix. The ceiling and the model id are the two values an
        // operator changes mid-incident, and a `/kitchensink/{stage}/recipe/*` grant would also hand this role
        // the account-erasure queue URL that lives beside them.
        const ceilingParameterName = `/kitchensink/${props.stage}/recipe/verification-ceiling-micros`;
        const modelParameterName = `/kitchensink/${props.stage}/recipe/verification-model-id`;

        verificationRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['ssm:GetParameters'],
                resources: [ceilingParameterName, modelParameterName].map((name) =>
                    Stack.of(this).formatArn({ service: 'ssm', resource: 'parameter', resourceName: name.slice(1) }),
                ),
            }),
        );

        // ⚠️ SEEDED HERE, then owned by the OPERATOR. R23 requires the ceiling be configurable, and ADR-0024
        // §3 requires it be changeable without redeploying this stack — so CDK creates the parameters with
        // their starting values and the worker re-reads them on a 60-second TTL. A subsequent `cdk deploy`
        // WILL reset a hand-edited value back to the seed, which is the accepted cost of having them exist on
        // a fresh stage at all; an operator lowering the ceiling during an incident must also lower the seed,
        // and the runbook says so.
        new ssm.StringParameter(this, 'VerificationCeilingParam', {
            parameterName: ceilingParameterName,
            stringValue: String(DEFAULT_MONTHLY_CEILING_MICROS),
            description: 'LLM verification gate: monthly spend ceiling in micro-dollars (ADR-0024). 0 = deny all.',
        });
        new ssm.StringParameter(this, 'VerificationModelParam', {
            parameterName: modelParameterName,
            stringValue: NOVA_MICRO_MODEL_ID,
            description: 'LLM verification gate: the Bedrock model id (KTD-4). Must be priced by the rate table.',
        });

        // ⛔ ONE policy, BOTH numbers, per stage class (U8/R1/R2/R4). The reservation and the event source
        // mapping's concurrency are set on different resources and neither validates the other, so raising
        // one alone fails silently in a different way each time — see `consumerConcurrency.ts`. Prod scales
        // both together; non-prod keeps the reservation of 1 that ADR-0024 layer 2 depends on, and sets no
        // mapping concurrency at all (AWS refuses a value below 2).
        const consumerConcurrency = consumerConcurrencyFor(props.stage);

        const verificationFn = new lambda.Function(this, 'IngredientVerificationFunction', {
            runtime,
            architecture,
            handler: 'handlers/verifyLine.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: verificationRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: VERIFICATION_WORKER_TIMEOUT,
            memorySize: 512,
            // ⛔ ADR-0024 LAYER 2, AND THE ONLY THING BOUNDING NON-PROD SPEND. The ceiling is prod-only by
            // owner ruling, so in sandbox and every pr-{N} this single constant is what stands between a
            // redrive loop and the invoice: at ~1s per call it bounds the burn at ~86,400 calls/day ≈
            // $2.90/day ≈ $88/month/stage on Nova Micro (~30x that on Haiku 4.5). ADR-0024 names raising it as
            // "the one change that makes this ruling unsafe". Pinned by
            // `packages/infra/global/__tests__/llmSpendGuards.test.ts` ('pins the verifier at
            // reservedConcurrentExecutions = 1'), in EVERY stage. ⚠️ This used to cite a
            // `verificationConcurrencyGuard.test.ts` that has never existed in this repository — a citation
            // to a guard nobody can find reads as a guard nobody has, which is how a real pin gets removed.
            //
            // ⚠️ It is NOT the ceiling. Burn RATE converts to dollars differently per model — by a factor of
            // ~30 across the two bake-off candidates — which is precisely why ADR-0024 refuses to let this
            // stand in for the counter.
            reservedConcurrentExecutions: consumerConcurrency.reserved,
            environment: {
                ...commonDbEnv,
                ...sentryEnv,
                // REQUIRED by the handler, and load-bearing twice: it selects the prod-only ceiling and it is
                // the dimension every alarm below watches. A metric published under the wrong stage is a
                // metric no alarm sees.
                STAGE: props.stage,
                // U7: the gate claims a verification before reserving spend, and both bounds it needs are
                // facts about resources THIS stack owns — this function's own timeout, and the queue's own
                // `maxReceiveCount`. Passing them removes the second copy a handler-side default would be,
                // whose drift is silent: a lease above the visibility timeout refuses every genuine
                // redelivery, and an allowance above `maxReceiveCount` is never reached.
                VERIFICATION_CLAIM_LEASE_SECONDS: String(VERIFICATION_WORKER_TIMEOUT.toSeconds()),
                VERIFICATION_ATTEMPT_ALLOWANCE: String(CLAIM_ATTEMPT_ALLOWANCE),
            },
            logGroup,
        });

        // batchSize 1: one message is one ingredient line, so a DLQ message maps to exactly one unverified
        // line — and a partial-batch failure would otherwise re-call (and re-pay for) lines already verified.
        verificationFn.addEventSource(
            new lambda_event_sources.SqsEventSource(verificationQueue, {
                batchSize: 1,
                // Spread rather than a literal `undefined`: CDK renders a present-but-undefined property as
                // an empty `ScalingConfig`, which is a diff on every non-prod stack for no behaviour.
                ...(consumerConcurrency.maximumConcurrency === undefined
                    ? {}
                    : { maxConcurrency: consumerConcurrency.maximumConcurrency }),
            }),
        );

        // ── the service parse leg (plan U8, origin R6/R13) ──────────────────────────────────────────
        //
        // One queue message is one parse-job line; the handler runs corrections → cache → CRF Lambda +
        // the GATED validator-looped LLM leg, and lands a digest-guarded proposal (R17/R19). ⛔ It runs
        // under the SAME verificationRole — D6's ruling and `llmSpendGuards`' single-grantee set — and
        // carries its own `reservedConcurrentExecutions: 1`: in ungated stages that constant is the only
        // bound on the parse leg's spend, exactly as it is for the gate (ADR-0024 layer 2).
        //
        // ⛔ FOURTEEN DAYS, NOT THE VERIFICATION DLQ's THREE — and the difference is a decision, recorded here
        // so nobody "aligns" the two. Four reasons, in order of how hard they are to reverse:
        //
        //  1. ⛔ SHORTENING IT IS DESTRUCTIVE ON THE DEPLOY THAT LANDS IT, not merely a policy change. AWS:
        //     changes to `MessageRetentionPeriod` "will impact existing messages in the queue potentially
        //     causing them to be expired and deleted if the MessageRetentionPeriod is reduced below the age
        //     of existing messages". A dead-lettered parse line older than three days would be deleted the
        //     moment such a deploy applied — silently, with the depth alarm going GREEN as the evidence.
        //  2. RETENTION IS ALARM DURATION here. Every DLQ in this stack carries an
        //     `ApproximateNumberOfMessagesVisible` alarm (asserted derivationally in the suite), and that
        //     metric only breaches while messages are still retained. Retention is therefore how long an
        //     un-redriven failure keeps paging, and a parse line that was never parsed should out-page a
        //     long weekend.
        //  3. The verification DLQ's argument does NOT transfer: a message IT drops costs one UNVERIFIED
        //     line, which publishes exactly as it did before that gate existed. A message dropped HERE is a
        //     line that was never parsed at all. And this leg's dead-letter causes are the unbounded ones its
        //     redrive comment names — an exhausted monthly ceiling, a CRF function never deployed to this
        //     stage — which take human time to notice and repair; on a `pr-{N}` or sandbox stage, easily
        //     longer than three days.
        //  4. Fourteen is what the archive, erasure and handle-sync DLQs use. The parse pair is the
        //     CONVENTION; the verification DLQ is the exception.
        //
        // ⛔ Do NOT shorten it on a privacy argument either. The one written on the verification DLQ above —
        // that a `sourceLine` sitting in a DLQ is "a copy of personal data outside every erasure path" — was
        // superseded four days after it was written: ADR-0027 (2026-08-25) records the owner's ruling that an
        // ingredient phrase is NOT personal data. This queue's message carries a phrase and an opaque
        // `userId` (`parseJobMessage.ts`), which is precisely the pairing that ADR retained deliberately.
        // ⛔ THREE NUMBERS THAT ONLY MEAN ANYTHING TOGETHER (U6), so they are declared together and each is
        // spelled once. The handler's timeout bounds one attempt; the visibility timeout must EXCEED it or
        // SQS redelivers work that is still running; the claim lease equals the handler timeout, so a
        // duplicate delivered mid-attempt is refused while a genuine redelivery — which can only arrive
        // after the visibility timeout — is admitted. The gap between the last two is the whole margin, and
        // it is invisible if the numbers live apart.
        const parseHandlerTimeout = Duration.seconds(150);
        const PARSE_QUEUE_VISIBILITY_TIMEOUT = Duration.seconds(180);
        // Sized to outlast a nightly stop (R2), NOT to bound real attempts — that is
        // `CLAIM_ATTEMPT_ALLOWANCE`, which counts claims rather than receives.
        const PARSE_QUEUE_MAX_RECEIVES = receivesSurvivingTheNightlyStop(PARSE_QUEUE_VISIBILITY_TIMEOUT);

        const parseDlq = new sqs.Queue(this, 'RecipeParseDlq', {
            enforceSSL: true,
            queueName: `kitchensink-recipe-parse-dlq-${props.stage}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14),
        });
        const parseQueue = new sqs.Queue(this, 'RecipeParseQueue', {
            // ⛔ enforceSSL RESTORES A RECORDED ADR-0013 OUTCOME. That ADR's burn-down #1 table reads
            // `SQS4 / SNS3 no TLS-only policy | 13 | 0 | FIXED`, measured across the seven prod apps — and
            // this pair put it back to 2, because the zero was a one-time COUNT with no mechanism behind it.
            // cdk-nag still reported `AwsSolutions-SQS4` against exactly these two resources, into this app's
            // advisory channel where nothing gates on it. The control is a resource-policy DENY on
            // `aws:SecureTransport: false`: a property of the QUEUE, not of the callers it happens to have
            // today. (Suppressing it was never the alternative — ADR-0013 requires every suppression to be
            // "its own reviewed change with its own diff".)
            enforceSSL: true,
            queueName: `kitchensink-recipe-parse-${props.stage}`,
            // `encryption` closes no live gap: AWS encrypts a NEW queue with SSE-SQS by default, and cdk-nag's
            // SSE rule fails only on an explicit `false`, so nothing was reporting this one. What the
            // declaration buys is CloudFormation OWNERSHIP — a queue's encryption CAN be turned off later, and
            // a declared property is restored by the next deploy where an undeclared one is not.
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            // ⛔ DECLARED, not inherited — and it is a DRY defect being closed, not a value being changed.
            // Four days is AWS's default for `MessageRetentionPeriod`, so this line moves nothing at runtime;
            // what it moves is WHO OWNS the number. The same four days is stated in prose twice — the redrive
            // comment below, and `PINNED_CONSUMER_REDELIVERY_FLOOR`'s docstring in the suite — as the bound
            // that makes `maxReceiveCount: 20` safe, and until now it was declared zero times, so the
            // authoritative copy of a load-bearing figure was a default nothing restores.
            //
            // ⚠️ This is the retention the redrive bound rests on. The DLQ's fourteen days is DOWNSTREAM of
            // it and participates in no bound — which is why the two do not conflict, and why the pair can
            // legitimately differ.
            retentionPeriod: Duration.days(4),
            // Worst case per line (KTD-F): up to 4 parse + 8 validator calls plus one CRF invoke. The
            // visibility timeout clears the handler's own (150s) with margin, the sibling queues' rule —
            // and that margin is what makes the redrive count below mean anything: a redelivery that could
            // land while the previous attempt is still running would buy retries of the SAME work.
            visibilityTimeout: PARSE_QUEUE_VISIBILITY_TIMEOUT,
            // ⛔ 20, NOT the 5 three of this stack's queues use, and NOT borrowed from the verification
            // queue's 20 — the number is the same, the derivation is this queue's own.
            //
            // 5 became wrong the day an invocation that produced NO ENGINE ANSWER started REJECTING rather
            // than being swallowed as a per-line `unavailable`. ADR-0026's 2026-08-31 update puts a failed
            // CRF invoke in the TRANSIENT set beside an ADR-0024 ceiling denial and a Bedrock transport
            // failure, on the ground that none of them is evidence about the ingredient — so exhausting the
            // redeliveries during an outage is exactly the "turn an outage into a permanent fact about a
            // line" the ADR forbids, arriving through the DLQ instead of through a stored answer.
            //
            // The size comes from two bounds this queue has and the verification queue does not:
            //  - `MAX_PARSE_JOB_LINES` is 200, one message per line, all enqueued at once and drained ONE at
            //    a time (`reservedConcurrentExecutions: 1`, batchSize 1). The last message of a full-size
            //    job waits out the whole job, and while it is throttled it burns roughly one receive per
            //    visibility-timeout cycle — so 5 gives a job's tail only ~15 minutes to be reached.
            //  - 20 × 180s ≈ 60 minutes: past a pessimistic 200-line drain and past a CRF deploy window,
            //    while still reaching the DLQ and its depth alarm well inside the queue's 4-day retention
            //    when the failure is unbounded (an exhausted monthly ceiling, a function that was never
            //    deployed). A DLQ arrival is the SIGNAL there, so a much larger count would only delay it.
            //
            // ⚠️ What makes this affordable rather than a spend risk is KTD-F's amplification bound, which
            // is the parse CACHE, not this number: `runParsePipeline` reads `ingredient_parse_cache` before
            // it asks any engine and remembers each engine's answer separately, so a redelivery after a CRF
            // outage re-invokes only the CRF — whichever engine answered is already stored, and no second
            // Bedrock call is billed (`crfAbsenceRetry.integration.test.ts` drives exactly that path).
            //
            // The RULE behind the number — a consumer pinned at one concurrent execution needs redelivery
            // headroom, because a throttled delivery still burns a receive count — is asserted once, derived
            // over the construct tree, in `RecipeWorkersStack.test.ts`. Do not copy it into a shared
            // constant with the verification queue: the two move for different reasons.
            deadLetterQueue: { queue: parseDlq, maxReceiveCount: PARSE_QUEUE_MAX_RECEIVES },
        });
        parseQueue.grantConsumeMessages(verificationRole);
        // The CRF Lambda lives in ANOTHER CDK app (ADR-0025); its name is deterministic per stage, so the
        // grant is by ARN rather than by construct — the same cross-app seam the SSM parameters use.
        const crfFunctionArn = Stack.of(this).formatArn({
            service: 'lambda',
            resource: 'function',
            resourceName: `kitchensink-ingredient-parser-${props.stage}`,
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        });
        verificationRole.addToPolicy(
            new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [crfFunctionArn] }),
        );

        const parseLineFn = new lambda.Function(this, 'RecipeParseLineFunction', {
            runtime,
            architecture,
            handler: 'handlers/parseLine.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: verificationRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: parseHandlerTimeout,
            memorySize: 512,
            // ADR-0024 layer 2, for the parse leg: the only spend bound in every ungated stage.
            reservedConcurrentExecutions: consumerConcurrency.reserved,
            environment: {
                ...commonDbEnv,
                ...sentryEnv,
                STAGE: props.stage,
                // U6: the handler claims a line before paying for engines, and both bounds it needs are
                // facts about resources THIS stack owns. Passing them removes the second copy a worker-side
                // default would create — a copy whose drift is silent, because a lease above the visibility
                // timeout refuses every genuine redelivery and an allowance above `maxReceiveCount` is never
                // reached.
                PARSE_CLAIM_LEASE_SECONDS: String(parseHandlerTimeout.toSeconds()),
                PARSE_DELIVERY_ALLOWANCE: String(CLAIM_ATTEMPT_ALLOWANCE),
                CRF_FUNCTION_NAME: `kitchensink-ingredient-parser-${props.stage}`,
                // ⚠️ The parser package's own `ingredient-parser-nlp` pin (ADR-0025), as a pip REQUIREMENT
                // SPECIFIER. The engine reports the BARE version (`importlib.metadata.version(...)`), so the
                // adapter reconciles the two through `parseEnginePin` — it does NOT compare these strings
                // directly, which it once did, refusing the CRF answer on every single invocation. Do not
                // "simplify" this to a bare `2.3.0`: this value is also the port's `engineVersion` and hence
                // part of the `ingredient_parse_cache` KEY, which `cookbook-import`'s sidecar writes in the
                // pinned form. See `src/parsing/crfInvoke.ts` and its `crfEngineVersionParity.test.ts`.
                //
                // Drift still fails safe (absence, never a mis-keyed cache row) and now fails LOUDLY: a
                // version mismatch publishes a `contract` absence on the availability series alarmed below.
                //
                // ⛔ BOTH of these literals are spelled a second time in ANOTHER CDK app, and nothing here
                // can join them: this stack invokes the parser by a hand-formatted ARN because the function
                // lives in `packages/services/ingredient-parser` (ADR-0025), so a rename or a version bump
                // applied to one app and not the other compiles, synthesizes and deploys clean. The guard is
                // `packages/infra/global/__tests__/crossAppParserIdentity.test.ts`, which reads both apps.
                CRF_ENGINE_VERSION: 'ingredient-parser-nlp==2.3.0',
            },
            logGroup,
        });
        parseLineFn.addEventSource(
            new lambda_event_sources.SqsEventSource(parseQueue, {
                batchSize: 1,
                ...(consumerConcurrency.maximumConcurrency === undefined
                    ? {}
                    : { maxConcurrency: consumerConcurrency.maximumConcurrency }),
            }),
        );

        // Cross-stack hand-off to recipe-service's parse-job PRODUCER (plan U9), by SSM for the reason the
        // erasure and verification parameters are: an imported CfnOutput export is LOCKED while referenced,
        // and ADR-0005's PR-close cleanup deletes a PR's stacks in no guaranteed order. Keyed on the DEPLOY
        // stage (never baseStage): a pr-{N} service must enqueue onto the pr-{N} queue, whose worker points
        // at the pr-{N} logical database (ADR-0006).
        new ssm.StringParameter(this, 'RecipeParseQueueUrlParam', {
            parameterName: `/kitchensink/${props.stage}/recipe/parse-queue-url`,
            stringValue: parseQueue.queueUrl,
        });
        new ssm.StringParameter(this, 'RecipeParseQueueArnParam', {
            parameterName: `/kitchensink/${props.stage}/recipe/parse-queue-arn`,
            stringValue: parseQueue.queueArn,
        });

        // ── band revocation drain (plan U3, R14) ────────────────────────────────────────────────────
        //
        // Revocation flips a band's state and enqueues NOTHING; `resolution_band_skips` is the backlog,
        // each row carrying the producer-built verification message verbatim. This scheduled drain sends
        // batches sized against the spend pool's REMAINING headroom, so an exhausted ceiling pauses the
        // drain instead of DLQ-ing thousands of re-verifications. ⛔ Its role has NO bedrock permission —
        // it produces for the gate, and the gate stays the single InvokeModel grantee (ADR-0024 §4b).
        verificationQueue.grantSendMessages(bandDrainRole);
        bandDrainRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['ssm:GetParameters'],
                resources: [ceilingParameterName, modelParameterName].map((name) =>
                    Stack.of(this).formatArn({ service: 'ssm', resource: 'parameter', resourceName: name.slice(1) }),
                ),
            }),
        );

        const bandDrainFn = new lambda.Function(this, 'BandDrainFunction', {
            runtime,
            architecture,
            handler: 'handlers/bandDrain.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: bandDrainRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(60),
            memorySize: 256,
            environment: {
                ...commonDbEnv,
                ...sentryEnv,
                INGREDIENT_VERIFICATION_QUEUE_URL: verificationQueue.queueUrl,
                // Selects the prod-only headroom sizing, and matches the gate's own stage key.
                STAGE: props.stage,
            },
            logGroup,
        });

        // Every 15 minutes: the drain is a background repayment plan, not a latency path. Each tick claims
        // at most a quarter of the remaining headroom, so the cadence bounds how fast a revoked epoch can
        // burn the shared pool far more than it bounds how fast the backlog empties.
        new events.Rule(this, 'BandDrainSchedule', {
            ruleName: `kitchensink-recipe-band-drain-${props.stage}`,
            schedule: events.Schedule.rate(Duration.minutes(15)),
            targets: [new events_targets.LambdaFunction(bandDrainFn)],
        });

        // ⛔ A SECOND MIGRATION RUNNER USED TO SIT HERE, and its absence is the decision.
        //
        // Every Lambda above reads `kitchensink_recipes`, and ADR-0022's answer was to give this stack its
        // OWN runner — a second copy of `recipe-service`'s bundle, reaching into another package's
        // `dist-lambda/` — purely so a `triggers.Trigger` could order these functions behind it.
        // CloudFormation's `DependsOn` cannot leave a stack, so there was no other way to express it, and
        // the result was two runners for ONE database, neither able to see the other stack's consumers.
        //
        // The schema now belongs to `kitchensink-recipe-schema-{stage}`, deployed and invoked by its own
        // pipeline step ahead of this stack AND ahead of the service. One runner ahead of everything orders
        // every consumer regardless of app or stack, which is strictly more than either barrier gave.
        //
        // ⚠️ THE PIPELINE ORDER IS UNCHANGED AND STILL LOAD-BEARING: this stack still deploys BEFORE
        // `RecipeServiceStack`, because it publishes the `account-erasure-queue-{url,arn}` SSM parameters
        // the service resolves at deploy time, and because a queue's CONSUMER must upgrade before its
        // PRODUCER. What moved is only the schema, which now precedes both.
        //
        // ⛔ Do NOT re-add a runner here. The EXPAND-FIRST discipline still binds: a migration must be safe
        // to apply while the previous release is still serving, so a contracting change ships a release
        // LATER than the code that stopped reading the column.

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
        // R3.2 / U11 — every alarm must reach a human. Absent address = no subscription, never a
        // synth failure: an account that has not configured a recipient must still deploy.
        subscribeAlarmEmail(alarmTopic, props.alertEmail);

        // ⛔ WITHOUT THIS EVERY ALARM BELOW FIRES AND REACHES NOBODY. `enforceSSL: true` above makes CDK
        // attach an `AWS::SNS::TopicPolicy`, which REPLACES the SNS DEFAULT document — and the statement it
        // replaces is the implicit account `Allow` that is the only reason a same-account CloudWatch alarm
        // could publish here at all. Nothing fails at deploy: the topic exists, the action is attached, the
        // diff is clean, and the sole symptom is an `Action  Failed to execute action` line in an alarm
        // history nobody reads. That is how a correctly-firing production crash-loop alarm stayed silent for
        // 14.2 days. `packages/infra/global/__tests__/alarmTopicPublishGrant.test.ts` carries the measured
        // account and asserts this grant on every alarm topic in the repository.
        alarmTopic.addToResourcePolicy(
            new iam.PolicyStatement({
                sid: 'AllowCloudWatchAlarmPublish',
                effect: iam.Effect.ALLOW,
                principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
                actions: ['sns:Publish'],
                resources: [alarmTopic.topicArn],
                // Confused-deputy guard, mirroring `CostGuardrailsStack`'s budgets/cost-anomaly grants: only
                // CloudWatch acting for THIS account may publish to this topic.
                conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
            }),
        );
        const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);

        // ⛔ THE ALARMS ARE GATED; THE TOPIC ABOVE IS NOT — CloudWatch bills per alarm above a 10-alarm free
        // tier this account is already over, while SNS bills per publish, so a topic nothing publishes to
        // costs nothing. Gating it would thread an `SnsAction | undefined` through every alarm for $0. The
        // reasoning and the enforcement live in `packages/infra/global/__tests__/alarmFeatureFlag.test.ts`.
        //
        // ⚠️ SEVENTEEN alarms sit in this one block — the largest concentration in the repository, and the
        // reason a `pr-{N}` preview alone provisioned ten. FR-007b-i and ADR-0024's layer 4 still REQUIRE
        // every one of them in the stage that is actually running the pipeline; none is deleted here.
        if (props.alarmsEnabled) {
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

            // ── verification alarms (ADR-0024 layers 4 and 0) ──────────────────────────────────────────
            //
            // ⛔ Layer 4 detects counter BUGS, not a bypass (see `spendMetrics.ts`). The bypass control is the IAM
            // grant above.
            //
            // It alarms at HALF the ceiling, is dollar-denominated, and routes to a notification rather than a
            // kill switch: at $100 maximum exposure an automated remediation Lambda costs more to build and carry
            // than the loss it prevents.
            const spendAlarm = new cloudwatch.Alarm(this, 'VerificationSpendAlarm', {
                alarmName: `kitchensink-recipe-verification-spend-${props.stage}`,
                alarmDescription:
                    'ADR-0024 layer 4: the LLM verification gate has reserved more than half its monthly ceiling. Dollar-denominated, app-scoped, and emitted by the gated path — so this measures counter bugs and real volume, never a bypass.',
                metric: new cloudwatch.Metric({
                    namespace: VERIFICATION_METRIC_NAMESPACE,
                    metricName: 'VerificationSpendMicros',
                    dimensionsMap: { Stage: props.stage },
                    statistic: 'Maximum',
                    period: Duration.minutes(5),
                }),
                threshold: DEFAULT_MONTHLY_CEILING_MICROS / 2,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            spendAlarm.addAlarmAction(alarmAction);

            // A settle that failed left a reservation unrefunded, so the counter over-reports until the month
            // rolls. ADR-0024 asks for this metric by name ("emit a metric when settle fails so unrefunded
            // reservations are observable rather than silent"). Sum, not Maximum: several in a window matter.
            const settleFailureAlarm = new cloudwatch.Alarm(this, 'VerificationSettleFailureAlarm', {
                alarmName: `kitchensink-recipe-verification-settle-${props.stage}`,
                alarmDescription:
                    'A verification settlement failed, so a worst-case reservation stands unrefunded. The counter now over-reports; repeated failures mean the ceiling will bind early.',
                metric: new cloudwatch.Metric({
                    namespace: VERIFICATION_METRIC_NAMESPACE,
                    metricName: 'VerificationSettleFailures',
                    dimensionsMap: { Stage: props.stage },
                    statistic: 'Sum',
                    period: Duration.minutes(5),
                }),
                threshold: 0,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            settleFailureAlarm.addAlarmAction(alarmAction);

            // ⛔ THE ALARM THAT KEEPS LAYER 1 HONEST. The reservation is priced from an input-token bound computed
            // as UTF-8 BYTES plus a chat-template allowance, because no byte-fallback tokenizer emits more than
            // one token per byte. That is a claim about the tokenizers we know of, not a theorem — a tokenizer
            // that normalises before encoding, a template costing more than the allowance, or an unmeasured model
            // would each beat it. And the counter cannot report it: `settleDeltaMicros` is unclamped, so an
            // overshoot is simply charged and disappears into the month's total. ADR-0024 §2 makes the input cap a
            // PRECONDITION of the ceiling ("if prompt length is unbounded, the reservation is a lie"), so a bound
            // that is being exceeded is a ceiling that is not holding — and this is the only thing that says so.
            // Sum over 5 minutes, threshold 0: one occurrence is a real answer about the bound.
            const inputBoundAlarm = new cloudwatch.Alarm(this, 'VerificationInputBoundAlarm', {
                alarmName: `kitchensink-recipe-verification-input-bound-${props.stage}`,
                alarmDescription:
                    'A gated Bedrock call was billed MORE input tokens than its reservation was priced for. ADR-0024 layer 1 treats the input bound as a precondition of the ceiling, so the reservation is under-charging: re-derive the token bound for this prompt and model before trusting the counter.',
                metric: new cloudwatch.Metric({
                    namespace: VERIFICATION_METRIC_NAMESPACE,
                    // ⛔ MUST EQUAL `INPUT_BOUND_EXCEEDED_METRIC_NAME` in `src/common/spendMetrics.ts`, mirrored as
                    // a literal exactly as the namespace and the two alarms above are — CloudWatch matches by
                    // exact string, so a change here is a change there in the same commit.
                    metricName: 'VerificationInputBoundExceeded',
                    // ⚠️ `Stage` ALONE, deliberately — the same rule the spend alarm follows. The metric is
                    // emitted with a `CallSite` dimension too, but EMF publishes each dimension SET separately;
                    // selecting `Stage` here watches the aggregate across every consumer, where selecting both
                    // would watch one series and miss the others entirely.
                    dimensionsMap: { Stage: props.stage },
                    statistic: 'Sum',
                    period: Duration.minutes(5),
                }),
                threshold: 0,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            inputBoundAlarm.addAlarmAction(alarmAction);

            // ⛔ THE ALARM THAT MAKES LAYER 2 SAFE TO KEEP. `reservedConcurrentExecutions: 1` plus an SQS event
            // source means a backlog produces THROTTLED deliveries, and a throttled delivery still increments a
            // message's receive count. Without this, the only symptom of an over-tight concurrency setting is
            // messages arriving in the DLQ having never run — which reads as a model failure. Raised
            // `maxReceiveCount` buys the headroom; this makes the cause visible.
            const throttleAlarm = new cloudwatch.Alarm(this, 'VerificationThrottlesAlarm', {
                alarmName: `kitchensink-recipe-verification-throttles-${props.stage}`,
                alarmDescription:
                    'The verification gate is being throttled by its own reserved concurrency. Throttled SQS deliveries still burn a message’s receive count, so a sustained backlog drains to the DLQ without ever executing.',
                metric: verificationFn.metricThrottles({ period: Duration.minutes(5), statistic: 'Sum' }),
                threshold: 0,
                evaluationPeriods: 3,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            throttleAlarm.addAlarmAction(alarmAction);

            // A message here is one line the gate never checked. Not a compliance incident (the line publishes
            // unverified, i.e. today's behaviour) but it is how an exhausted ceiling becomes VISIBLE — ADR-0024:
            // "an exhausted ceiling drains to the DLQ, where it is visible as queue depth instead of as silently
            // degraded recipes".
            const verificationDlqAlarm = new cloudwatch.Alarm(this, 'IngredientVerificationDlqAlarm', {
                alarmName: `kitchensink-recipe-verification-dlq-${props.stage}`,
                alarmDescription:
                    'Ingredient lines exhausted their verification retries. Check the spend ceiling, the Bedrock model parameter, and the throttle alarm before assuming a model problem.',
                metric: verificationDlq.metricApproximateNumberOfMessagesVisible({
                    period: Duration.minutes(5),
                    statistic: 'Maximum',
                }),
                threshold: 0,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            verificationDlqAlarm.addAlarmAction(alarmAction);

            // ADR-0024 §5: prompt caching cannot engage at ~660 input tokens on any candidate, so this should be
            // zero forever. A non-zero value means the prompt grew past a cache threshold and the cost model needs
            // re-deriving — the counter would still be correct, but the rate table's assumptions would not be.
            const cacheTokenAlarm = new cloudwatch.Alarm(this, 'VerificationCacheTokensAlarm', {
                alarmName: `kitchensink-recipe-verification-cache-${props.stage}`,
                alarmDescription:
                    'A verification response reported prompt-cache tokens, which ADR-0024 §5 says cannot happen at this prompt size. The prompt has grown past a cache threshold and the cost model needs revisiting.',
                metric: new cloudwatch.Metric({
                    namespace: VERIFICATION_METRIC_NAMESPACE,
                    metricName: 'VerificationCacheTokensObserved',
                    dimensionsMap: { Stage: props.stage },
                    statistic: 'Sum',
                    period: Duration.minutes(5),
                }),
                threshold: 0,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            cacheTokenAlarm.addAlarmAction(alarmAction);

            // ⛔ ADR-0024 §4b — THE ONLY TRACE A RESIDENCY REFUSAL LEAVES. When `planReservation` refuses a model
            // whose inference profile leaves this region uncleared, the gate acknowledges the message and the
            // parse leg lands nothing: no verdict row, no reservation, no throw. So DLQ depth stays flat, Lambda
            // `Errors` stays flat, and `VerificationSpendMicros` merely goes quiet — which is what a slow hour
            // looks like. Every leg would be dark with every other alarm green.
            //
            // ⚠️ AND THE `logger.error` BESIDE THE EMISSION IS NOT A SUBSTITUTE: this package has no
            // `logs.SubscriptionFilter` and no metric filter anywhere. The repository's only log drain is
            // `WebhooksStack`'s, whose three targets are the webhook Lambda, the API access log and the identity
            // ECS service — nothing forwards a recipe-workers log line to Sentry or to anything else.
            //
            // Zero forever, like `VerificationCacheTokensAlarm`: the SSM seed is Nova Micro and the parse pin is
            // Nova Lite v1, both residency-clear, and `parseLine.test.ts` keeps the latter that way. A datapoint
            // means a model id now points somewhere 016 has not cleared, and the remedy is a model id — never a
            // retry, because the refusal is deterministic in (model, region).
            const residencyRefusedAlarm = new cloudwatch.Alarm(this, 'VerificationResidencyRefusedAlarm', {
                alarmName: `kitchensink-recipe-verification-residency-${props.stage}`,
                alarmDescription:
                    'A Bedrock call was refused because the model is not cleared to leave the deploy region (ADR-0024 §4b). Nothing is being verified or parsed on that leg; the remedy is a model id, not a retry.',
                metric: new cloudwatch.Metric({
                    namespace: VERIFICATION_METRIC_NAMESPACE,
                    metricName: 'VerificationResidencyRefused',
                    // ⚠️ `Stage` ALONE, per the emitter's `[['Stage'], ['Stage','CallSite']]` dimension sets: the
                    // rollup catches whichever leg went dark, where a faceted selector would watch only one.
                    dimensionsMap: { Stage: props.stage },
                    statistic: 'Sum',
                    period: Duration.minutes(5),
                }),
                threshold: 0,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            residencyRefusedAlarm.addAlarmAction(alarmAction);

            // ── the parse leg's own alarms (the DETECTION half of the never-deployed CRF defect) ───────
            //
            // ⛔ WHAT THESE EXIST FOR. `kitchensink-ingredient-parser-{stage}` had never been deployed to any
            // stage while this stack shipped `RecipeParseLineFunction` into every one of them, pointing
            // `CRF_FUNCTION_NAME` at it with an IAM grant to its ARN. Nothing went red: the adapter mapped the
            // failed invoke to per-line absence, ADR-0026 §3 reads absence as `single-engine llm`, and the
            // two-engine pipeline halved itself behind green checks — while the UNGATED pr-{N} LLM leg quietly
            // absorbed the work. `cdkAppDeployCoverage.test.ts` closed the deploy half; this closes detection.
            //
            // ⛔ AND IT IS NOT ADR-0024 LAYER 4'S SHAPE. That metric is emitted BY the gated path, so a caller
            // who skips the gate emits nothing and layer 4 cannot see it — the ADR says so about itself. This
            // one is emitted by the CALLER on BOTH paths (0 answered, 1 absent), so an engine that is entirely
            // GONE produces a POSITIVE datapoint rather than an absence of datapoints. The 0s are what keep a
            // healthy stage distinguishable from an idle one; the 1s are what make a vanished engine loud.
            //
            // ⛔ AND THE SERIES ALREADY CARRIES ADR-0026 §3'S DISTINCTION, so the alarm does not have to. A line
            // the engine READ and declined publishes a 0: only systemic absence — the function is gone, the
            // grant does not cover it, it crashed at import, it broke the engine contract — ever publishes a 1.
            // That is why a plain count is the right shape here and a failure RATIO is not: the ratio was
            // defending a distinction the classification had already made, and it cost the alarm its ability to
            // fire (see CRF_UNAVAILABLE_THRESHOLD).
            const crfUnavailableAlarm = new cloudwatch.Alarm(this, 'CrfEngineUnavailableAlarm', {
                alarmName: `kitchensink-recipe-parse-crf-unavailable-${props.stage}`,
                alarmDescription:
                    'CRF invocations are coming back with no engine answer, so the two-engine parse pipeline is ' +
                    'running on the LLM alone (and, in an ungated stage, paying Bedrock for it). Check that ' +
                    'kitchensink-ingredient-parser-{stage} exists, that the parse role may invoke it, that it is ' +
                    'not failing at import, and that CRF_ENGINE_VERSION matches what it reports.',
                metric: new cloudwatch.Metric({
                    namespace: PARSE_METRIC_NAMESPACE,
                    metricName: CRF_UNAVAILABLE_METRIC_NAME,
                    dimensionsMap: { Stage: props.stage },
                    statistic: 'Sum',
                    period: Duration.minutes(5),
                }),
                threshold: CRF_UNAVAILABLE_THRESHOLD,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                // ⚠️ The reason this alarm is not sufficient ON ITS OWN, and why the DLQ alarm below is its
                // partner rather than a duplicate: a count needs traffic to have datapoints, and an idle stage
                // has none. Missing periods are not breaching (an idle parse queue must not page), so on a quiet
                // stage the LATCH is the DLQ — one line, retried out, visible until a human drains it.
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            crfUnavailableAlarm.addAlarmAction(alarmAction);

            // A message here is one line that exhausted its retries. Under the transient/terminal split
            // (ADR-0026, 2026-08-31) an engine outage RETRIES rather than landing, so a sustained outage drains
            // to this queue — which is ADR-0024's own phrasing for the verification DLQ, "visible as queue depth
            // instead of as silently degraded recipes", applied to the leg that had no such alarm at all.
            const parseDlqAlarm = new cloudwatch.Alarm(this, 'RecipeParseDlqAlarm', {
                alarmName: `kitchensink-recipe-parse-dlq-${props.stage}`,
                alarmDescription:
                    'Parse-job lines exhausted their retries. Check the CRF availability alarm and the parse ' +
                    'throttle alarm before assuming a model problem — an outage in either engine retries here.',
                metric: parseDlq.metricApproximateNumberOfMessagesVisible({
                    period: Duration.minutes(5),
                    statistic: 'Maximum',
                }),
                threshold: 0,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            parseDlqAlarm.addAlarmAction(alarmAction);

            // ── the parse pipeline's two SILENT failures ────────────────────────────────────────────────
            //
            // ⛔ WHAT THIS ONE EXISTS FOR. `parseLine.ts` logs `parse landing discarded — the stored line
            // moved on` whenever the digest-guarded landing UPDATE matches zero rows. That went from ~11% of
            // landings to 99.9% and ran ~780/hour for three days (2026-09-11 → 09-13) with NO metric and NO
            // alarm — the only record was a `logger.info` nobody queries. What the cook sees is an import
            // that never completes: the line stays `pending`, the job never reaches a terminal aggregate,
            // and it is discarded 24 hours later with no error and nothing to click.
            //
            // ⛔ AND IT IS A RATE, WHICH IS WHY THE EMITTER PUBLISHES ON BOTH OUTCOMES. A count cannot tell
            // an incident from a busy day, because the discard is a NORMAL outcome — R17 guards the landing
            // on the STORED digest, so every line edited after enqueue legitimately discards the message its
            // edit superseded. `parseLine.ts` therefore emits `1` on a discard and `0` on a landing, so ONE
            // series carries both numbers: `Sum` is the discards and `SampleCount` is the attempts.
            //
            // ⛔ THE VOLUME FLOOR IS THE OTHER HALF. A bare ratio fires on one-of-one. `IF(attempts >= 20,
            // …, 0)` declines to judge a window with too little evidence, and the THREE-ARG form is
            // deliberate: it yields a definite `0` below the floor, which reads the same as healthy and does
            // not rest on how CloudWatch treats a missing else-branch. With no traffic at all `attempts`
            // has no datapoint, the expression has none, and `NOT_BREACHING` covers it — so an idle parse
            // queue is silent by two independent mechanisms.
            //
            // ACTION WHEN IT FIRES: an import is silently failing. Query the stage's recipe database for
            // `recipe_parse_job_lines` rows still `pending` on a `running` job, and compare each line's
            // stored `line_digest` against the digest of its `source_line`. A mismatch on lines nobody
            // edited means the producer and the handler disagree about the digest — check for a release
            // that changed `lineDigest` or the text normalisation feeding it. Matching digests point at the
            // claim statement instead.
            const discardedSeries = (statistic: string): cloudwatch.Metric =>
                new cloudwatch.Metric({
                    namespace: PARSE_METRIC_NAMESPACE,
                    metricName: PARSE_LANDING_DISCARDED_METRIC_NAME,
                    dimensionsMap: { Stage: props.stage },
                    statistic,
                    period: Duration.minutes(5),
                });
            const discardRateAlarm = new cloudwatch.Alarm(this, 'RecipeParseLandingDiscardAlarm', {
                alarmName: `kitchensink-recipe-parse-landing-discarded-${props.stage}`,
                alarmDescription:
                    'More than half of parse landings are being discarded: imports are silently never ' +
                    'completing. Compare each pending line’s stored line_digest against the digest of its ' +
                    'source_line — a mismatch on lines nobody edited means the producer and the parse ' +
                    'handler disagree about the digest.',
                metric: new cloudwatch.MathExpression({
                    expression: `IF(attempts >= ${PARSE_DISCARD_MIN_ATTEMPTS}, 100 * (discards / attempts), 0)`,
                    usingMetrics: {
                        discards: discardedSeries('Sum'),
                        attempts: discardedSeries('SampleCount'),
                    },
                    period: Duration.minutes(5),
                    label: 'Parse landings discarded (%)',
                }),
                threshold: PARSE_DISCARD_RATE_THRESHOLD_PERCENT,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                // Fifteen minutes. The incident sustained its rate for three days, so three consecutive
                // windows costs nothing in detection time and removes any chance of paging on one window in
                // which a cook happened to edit a handful of lines.
                evaluationPeriods: 3,
                datapointsToAlarm: 3,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            discardRateAlarm.addAlarmAction(alarmAction);

            // ⛔ AND THE STALL ITSELF, which the rate alarm above CANNOT see. A discard is one way a line
            // fails to land; a refused residency, a silenced engine and a lost message are others, and none
            // of them produces a discard datapoint at all. What they share is the OUTCOME — a job left
            // `running` until `PARSE_JOB_TTL_HOURS` discards it a day later — so this watches the outcome
            // rather than enumerating the causes.
            //
            // ⛔ `BREACHING`, the OPPOSITE of its neighbour, and the difference is the series rather than
            // the preference. The rate is a ratio over traffic: no traffic, no judgement. This gauge is read
            // on the band drain's 15-minute tick and publishes `0` when nothing is stalled, so its series is
            // continuous by construction — which means an absence is not "quiet", it is the sweeper having
            // stopped running, and that failure hides every parse failure behind it.
            //
            // ⛔ WHICH IS WHY IT IS 2-OF-3 AND NOT 1-OF-1, and the reasoning is about THIS series, not about
            // the neighbour it borrows the treatment from. `IdentityServiceStack`'s crash-loop alarm also
            // uses `BREACHING`, but it reads a 1-minute AWS-PUBLISHED series at 3-of-3 — three consecutive
            // missing minutes. Transplanting the treatment without the cadence is what 1-of-1 was: a single
            // absent datapoint became a page, on a SELF-published gauge whose emitter is allowed to miss.
            // Three things each produce one absent window on a healthy system — `Schedule.rate(15 minutes)`
            // is not aligned to CloudWatch period boundaries and jitters across them; `publishParseStallGauge`
            // SWALLOWS its own read failure by design; and one Lambda throttle or cold-start overrun skips a
            // tick. 2-of-3 tolerates any single one of those and still fires on a real stall within 45
            // minutes, against a threshold of one hour and a TTL of twenty-four. A pager that cries wolf
            // gets muted, and this is the only detector for the silent-stall class.
            //
            // ⚠️ The accepted cost of BREACHING: a stage whose band-drain schedule is deliberately stopped
            // pages. Nothing stops it today — ADR-0007's nightly shutdown zeroes ECS desired counts, not
            // EventBridge rules — but a future maintenance switch would have to disable this alarm with it.
            //
            // ACTION WHEN IT FIRES: find the `running` jobs older than an hour and look at their `pending`
            // lines. Check `RecipeParseDlqAlarm` and `CrfEngineUnavailableAlarm` first — an engine outage
            // retries and lands nothing, which presents here as a stall. Lines with a high `attempts` count
            // are being redelivered; lines with none were never claimed, which points at the queue rather
            // than the handler. `POST /api/v1/recipes/parse-jobs/{id}/retry` re-drives failed_retryable
            // lines once the cause is fixed.
            const parseStallAlarm = new cloudwatch.Alarm(this, 'RecipeParseJobStallAlarm', {
                alarmName: `kitchensink-recipe-parse-job-stall-${props.stage}`,
                alarmDescription:
                    'A parse job has been running for over an hour: the cook’s import will expire at its ' +
                    '24-hour TTL having told them nothing. Check the parse DLQ and CRF availability alarms ' +
                    'first — an engine outage retries and lands nothing, which presents as a stall.',
                metric: new cloudwatch.Metric({
                    namespace: PARSE_METRIC_NAMESPACE,
                    metricName: PARSE_JOB_STALL_METRIC_NAME,
                    dimensionsMap: { Stage: props.stage },
                    statistic: 'Maximum',
                    period: Duration.minutes(15),
                }),
                threshold: PARSE_JOB_STALL_THRESHOLD_SECONDS,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: 3,
                datapointsToAlarm: 2,
                treatMissingData: cloudwatch.TreatMissingData.BREACHING,
            });
            parseStallAlarm.addAlarmAction(alarmAction);

            // The parse leg carries the same `reservedConcurrentExecutions: 1` the gate does, so it inherits the
            // same trap: a throttled SQS delivery still burns a message's receive count, and a backlog drains to
            // the DLQ having never run. Without this, that now reads as a CRF failure — the two have to be
            // tellable apart, which is precisely what the gate's own throttle alarm is for one function over.
            const parseThrottleAlarm = new cloudwatch.Alarm(this, 'RecipeParseThrottlesAlarm', {
                alarmName: `kitchensink-recipe-parse-throttles-${props.stage}`,
                alarmDescription:
                    'The parse leg is being throttled by its own reserved concurrency. Throttled SQS deliveries ' +
                    'still burn a message’s receive count, so a sustained backlog drains to the DLQ without ever ' +
                    'executing — and emits no CRF availability datapoint while doing it.',
                metric: parseLineFn.metricThrottles({ period: Duration.minutes(5), statistic: 'Sum' }),
                threshold: 0,
                evaluationPeriods: 3,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            parseThrottleAlarm.addAlarmAction(alarmAction);

            // The handle-sync DLQ had no alarm either — found by the DERIVED "every DLQ has a depth alarm" guard
            // in this stack's suite, not by anyone reading the list. A rename that dead-letters here is a
            // denormalized author handle that never propagated: the recipe keeps serving the OLD handle, which is
            // the erasure/pseudonymization path's own residue problem, silently.
            const handleSyncDlqAlarm = new cloudwatch.Alarm(this, 'HandleSyncDlqAlarm', {
                alarmName: `kitchensink-recipe-handle-sync-dlq-${props.stage}`,
                alarmDescription:
                    'Handle-sync messages exhausted their retries, so denormalized author handles are stale on ' +
                    'every recipe those renames touched.',
                metric: this.handleSyncDlq.metricApproximateNumberOfMessagesVisible({
                    period: Duration.minutes(5),
                    statistic: 'Maximum',
                }),
                threshold: 0,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            handleSyncDlqAlarm.addAlarmAction(alarmAction);
        }

        // Cross-stack hand-off to recipe-service's producer, by SSM for the reason the erasure queue is:
        // an imported CfnOutput export is LOCKED while referenced, and ADR-0005's PR-close cleanup deletes a
        // PR's stacks in no guaranteed order.
        new ssm.StringParameter(this, 'IngredientVerificationQueueUrlParam', {
            parameterName: `/kitchensink/${props.stage}/recipe/verification-queue-url`,
            stringValue: verificationQueue.queueUrl,
        });
        new ssm.StringParameter(this, 'IngredientVerificationQueueArnParam', {
            parameterName: `/kitchensink/${props.stage}/recipe/verification-queue-arn`,
            stringValue: verificationQueue.queueArn,
        });
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
        // ── THE SCHEDULED BACKSTOP (plan U12, R29/R30/R32/R34/R36) ──────────────────────────────────────
        //
        // ⛔ EVERY OTHER GUARANTEE IN THIS STACK LIVES IN A PRODUCER OR A CONSUMER, so every one of them fails
        // SILENTLY. A parse line whose claim is never released, a verification whose attempt row outlives its
        // allowance, an outbox row the sweeper stopped sending, a message on a DLQ nobody opened — the rows
        // sit there looking owed, and no alarm in this stack is shaped to see the difference between that and
        // a queue that is simply busy. This function is the only thing that reads the rows AND the transport
        // together, which is the only way to tell "slow" from "lost".
        //
        // ⛔ ITS OWN ROLE, holding `sqs:GetQueueAttributes` and NOTHING ELSE on these queues. A backstop that
        // could receive would take a message from the consumer it is watching; one that could delete or purge
        // could destroy the evidence it exists to report. `queueProducerRegister.test.ts` asserts the whole
        // authority set in both directions, so widening it is a failing test rather than a review comment.
        const queueCheckRole = makeRole(
            'QueueCheckRole',
            'Least-privilege role for the scheduled queue backstop (DB read + queue attributes only)',
        );
        grantRdsIam(queueCheckRole);

        // ⛔ `grant` with ONE action, never `grantConsumeMessages`. The bundled grant would read as innocuous
        // ("it only needs to look at the queue") while handing this role `ReceiveMessage` and `DeleteMessage`
        // on every queue in the stack — and a bundled grant is exactly what U12's verification is written to
        // catch, because the register records the authority, not the intent behind it.
        //
        // ⚠️ WRITTEN OUT, not looped. `queueProducerRegister.test.ts` reads these calls as
        // `<subject>.<method>(<grantee>)` and holds the whole set to a register by exact equality in both
        // directions — a loop over an array collapses eight authorities into one anonymous `queue.grant(…)`,
        // and a ninth queue could then join the check's reach without the register changing at all. The
        // repetition IS the enumeration the guard is built to read.
        parseQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes');
        parseDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes');
        verificationQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes');
        verificationDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes');
        this.archiveQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes');
        this.archiveDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes');
        this.handleSyncQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes');
        this.handleSyncDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes');

        const queueCheckFn = new lambda.Function(this, 'QueueCheckFunction', {
            runtime,
            architecture,
            handler: 'handlers/queueCheck.handler',
            code: lambda.Code.fromAsset(DIST_PATH),
            role: queueCheckRole,
            vpc,
            vpcSubnets,
            securityGroups: [lambdaSecurityGroup],
            // Five bounded indexed reads and eight queue attribute calls. Generous against a cold start and a
            // first connection, and far inside the 5-minute schedule below.
            timeout: Duration.seconds(60),
            memorySize: 512,
            // ⛔ ONE AT A TIME. Two concurrent runs would read the same rows and raise the same escalation
            // twice, and a backstop that double-reports is a backstop whose counts nobody trusts.
            reservedConcurrentExecutions: 1,
            environment: {
                ...commonDbEnv,
                ...sentryEnv,
                STAGE: props.stage,
                RECIPE_PARSE_QUEUE_URL: parseQueue.queueUrl,
                RECIPE_PARSE_DLQ_URL: parseDlq.queueUrl,
                INGREDIENT_VERIFICATION_QUEUE_URL: verificationQueue.queueUrl,
                INGREDIENT_VERIFICATION_DLQ_URL: verificationDlq.queueUrl,
                RECIPE_ARCHIVE_QUEUE_URL: this.archiveQueue.queueUrl,
                RECIPE_ARCHIVE_DLQ_URL: this.archiveDlq.queueUrl,
                RECIPE_HANDLE_SYNC_QUEUE_URL: this.handleSyncQueue.queueUrl,
                RECIPE_HANDLE_SYNC_DLQ_URL: this.handleSyncDlq.queueUrl,
                // ⛔ THE SAME VALUES THE CONSUMERS GET, from the same constants, for the reason those
                // constants exist: a backstop measuring "claimed too long" against a different window than
                // the consumer leases on reports rows as stuck that the consumer is about to finish, or
                // misses rows it gave up on an hour ago — and both readings look equally authoritative.
                PARSE_CLAIM_LEASE_SECONDS: String(parseHandlerTimeout.toSeconds()),
                VERIFICATION_CLAIM_LEASE_SECONDS: String(VERIFICATION_WORKER_TIMEOUT.toSeconds()),
                VERIFICATION_ATTEMPT_ALLOWANCE: String(CLAIM_ATTEMPT_ALLOWANCE),
                TEST_RESET_STALE_SECONDS: String(TEST_RESET_STALE.toSeconds()),
            },
            logGroup,
        });

        // The rate is `QUEUE_CHECK_INTERVAL` — see its docstring for why it is not imported.
        new events.Rule(this, 'QueueCheckSchedule', {
            schedule: events.Schedule.rate(QUEUE_CHECK_INTERVAL),
            targets: [new events_targets.LambdaFunction(queueCheckFn)],
        });

        new CfnOutput(this, 'VersionArchiveWorkerName', { value: workerFn.functionName });
        new CfnOutput(this, 'ArchiveSweeperName', { value: sweeperFn.functionName });
        new CfnOutput(this, 'AccountErasureWorkerName', { value: erasureFn.functionName });
        // Diagnostic outputs only — deliberately NO `exportName`, so nothing can `Fn.importValue` them and
        // reintroduce the cross-stack lock the SSM hand-off above exists to avoid.
        new CfnOutput(this, 'AccountErasureQueueUrl', { value: this.erasureQueue.queueUrl });
        new CfnOutput(this, 'AccountErasureDlqUrl', { value: this.erasureDlq.queueUrl });
        new CfnOutput(this, 'ErasureSweeperName', { value: erasureSweeperFn.functionName });
        new CfnOutput(this, 'ErasureOrphanSweeperName', { value: orphanSweeperFn.functionName });

        // ⛔ A MIGRATION-RUNNER OUTPUT USED TO BE PUBLISHED HERE, and it is gone with the runner it named.
        //
        // It began as a per-PR database drop door: `teardownSandboxPr.sh` §1 discovered doors across a
        // PR's own stacks by the shape `^[A-Za-z]+MigrationFunctionName$`, and this stack published one
        // because `RecipeServiceStack`'s was not reliably present — the service deploys SECOND, behind two
        // hard-failing steps, and a PR wedged in `UPDATE_ROLLBACK_FAILED` carried a database this stack's
        // runner had already CREATED and no door to drop it with.
        //
        // That whole mechanism was repointed to `PerPrDatabaseReaperFunction` in `DataStack` (ADR-0031),
        // for the general form of the same problem: a door inside the stack whose database it drops is
        // unreachable exactly when it is needed. Reclamation is the reaper's, and the one remaining
        // migration output — `kitchensink-recipe-schema-{stage}`'s — exists to make the schema reachable for
        // MIGRATION, not for teardown.
    }
}
