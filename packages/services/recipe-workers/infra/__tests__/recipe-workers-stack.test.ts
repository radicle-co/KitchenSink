/**
 * Synth tests for {@link RecipeWorkersStack} (T132 / T138).
 *
 * These assert the properties that are expensive or irreversible to get wrong in a deploy rather than
 * re-describing the template: the ADR-0004 VPC attachment (without it the Lambdas cannot reach the
 * private RDS at all), the DLQ redrive (without it a failed archive is dropped silently), the sweeper
 * schedule (the archive's ONLY trigger — no rule means the outbox never drains), and the FR-007b-i
 * alarm thresholds.
 */
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { RecipeWorkersStack } from '../lib/recipe-workers-stack.js';

// The stack's `Code.fromAsset(dist)` throws if the esbuild bundle is absent (see recipe-workers-stack.ts).
// `turbo run test` does not build first and no CI job builds recipe-workers before the test job, so on a
// clean checkout (CI, or a freshly-cloned worktree) `dist/` is missing and every synth here would fail.
// Build it once, guarded — a no-op when `dist/` already exists (the local dev loop), one fast esbuild pass
// otherwise. Keeps this synth suite self-contained rather than depending on task ordering.
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function ensureDistBuilt(): void {
    if (existsSync(path.join(PKG_ROOT, 'dist'))) {
        return;
    }
    execSync('npm run build', { cwd: PKG_ROOT, stdio: 'inherit' });
}

// Pre-seed the VPC lookup so `Vpc.fromLookup` resolves during synth instead of calling AWS.
const VPC_LOOKUP_CONTEXT = {
    'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true': {
        vpcId: 'vpc-12345678',
        vpcCidrBlock: '10.0.0.0/16',
        ownerAccountId: '123456789012',
        availabilityZones: [],
        subnetGroups: [
            {
                name: 'Private',
                type: 'Private',
                subnets: [
                    {
                        subnetId: 'subnet-private-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-private-1',
                        cidr: '10.0.1.0/24',
                    },
                    {
                        subnetId: 'subnet-private-2',
                        availabilityZone: 'us-east-1b',
                        routeTableId: 'rtb-private-2',
                        cidr: '10.0.2.0/24',
                    },
                ],
            },
        ],
    },
};

function synth(stage = 'sandbox'): Template {
    ensureDistBuilt();
    const app = new App({ context: VPC_LOOKUP_CONTEXT });
    const stack = new RecipeWorkersStack(app, `RecipeWorkers-${stage}`, {
        env: { account: '123456789012', region: 'us-east-1' },
        stackName: `kitchensink-recipe-workers-${stage}`,
        stage,
        vpcId: 'vpc-12345678',
        lambdaSecurityGroupId: 'sg-12345678',
        dbEndpoint: 'db.example.internal',
        dbPort: 5432,
        dbName: 'kitchensink_recipes',
        dbUser: 'recipe_app',
        dbInstanceIdentifier: 'kitchensink-db-sandbox',
        archiveBucketName: 'commise-versions-sandbox',
        mediaBucketName: 'commise-photos-sandbox',
    });

    return Template.fromStack(stack);
}

describe('RecipeWorkersStack', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('gives the archive queue a DLQ after 5 failed receives', () => {
        // Without redrive, a version that cannot be archived is retried forever or dropped — either way
        // silently. The DLQ is what turns "this snapshot never reached S3" into an alarmable event.
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'kitchensink-recipe-archive-sandbox',
            RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
        });
    });

    it('retains DLQ messages for 14 days so a failed archive survives a weekend', () => {
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'kitchensink-recipe-archive-dlq-sandbox',
            MessageRetentionPeriod: 14 * 24 * 60 * 60,
        });
    });

    it('VPC-attaches every Lambda (ADR-0004 — they read the private RDS)', () => {
        // The load-bearing infra assertion. A Lambda outside the VPC cannot reach the private RDS at
        // all, and `assignPublicIp` does NOT give a VPC Lambda egress (that is a Fargate-only lever) —
        // these are precisely the DB-bound NAT consumers ADR-0004 documents.
        const functions = template.findResources('AWS::Lambda::Function');
        const names = Object.keys(functions);
        expect(names).toHaveLength(5);

        for (const name of names) {
            expect(functions[name]?.Properties?.VpcConfig, `${name} must be VPC-attached`).toBeDefined();
            expect(functions[name]?.Properties?.VpcConfig?.SecurityGroupIds).toEqual(['sg-12345678']);
        }
    });

    it('subscribes the archive worker to the queue one message at a time', () => {
        template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
            BatchSize: 1,
        });
    });

    it('schedules the sweeper — the outbox has NO other drain trigger', () => {
        // recipe-service never enqueues (a save must not depend on SQS, FR-007b-i), so without this rule
        // nothing ever turns an outbox row into a message and versions accumulate un-archived forever.
        template.hasResourceProperties('AWS::Events::Rule', {
            ScheduleExpression: 'rate(1 minute)',
            State: 'ENABLED',
        });
    });

    it('points each Lambda at its real bundled handler', () => {
        const handlers = Object.values(template.findResources('AWS::Lambda::Function')).map(
            (fn) => fn.Properties?.Handler,
        );

        // These strings must match esbuild's outbase:src layout, or the deploy succeeds and every
        // invocation fails at runtime with "Cannot find module".
        expect(handlers).toEqual(
            expect.arrayContaining([
                'handlers/version-archive-worker.handler',
                'handlers/archive-sweeper.handler',
                'handlers/account-erasure-worker.handler',
                'handlers/erasure-sweeper.handler',
                'handlers/erasure-orphan-sweeper.handler',
            ]),
        );
    });

    it('alarms when the backlog exceeds 100 for 15 minutes (FR-007b-i)', () => {
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            MetricName: 'PendingArchiveBacklog',
            Namespace: 'Commise/RecipeArchive',
            Threshold: 100,
            // 3 x 5-minute periods = the 15-minute sustain the requirement names.
            EvaluationPeriods: 3,
            Period: 300,
            ComparisonOperator: 'GreaterThanThreshold',
        });
    });

    it('alarms on any DLQ message', () => {
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            MetricName: 'ApproximateNumberOfMessagesVisible',
            Threshold: 0,
            ComparisonOperator: 'GreaterThanThreshold',
        });
    });

    it('alarms when the oldest pending row passes an hour (the SECOND half of FR-007b-i, QE-001)', () => {
        // FR-007b-i names TWO archive conditions — the backlog over 100 AND "the oldest pending row older
        // than 1 hour". A single stuck row can age past the SLA while the count stays under 100, so the
        // backlog alarm cannot cover it. This age alarm was missing entirely (QE-001); without it a row
        // ages past the hour with zero signal. Same 3600s bound + Stage dimension the sweeper emits under.
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'kitchensink-recipe-archive-age-sandbox',
            MetricName: 'OldestPendingArchiveAgeSeconds',
            Namespace: 'Commise/RecipeArchive',
            Threshold: 3600,
            EvaluationPeriods: 1,
            ComparisonOperator: 'GreaterThanThreshold',
            TreatMissingData: 'notBreaching',
        });
    });

    it('sets STAGE on the archive sweeper so the backlog metric lands on the dimension the alarm watches', () => {
        // Regression guard for the original T132 bug: archive-sweeper.ts emits PendingArchiveBacklog under
        // `Stage=process.env['STAGE'] ?? 'unknown'`, and the FR-007b-i backlog alarm above watches the
        // `Stage={stage}` dimension. If STAGE is unset the metric publishes under `unknown`, the alarm
        // watches `sandbox`, and the spec-MUST alarm sits in INSUFFICIENT_DATA forever — silently. This
        // pins the env → dimension match so a future edit that drops STAGE fails here instead of in prod.
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'handlers/archive-sweeper.handler',
            Environment: Match.objectLike({ Variables: Match.objectLike({ STAGE: 'sandbox' }) }),
        });
    });

    it('grants the worker PutObject on the archive bucket but never SQS send', () => {
        // Least privilege (ARCH-IT-7): the worker consumes and archives. If it could send, a bug could
        // fan out archive work; the sweeper is the only producer.
        const policies = Object.values(template.findResources('AWS::IAM::Policy'));
        const workerPolicy = policies.find((policy) => JSON.stringify(policy).includes('commise-versions-sandbox'));

        expect(JSON.stringify(workerPolicy)).toContain('s3:PutObject');
    });

    it('names every resource per stage so a pr-{N} deploy cannot collide with sandbox', () => {
        const prTemplate = synth('pr-73');

        prTemplate.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'kitchensink-recipe-archive-pr-73' });
        prTemplate.hasResourceProperties('AWS::Events::Rule', {
            Name: 'kitchensink-recipe-archive-sweep-pr-73',
        });
    });
});

/**
 * The account-erasure path (T136b / C-007 / D7).
 *
 * Everything asserted here is the difference between "the erasure worker is deployed" and "the erasure
 * worker can be invoked". T136 landed the worker body with no queue and no event source, so until these
 * resources exist the Lambda is inert and every `POST /v1/account/erasure` is a durable row that nothing
 * ever drains.
 */
describe('RecipeWorkersStack — account erasure', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('gives the erasure queue a DLQ after 5 failed receives', () => {
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'kitchensink-recipe-account-erasure-sandbox',
            RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
        });
    });

    it('encrypts and retains the erasure pair like the archive pair', () => {
        // A message body here names a user (`ownerId`). SQS-managed encryption is what the archive pair
        // uses and there is no reason erasure gets less.
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'kitchensink-recipe-account-erasure-sandbox',
            SqsManagedSseEnabled: true,
        });
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'kitchensink-recipe-account-erasure-dlq-sandbox',
            SqsManagedSseEnabled: true,
            MessageRetentionPeriod: 14 * 24 * 60 * 60,
        });
    });

    it('sets the erasure queue visibility timeout ABOVE the erasure worker timeout', () => {
        // THE assertion of this task. The erasure worker runs up to 5 minutes — not the archive worker's
        // 60 seconds — so the archive pair's 2-minute visibility timeout would let SQS redeliver a
        // message while the first worker is still mid-erasure, putting two workers on one owner: the
        // `DELETE FROM recipes` transactions contend, both sweep the same S3 prefix, and the claim/attempt
        // bookkeeping double-counts. Derived from the template rather than hard-coded on both sides, so
        // raising the worker's timeout without raising the queue's fails here instead of in production.
        const erasureFn = Object.values(template.findResources('AWS::Lambda::Function')).find(
            (fn) => fn.Properties?.Handler === 'handlers/account-erasure-worker.handler',
        );
        const erasureQueue = Object.values(template.findResources('AWS::SQS::Queue')).find(
            (queue) => queue.Properties?.QueueName === 'kitchensink-recipe-account-erasure-sandbox',
        );

        expect(erasureFn?.Properties?.Timeout).toBe(300);
        expect(erasureQueue?.Properties?.VisibilityTimeout).toBeGreaterThan(erasureFn?.Properties?.Timeout);
    });

    it('subscribes the erasure worker to the erasure queue, one message at a time', () => {
        // Without this mapping the worker T136 landed is unreachable — the whole point of T136b.
        const mappings = Object.values(template.findResources('AWS::Lambda::EventSourceMapping'));
        const erasureMapping = mappings.find((mapping) =>
            JSON.stringify(mapping.Properties?.EventSourceArn).includes('AccountErasureQueue'),
        );

        expect(erasureMapping).toBeDefined();
        // batchSize 1 transfers from the archive worker and then some: one message is one LEGAL request,
        // so a DLQ message must map to exactly one owner's failed erasure. The worker also loops records
        // serially and throws on the first failure, so a batch would leave later records unattempted and
        // could blow the 5-minute timeout outright.
        expect(erasureMapping?.Properties?.BatchSize).toBe(1);
    });

    it('lets the erasure worker consume its queue but never send to it', () => {
        // ARCH-IT-7. The sweeper and the recipe API are the only producers; a worker that could send
        // could fan out erasure work from a bug in the most destructive code path in the system.
        const policies = Object.values(template.findResources('AWS::IAM::Policy'));
        const erasurePolicy = policies.find((policy) => JSON.stringify(policy).includes('commise-photos-sandbox'));
        const serialized = JSON.stringify(erasurePolicy);

        expect(serialized).toContain('sqs:ReceiveMessage');
        expect(serialized).toContain('sqs:DeleteMessage');
        expect(serialized).not.toContain('sqs:SendMessage');
    });

    it('lets the erasure sweeper send but never consume or touch a bucket', () => {
        const policies = Object.values(template.findResources('AWS::IAM::Policy'));
        const sweeperPolicy = policies.find((policy) => {
            const serialized = JSON.stringify(policy);

            return (
                serialized.includes('sqs:SendMessage') &&
                serialized.includes('AccountErasureQueue') &&
                !serialized.includes('VersionArchiveQueue')
            );
        });
        const serialized = JSON.stringify(sweeperPolicy);

        expect(sweeperPolicy).toBeDefined();
        expect(serialized).not.toContain('sqs:ReceiveMessage');
        expect(serialized).not.toContain('s3:DeleteObject');
    });

    it('schedules the erasure sweeper — the ONLY thing that recovers a stuck erasure', () => {
        // The service enqueues eagerly, so this rule is not the latency path; it is the durability path.
        // Without it, a job whose send failed (SQS outage) or whose message was lost sits `queued`
        // forever and the user's right-to-erasure request is silently never honoured.
        template.hasResourceProperties('AWS::Events::Rule', {
            Name: 'kitchensink-recipe-erasure-sweep-sandbox',
            ScheduleExpression: 'rate(5 minutes)',
            State: 'ENABLED',
        });
    });

    it('alarms when the oldest outstanding erasure passes an hour', () => {
        // NOT a copy of the archive's ">100 rows" alarm: erasure will never have 100 concurrent jobs, so
        // a count threshold could never fire — the same class of bug as measuring a batch-capped backlog.
        // ONE erasure stuck for an hour is already the incident, and age is the metric that says so.
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            MetricName: 'OldestErasureJobAgeSeconds',
            Namespace: 'Commise/RecipeErasure',
            Threshold: 3600,
            ComparisonOperator: 'GreaterThanThreshold',
            TreatMissingData: 'notBreaching',
        });
    });

    it('alarms on any message in the erasure DLQ', () => {
        // A message here means a right-to-erasure request exhausted its retries — a compliance incident,
        // not a backlog. The sweeper only ever writes `failed` after this has already fired, so a `failed`
        // job always has a paged human behind it.
        const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm'));
        const dlqAlarm = alarms.find(
            (alarm) => alarm.Properties?.AlarmName === 'kitchensink-recipe-account-erasure-dlq-sandbox',
        );

        expect(dlqAlarm).toBeDefined();
        expect(dlqAlarm?.Properties?.MetricName).toBe('ApproximateNumberOfMessagesVisible');
        expect(dlqAlarm?.Properties?.Threshold).toBe(0);
        expect(dlqAlarm?.Properties?.ComparisonOperator).toBe('GreaterThanThreshold');
    });

    it('publishes the queue URL + ARN to per-stage SSM for the recipe-service stack', () => {
        // The cross-stack hand-off. NOT a CfnOutput export: an `Fn.importValue` would lock this stack's
        // export while recipe-service imports it, and the ADR-0005 PR-close cleanup deletes a PR's stacks
        // with no ordering guarantee — workers-before-service would hit the export-in-use deadlock
        // ADR-0002 documents, unattended, in CI. An SSM parameter carries the same value with no lock.
        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: '/kitchensink/sandbox/recipe/account-erasure-queue-url',
            Type: 'String',
        });
        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: '/kitchensink/sandbox/recipe/account-erasure-queue-arn',
            Type: 'String',
        });
    });

    it('does NOT export the queue via CfnOutput exportName (no cross-stack lock)', () => {
        // Guards the decision above against a well-meaning "let's just export it" revert.
        const outputs = template.toJSON().Outputs ?? {};
        const erasureOutputs = Object.values<Record<string, unknown>>(outputs).filter((output) =>
            JSON.stringify(output).includes('AccountErasureQueue'),
        );

        expect(erasureOutputs.length).toBeGreaterThan(0);
        for (const output of erasureOutputs) {
            expect(output['Export']).toBeUndefined();
        }
    });

    it('names the erasure resources per stage so a pr-{N} deploy cannot drain sandbox erasures', () => {
        // The worst per-stage collision in the system: a shared queue would let a pr-73 worker (pointed at
        // the pr-73 logical DB, ADR-0006) receive a sandbox user's erasure message, find no job row, and
        // erase that owner's data out of the pr-73 database while the sandbox job stayed queued.
        const prTemplate = synth('pr-73');

        prTemplate.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'kitchensink-recipe-account-erasure-pr-73',
        });
        prTemplate.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'kitchensink-recipe-account-erasure-dlq-pr-73',
        });
        prTemplate.hasResourceProperties('AWS::Events::Rule', {
            Name: 'kitchensink-recipe-erasure-sweep-pr-73',
        });
        prTemplate.hasResourceProperties('AWS::SSM::Parameter', {
            Name: '/kitchensink/pr-73/recipe/account-erasure-queue-url',
        });
    });
});

/**
 * The archive-orphan sweep (the archive-resurrection backstop).
 *
 * The version-archive guard narrows the read→PUT window but cannot close it, so a snapshot can land under
 * an already-erased owner's archive prefix. These assert that the reconciliation Lambda that finally
 * closes that residual is actually deployed, scheduled, least-privileged, and alarmed — without any of
 * which the "true backstop" the guard's own comment promises does not exist.
 */
describe('RecipeWorkersStack — archive-orphan sweep', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('deploys the orphan sweeper pointed at its real bundled handler', () => {
        // Must match esbuild's outbase:src layout, or the deploy succeeds and every invocation fails at
        // runtime with "Cannot find module".
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'handlers/erasure-orphan-sweeper.handler',
        });
    });

    it('schedules the orphan sweeper hourly — the ONLY thing that closes the resurrection residual', () => {
        // Hourly, not the archive sweeper's every-minute: this is a backstop-of-a-backstop for a sub-ms,
        // already-rare race, not a latency path. Without the rule the residual is never reconciled and an
        // orphaned snapshot survives a right-to-erasure request indefinitely.
        template.hasResourceProperties('AWS::Events::Rule', {
            Name: 'kitchensink-recipe-erasure-orphan-sweep-sandbox',
            ScheduleExpression: 'rate(1 hour)',
            State: 'ENABLED',
        });
    });

    it('sets STAGE on the orphan sweeper so its metric lands on the dimension the alarm watches', () => {
        // Same trap the archive sweeper's STAGE bug taught: the sweeper emits ArchiveOrphansDeleted under
        // `Stage=process.env['STAGE'] ?? 'unknown'` and the alarm below watches `Stage={stage}`. Unset
        // STAGE ⇒ metric under `unknown`, alarm watches `sandbox`, alarm never fires.
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'handlers/erasure-orphan-sweeper.handler',
            Environment: Match.objectLike({ Variables: Match.objectLike({ STAGE: 'sandbox' }) }),
        });
    });

    it('grants the orphan sweeper List + Delete on the ARCHIVE bucket only — never media, GetObject, or SQS', () => {
        // ARCH-IT-7 least privilege for a DESTRUCTIVE reconciler. It lists and deletes archive orphans; it
        // has no reason to read object bodies, touch the media bucket (erased synchronously by the worker),
        // or produce/consume any queue. A wider grant would let a bug in this path delete beyond its remit.
        const policies = Object.values(template.findResources('AWS::IAM::Policy'));
        const sweeperPolicy = policies.find((policy) => {
            const serialized = JSON.stringify(policy);

            return (
                serialized.includes('s3:ListBucket') &&
                serialized.includes('s3:DeleteObject') &&
                serialized.includes('commise-versions-sandbox') &&
                // the archive-worker also has PutObject on this bucket; the orphan sweeper must not.
                !serialized.includes('s3:PutObject')
            );
        });
        const serialized = JSON.stringify(sweeperPolicy);

        expect(sweeperPolicy, 'a List+Delete-on-archive, no-Put policy must exist').toBeDefined();
        // Never the media bucket.
        expect(serialized).not.toContain('commise-photos-sandbox');
        // Never GetObject (it lists and deletes, it does not read bodies).
        expect(serialized).not.toContain('s3:GetObject');
        // Never any SQS — it is neither a producer nor a consumer.
        expect(serialized).not.toContain('sqs:');
    });

    it('is VPC-attached like every other DB-bound worker (ADR-0004)', () => {
        const orphanFn = Object.values(template.findResources('AWS::Lambda::Function')).find(
            (fn) => fn.Properties?.Handler === 'handlers/erasure-orphan-sweeper.handler',
        );

        expect(orphanFn?.Properties?.VpcConfig).toBeDefined();
        expect(orphanFn?.Properties?.VpcConfig?.SecurityGroupIds).toEqual(['sg-12345678']);
    });

    it('is NOT wired to any SQS event source — it is scheduled, not queue-driven', () => {
        // A regression guard: the orphan sweeper is EventBridge-triggered. An accidental SqsEventSource
        // would both change its trigger semantics and demand a consume grant it deliberately lacks.
        const mappings = Object.values(template.findResources('AWS::Lambda::EventSourceMapping'));

        // Only the two queue workers (archive + erasure) have event-source mappings; adding the orphan
        // sweeper must not have introduced a third.
        expect(mappings).toHaveLength(2);
    });

    it('alarms when the sweeper deletes any orphan — the resurrection race actually fired', () => {
        // NOT a health backlog: a nonzero here is a right-to-erasure gap that closed itself. Threshold 0 so
        // a single caught orphan pages; notBreaching so an idle (0) or missing tick does not.
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'kitchensink-recipe-erasure-orphan-sandbox',
            MetricName: 'ArchiveOrphansDeleted',
            Namespace: 'Commise/RecipeErasure',
            Threshold: 0,
            ComparisonOperator: 'GreaterThanThreshold',
            TreatMissingData: 'notBreaching',
        });
    });

    it('names the orphan-sweep resources per stage so a pr-{N} deploy cannot collide with sandbox', () => {
        const prTemplate = synth('pr-73');

        prTemplate.hasResourceProperties('AWS::Events::Rule', {
            Name: 'kitchensink-recipe-erasure-orphan-sweep-pr-73',
        });
        prTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'kitchensink-recipe-erasure-orphan-pr-73',
        });
    });
});

/**
 * Alarm notification wiring (QE-001 / T138).
 *
 * The gap this closes: every alarm in this stack previously fired into the void — no SNS topic, no
 * `addAlarmAction` anywhere — so FR-007b-i's "a CloudWatch alarm MUST fire" was satisfied on paper while
 * paging nobody. These assert the topic exists and that EVERY alarm routes to it, so a future alarm added
 * without an action fails here instead of silently going unnoticed in production.
 */
describe('RecipeWorkersStack — alarm notifications', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('creates exactly one per-stack SNS alarm topic (mirrors identity/food; not per-severity)', () => {
        // One topic for the whole stack, like the sibling service stacks — per-severity fan-out is
        // speculative routing (YAGNI); a subscriber filters on alarm name if it wants severity.
        const topics = template.findResources('AWS::SNS::Topic');
        expect(Object.keys(topics)).toHaveLength(1);
    });

    it('routes EVERY alarm to the SNS topic — no alarm may page nobody (the QE-001 defect)', () => {
        const topicLogicalId = Object.keys(template.findResources('AWS::SNS::Topic'))[0];
        expect(topicLogicalId, 'the stack must own an alarm topic').toBeDefined();

        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        // All six alarms: archive backlog, archive age (new), archive DLQ, erasure age, erasure DLQ,
        // orphan-deleted. A regression that drops one — or adds a seventh without an action — trips here.
        expect(Object.keys(alarms)).toHaveLength(6);

        for (const [name, alarm] of Object.entries(alarms)) {
            const actions = alarm.Properties?.AlarmActions as { Ref: string }[] | undefined;
            expect(actions, `${name} must have an AlarmActions (it currently pages nobody)`).toBeDefined();
            expect(
                actions?.some((action) => action.Ref === topicLogicalId),
                `${name} must page the SNS topic`,
            ).toBe(true);
        }
    });

    it('names the alarm topic per stage so a pr-{N} deploy is caught by ADR-0005 cleanup', () => {
        // The topic is implicitly named (displayName only), so its physical name derives from the
        // `kitchensink-recipe-workers-pr-73` stack — carrying pr-73, caught by the tag/name PR-close sweep.
        const prTemplate = synth('pr-73');
        prTemplate.hasResourceProperties('AWS::SNS::Topic', {
            DisplayName: 'Recipe workers alarms (pr-73)',
        });
    });
});
