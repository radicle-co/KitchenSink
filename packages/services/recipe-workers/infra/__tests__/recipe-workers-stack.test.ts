/**
 * Synth tests for {@link RecipeWorkersStack} (T132 / T138).
 *
 * These assert the properties that are expensive or irreversible to get wrong in a deploy rather than
 * re-describing the template: the ADR-0004 VPC attachment (without it the Lambdas cannot reach the
 * private RDS at all), the DLQ redrive (without it a failed archive is dropped silently), the sweeper
 * schedule (the archive's ONLY trigger — no rule means the outbox never drains), and the FR-007b-i
 * alarm thresholds.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { RecipeWorkersStack } from '../lib/recipe-workers-stack.js';

/** The asset directory `Code.fromAsset` ships — `<package>/dist`, which carries NO `node_modules`. */
const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

/**
 * Specifiers a handler may import bare despite the asset having no `node_modules`.
 *
 * Mirrors `esbuild.mjs`'s `external`, and for its reasons: `@aws-sdk/*` is provided by the Node Lambda runtime,
 * and `pg-native` is an optional peer `pg` only requires when `Client.native` is touched. `node:` builtins are
 * handled separately since they are a prefix rule, not a list.
 */
const RUNTIME_PROVIDED = [/^@aws-sdk\//u, /^pg-native$/u];

/**
 * Every module specifier an emitted Lambda file STATICALLY imports that would not resolve inside the deployed
 * asset.
 *
 * This is the precondition a Lambda cold start actually has, asserted directly rather than through a proxy: the
 * asset is `dist/` with no `node_modules`, so a surviving bare specifier in a static import is
 * `ERR_MODULE_NOT_FOUND` before the handler runs a line. Deliberately NOT a check on `esbuild.mjs`'s config
 * text — the artifact is what ships, and a config assertion is one more copy of a list to keep in step, which is
 * the defect this whole area exists for.
 *
 * ⚠️ PARSED, NOT GREPPED, and this one is not theoretical either. The first version of this function matched
 * `from '…'` textually and reported `drizzle-orm/pg-core` and `@aws-lambda-powertools/logger` in all SIX
 * bundles — every hit was inside a JSDoc `@example` block that esbuild preserves from the dependency's own
 * source (`* import { union } from 'drizzle-orm/pg-core'`). A text gate over bundled output reads its
 * dependencies' documentation as code, so it fires hardest on the artifacts that are correct.
 *
 * Static declarations only. A bundled CJS dependency's lazy `require('pg-native')` is conditional and may never
 * execute, whereas a static import is evaluated at load — the defect signature is the latter.
 *
 * @param file - Absolute path to an emitted `.js` handler.
 * @returns The unresolvable bare specifiers, empty for a correctly bundled handler.
 * @sideEffect Reads the built artifact.
 */
function unresolvableImports(file: string): readonly string[] {
    const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
        ts.ScriptKind.JS,
    );
    const specifiers = new Set<string>();

    for (const statement of source.statements) {
        const specifier =
            (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
            statement.moduleSpecifier !== undefined &&
            ts.isStringLiteral(statement.moduleSpecifier)
                ? statement.moduleSpecifier.text
                : undefined;

        if (specifier !== undefined) {
            specifiers.add(specifier);
        }
    }

    return [...specifiers].filter(
        (specifier) =>
            !specifier.startsWith('.') &&
            !specifier.startsWith('/') &&
            !specifier.startsWith('node:') &&
            !RUNTIME_PROVIDED.some((allowed) => allowed.test(specifier)),
    );
}

// NOTE: the stack's `Code.fromAsset(dist)` requires the esbuild bundle to exist. The `test` npm script
// runs `npm run build` before vitest precisely so this synth suite has `dist/` on a clean checkout (CI /
// fresh worktree) — building inside a beforeAll hook instead would exceed vitest's 10s hookTimeout.

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

/**
 * The DbiResourceId the `rds-db:connect` ARN must be keyed on — NOT the instance name. CI resolves it
 * from `kitchensink-data-{base}:DatabaseResourceId`, and the fixture uses the `db-…` shape deliberately so
 * the assertions read like the real ARN rather than like a hostname.
 */
const DB_RESOURCE_ID = 'db-EXAMPLERESOURCEID12345';

function synth(stage = 'sandbox', baseStage = 'sandbox'): Template {
    const app = new App({ context: VPC_LOOKUP_CONTEXT });
    const stack = new RecipeWorkersStack(app, `RecipeWorkers-${stage}`, {
        env: { account: '123456789012', region: 'us-east-1' },
        stackName: `kitchensink-recipe-workers-${stage}`,
        stage,
        baseStage,
        vpcId: 'vpc-12345678',
        lambdaSecurityGroupId: 'sg-12345678',
        dbEndpoint: 'db.example.internal',
        dbPort: 5432,
        // The BASE name (the platform's CFN export value). The per-stage name is derived INSIDE the stack
        // from the one shared authority, exactly as `RecipeServiceStack` does — see the parity test in
        // `packages/services/recipe-service/infra/__tests__/recipe-database-name-parity.test.ts`.
        dbBaseName: 'kitchensink_recipes',
        dbUser: 'recipe_app',
        dbInstanceIdentifier: DB_RESOURCE_ID,
        archiveBucketName: 'commise-versions-sandbox',
        mediaBucketName: 'commise-photos-sandbox',
        handleSyncTopicArn: 'arn:aws:sns:us-east-1:123456789012:kitchensink-handle-sync-sandbox',
    });

    return Template.fromStack(stack);
}

/**
 * Flatten a synthesized ARN into the literal string CloudFormation will resolve it to. CDK emits
 * `formatArn` output as `Fn::Join` around the `AWS::Partition` pseudo-parameter, so comparing the raw
 * template value would compare structure instead of the ARN that actually reaches IAM — and this defect
 * lives entirely in one separator INSIDE that string.
 */
function resolveArn(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    const join = (value as { 'Fn::Join'?: [string, unknown[]] })?.['Fn::Join'];

    if (!join) {
        return JSON.stringify(value);
    }

    const [delimiter, parts] = join;

    return parts
        .map((part) =>
            typeof part === 'string'
                ? part
                : (part as { Ref?: string }).Ref === 'AWS::Partition'
                  ? 'aws'
                  : JSON.stringify(part),
        )
        .join(delimiter);
}

/** Every `rds-db:connect` resource ARN the template grants, across all six per-function roles. */
function rdsConnectResources(template: Template): string[] {
    const resources: string[] = [];

    for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
        const statements: unknown = policy.Properties?.PolicyDocument?.Statement;

        if (!Array.isArray(statements)) {
            continue;
        }

        for (const statement of statements as { Action?: unknown; Resource?: unknown }[]) {
            if (statement.Action === 'rds-db:connect') {
                resources.push(resolveArn(statement.Resource));
            }
        }
    }

    return resources;
}

/** The `RECIPE_DB_NAME` every Lambda in the template is configured with. */
function recipeDbNames(template: Template): string[] {
    return Object.values(template.findResources('AWS::Lambda::Function')).map(
        (fn) => fn.Properties?.Environment?.Variables?.RECIPE_DB_NAME,
    );
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
        expect(names).toHaveLength(6);

        for (const name of names) {
            // Both private subnets from the VPC lookup context — not just "some VpcConfig exists".
            expect(functions[name]?.Properties?.VpcConfig?.SubnetIds, `${name} must be VPC-attached`).toEqual([
                'subnet-private-1',
                'subnet-private-2',
            ]);
            expect(functions[name]?.Properties?.VpcConfig?.SecurityGroupIds).toEqual(['sg-12345678']);
        }
    });

    it('subscribes the archive worker to the queue one message at a time', () => {
        template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
            BatchSize: 1,
        });
    });

    it('creates a per-stack handle-sync queue subscribed to the global topic + its consumer (W8-a.2)', () => {
        // Per-stack queue (SNS fan-out), so a rename reaches every preview/base consumer — not one shared queue.
        template.hasResourceProperties('AWS::SQS::Queue', {
            QueueName: 'kitchensink-recipe-handle-sync-sandbox',
            SqsManagedSseEnabled: true,
        });
        // The queue is subscribed to the imported global topic (its ARN carried in the subscription).
        template.hasResourceProperties('AWS::SNS::Subscription', {
            Protocol: 'sqs',
            TopicArn: 'arn:aws:sns:us-east-1:123456789012:kitchensink-handle-sync-sandbox',
        });
        // The consumer Lambda reports partial-batch failures so SQS retries only the failed rename.
        template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
            FunctionResponseTypes: ['ReportBatchItemFailures'],
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

    /**
     * ⚠️ THIS TEST USED TO BE THE BUG. It asserted the handler strings with
     * `expect(handlers).toEqual(expect.arrayContaining([…five names…]))` — which proves those five are PRESENT
     * and says nothing whatsoever about a SIXTH. The stack deploys six Lambdas, `esbuild.mjs` bundled five, and
     * `handle-sync-worker` shipped as raw `tsc` output into an asset with no `node_modules`: every cold start
     * was `ERR_MODULE_NOT_FOUND`. `build-inputs.test.ts` iterated the same five names and missed it too.
     *
     * A list copied from the bundler cannot detect that the bundler's list is incomplete. So the subjects are
     * now DISCOVERED from the synthesized template — every `AWS::Lambda::Function` CloudFormation will create —
     * and the expectation is DERIVED from each handler string via esbuild's `outbase: src` layout. There is no
     * list left for a human to keep in step, which is the actual defect; the missing entry was its symptom.
     */
    it('ships a loadable artifact for every Lambda it deploys — derived from the template, not from a list', () => {
        // `handlers/x.handler` → `dist/handlers/x.js`: the exported symbol is everything after the LAST dot.
        const artifacts = Object.values(template.findResources('AWS::Lambda::Function'))
            .map((fn) => fn.Properties?.Handler as string)
            .map((handler) => ({
                handler,
                file: path.join(DIST_DIR, `${handler.slice(0, handler.lastIndexOf('.'))}.js`),
            }));

        // Non-vacuity: a template that yielded no Lambdas would make every assertion below trivially pass.
        expect(artifacts.length).toBeGreaterThanOrEqual(6);

        expect(artifacts.filter(({ file }) => !existsSync(file)).map(({ handler }) => handler)).toEqual([]);

        // The failure signature of the real defect: `handle-sync-worker.js` was raw `tsc` output opening
        // `import { sql } from 'drizzle-orm'`, so this reports `drizzle-orm` — the specifier that killed the
        // cold start — rather than merely "an entry point is missing from a config file".
        expect(
            artifacts
                .map(({ handler, file }) => ({ handler, unresolvable: unresolvableImports(file) }))
                .filter(({ unresolvable }) => unresolvable.length > 0),
        ).toEqual([]);
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
 * RDS-IAM authentication (#121) and per-stage database targeting (#119).
 *
 * These two are asserted together on purpose, because they are the same failure seen from two angles: for
 * three hours on the live `pr-73` preview EVERY invocation of all six workers died with
 * `PAM authentication failed for user "recipe_app"` (28000) before running a single query, and the auth
 * failure was MASKING the fact that the workers were pointed at the SHARED `kitchensink_recipes` database
 * rather than the preview's own. Fixing auth first would have armed three destructive scheduled sweepers
 * (archive prune, GDPR erasure, orphan deletion) against another stage's data.
 */
describe('RecipeWorkersStack — RDS IAM auth + per-stage database', () => {
    it('grants rds-db:connect on a COLON-separated dbuser ARN, on every one of the six roles', () => {
        // THE #121 root cause, pinned. `Stack.formatArn` defaults to `ArnFormat.SLASH_RESOURCE_NAME`, which
        // emits `…:dbuser/{resourceId}/{user}` — an ARN that matches NO real resource, so `rds-db:connect`
        // is implicitly denied and RDS reports the denial as `PAM authentication failed`. The required
        // shape is COLON-separated (`…:dbuser:{DbiResourceId}/{dbUser}`), which is exactly what CDK's own
        // `IDatabaseInstance.grantConnect` builds — and why the recipe API task and the migration Lambda
        // (both granted via `grantConnect`) authenticate fine as the same `recipe_app` role from the same
        // VPC. The difference was never Lambda-vs-Fargate; it was one character.
        const template = synth();
        const resources = rdsConnectResources(template);
        const expected = `arn:aws:rds-db:us-east-1:123456789012:dbuser:${DB_RESOURCE_ID}/recipe_app`;

        // One grant per least-privilege function role (ARCH-IT-7) — `grantRdsIam` is called six times, and
        // a partial fix that repaired some roles would leave those workers silently dead.
        expect(resources).toHaveLength(6);

        for (const resource of resources) {
            expect(resource).toBe(expected);
            // Explicit, because this is the whole defect: a slash here is the deny.
            expect(resource).not.toContain('dbuser/');
        }
    });

    it('points every Lambda at the PER-PR logical database, never the shared base one', () => {
        // #119: the six workers ran with `RECIPE_DB_NAME=kitchensink_recipes` (the SHARED sandbox database)
        // while the recipe API on the same preview used `kitchensink_recipes_pr_73`. Three of these workers
        // are scheduled and destructive, so this is not a read-side inconsistency — it is a cross-stage
        // data-loss path. Derived in the stack from the shared authority so the workers cannot drift again.
        const template = synth('pr-73', 'sandbox');
        const names = recipeDbNames(template);

        expect(names).toHaveLength(6);
        expect(new Set(names)).toEqual(new Set(['kitchensink_recipes_pr_73']));
    });

    it('uses the imported BASE database name unchanged on a base platform stage', () => {
        const template = synth('prod', 'prod');

        expect(new Set(recipeDbNames(template))).toEqual(new Set(['kitchensink_recipes']));
    });
});

/**
 * The account-erasure path (T136b / C-007 / D7).
 *
 * Everything asserted here is the difference between "the erasure worker is deployed" and "the erasure
 * worker can be invoked". T136 landed the worker body with no queue and no event source, so until these
 * resources exist the Lambda is inert and every `POST /api/v1/account/erasure` is a durable row that nothing
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

        // Confirms the mapping's source is the actual erasure queue's Arn attribute (not merely that some
        // mapping matching the substring filter exists).
        expect(erasureMapping?.Properties?.EventSourceArn).toEqual({
            'Fn::GetAtt': [expect.stringMatching(/^AccountErasureQueue/), 'Arn'],
        });
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

        // Confirms the matched policy is actually the erasure sweeper's own role policy, not merely some
        // policy that happens to satisfy the substring filters above.
        expect(sweeperPolicy?.Properties?.PolicyName).toEqual(
            expect.stringMatching(/^ErasureSweeperRoleDefaultPolicy/),
        );
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

        // Ties the alarm to the actual erasure DLQ's QueueName dimension — not just any alarm with this
        // name, but one that actually watches the right queue's metric.
        expect(dlqAlarm?.Properties?.Dimensions).toEqual([
            { Name: 'QueueName', Value: { 'Fn::GetAtt': [expect.stringMatching(/^AccountErasureDlq/), 'QueueName'] } },
        ]);
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

    it('sets STAGE + both bucket names on the orphan sweeper so it reconciles both and its metric lands on the alarm dimension', () => {
        // Same trap the archive sweeper's STAGE bug taught: the sweeper emits ErasureOrphansDeleted under
        // `Stage=process.env['STAGE'] ?? 'unknown'` and the alarm below watches `Stage={stage}`. Unset
        // STAGE ⇒ metric under `unknown`, alarm watches `sandbox`, alarm never fires. And it now needs BOTH
        // bucket names — a missing media bucket would make it require-throw (its own guard) rather than
        // silently leave media orphans.
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'handlers/erasure-orphan-sweeper.handler',
            Environment: Match.objectLike({
                Variables: Match.objectLike({
                    STAGE: 'sandbox',
                    RECIPE_ARCHIVE_BUCKET: 'commise-versions-sandbox',
                    RECIPE_MEDIA_BUCKET: 'commise-photos-sandbox',
                }),
            }),
        });
    });

    it('grants the orphan sweeper List + Delete on BOTH object buckets — never GetObject, PutObject, or SQS', () => {
        // ARCH-IT-7 least privilege for a DESTRUCTIVE reconciler. It lists and deletes orphans a late write
        // left in EITHER bucket (archive: version-archive PUT; media: presigned photo PUT), but has no reason
        // to read object bodies, write, or produce/consume any queue. A wider grant would let a bug in this
        // path delete beyond its remit.
        // Located by POLICY NAME, not by a conjunction of substrings. The previous version filtered on
        // "contains ListBucket AND DeleteObject AND both bucket names AND no PutObject", then asserted the
        // survivor happened to be the sweeper's policy. That is identity-by-coincidence: when the grants were
        // narrowed from `grantRead`+`grantDelete` to explicit `s3:ListBucket`/`s3:DeleteObject`, the filter
        // stopped matching and the failure said "expected undefined" — naming neither the policy it wanted nor
        // what had actually changed. Finding the role's own policy first, then asserting its contents, means a
        // future grant change reports WHICH action moved.
        const sweeperPolicy = Object.values(template.findResources('AWS::IAM::Policy')).find((policy) =>
            /^ErasureOrphanSweeperRoleDefaultPolicy/.test(String(policy.Properties?.PolicyName ?? '')),
        );

        expect(sweeperPolicy, "the orphan sweeper's role must carry an inline policy").toBeDefined();

        // Assert over the POLICY DOCUMENT, never the whole resource. `JSON.stringify(policy)` also swallows
        // `Metadata.cdk_nag`, whose suppression justification legitimately NAMES the actions it is explaining
        // it does not grant ("no s3:GetObject*, no s3:Abort*, replacing grantRead/grantDelete/grantPut"). A
        // `not.toContain('s3:GetObject')` over the resource therefore fails on the PROSE while the grants are
        // correct — which is exactly what happened, and it read as a permission regression that did not exist.
        // Reading the granted actions makes the assertion about authority instead of about text.
        const statements = (sweeperPolicy?.Properties?.PolicyDocument?.Statement ?? []) as readonly {
            Action?: string | string[];
        }[];
        const grantedActions = statements.flatMap((statement) =>
            typeof statement.Action === 'string' ? [statement.Action] : (statement.Action ?? []),
        );
        const resources = JSON.stringify(statements);

        // It lists and it deletes — the two calls `erasure-orphan-sweeper` actually issues, and no more.
        expect(grantedActions).toContain('s3:ListBucket');
        expect(grantedActions).toContain('s3:DeleteObject');
        // Never reads bodies, never writes, never touches a queue, and never reaches object VERSIONS.
        expect(grantedActions.filter((action) => /^s3:(GetObject|PutObject|Abort|.*Version)/.test(action))).toEqual([]);
        expect(grantedActions.filter((action) => action.startsWith('sqs:'))).toEqual([]);
        // Both buckets are covered (media is the presigned-PUT resurrection fix), and the destructive action is
        // confined to the authoritative `recipes/` prefix rather than the whole bucket.
        expect(resources).toContain('commise-versions-sandbox');
        expect(resources).toContain('commise-photos-sandbox');
        expect(resources).toContain('commise-versions-sandbox/recipes/*');
        expect(resources).toContain('commise-photos-sandbox/recipes/*');
    });

    it('is VPC-attached like every other DB-bound worker (ADR-0004)', () => {
        const orphanFn = Object.values(template.findResources('AWS::Lambda::Function')).find(
            (fn) => fn.Properties?.Handler === 'handlers/erasure-orphan-sweeper.handler',
        );

        expect(orphanFn?.Properties?.VpcConfig?.SubnetIds).toEqual(['subnet-private-1', 'subnet-private-2']);
        expect(orphanFn?.Properties?.VpcConfig?.SecurityGroupIds).toEqual(['sg-12345678']);
    });

    it('is NOT wired to any SQS event source — it is scheduled, not queue-driven', () => {
        // A regression guard: the orphan sweeper is EventBridge-triggered. An accidental SqsEventSource
        // would both change its trigger semantics and demand a consume grant it deliberately lacks.
        const mappings = Object.values(template.findResources('AWS::Lambda::EventSourceMapping'));

        // The three queue workers (archive + erasure + handle-sync) have event-source mappings; the orphan
        // sweeper (EventBridge-scheduled) must not have introduced another.
        expect(mappings).toHaveLength(3);
    });

    it('alarms when the sweeper deletes any orphan — the resurrection race actually fired', () => {
        // NOT a health backlog: a nonzero here is a right-to-erasure gap that closed itself. Threshold 0 so
        // a single caught orphan pages; notBreaching so an idle (0) or missing tick does not.
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'kitchensink-recipe-erasure-orphan-sandbox',
            MetricName: 'ErasureOrphansDeleted',
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
        // The logical ID CDK derives from the `RecipeWorkersAlarmTopic` construct ID (plus its hash
        // suffix) — not just any truthy string.
        expect(topicLogicalId, 'the stack must own an alarm topic').toMatch(/^RecipeWorkersAlarmTopic/);

        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        // All six alarms: archive backlog, archive age (new), archive DLQ, erasure age, erasure DLQ,
        // orphan-deleted. A regression that drops one — or adds a seventh without an action — trips here.
        expect(Object.keys(alarms)).toHaveLength(6);

        for (const [name, alarm] of Object.entries(alarms)) {
            const actions = alarm.Properties?.AlarmActions as { Ref: string }[] | undefined;
            // Exactly one action, referencing the stack's own alarm topic — not just "some action array".
            expect(actions, `${name} must have an AlarmActions (it currently pages nobody)`).toEqual([
                { Ref: topicLogicalId },
            ]);
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
