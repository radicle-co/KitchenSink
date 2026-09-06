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

import { BEDROCK_MODEL_REGISTRY, residencyClearance } from '@kitchensink/recipe-core/spend/spend-arithmetic';

import { RecipeWorkersStack } from '../lib/RecipeWorkersStack.js';

/** The asset directory `Code.fromAsset` ships — `<package>/dist`, which carries NO `node_modules`. */
const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

/**
 * Every asset root this stack ships a Lambda from.
 *
 * ⚠️ ONE root now, where there were two. The second was recipe-service's migration bundle, which this stack
 * shipped a copy of so ADR-0022's in-deploy Trigger had a runner to order its Lambdas behind — the only way
 * to express that ordering while `DependsOn` cannot leave a stack. The schema belongs to
 * `RecipeSchemaStack` now, deployed and migrated ahead of this app, so this suite no longer depends on
 * whether a sibling package happened to have been bundled (which was green locally and red in CI).
 */
const BUNDLE_ROOTS = [DIST_DIR];

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

/**
 * Synthesize the stack.
 *
 * ⚠️ It used to take a `migrationBundlePath`, because this stack shipped a SECOND copy of recipe-service's
 * migration runner — the only way ADR-0022's in-deploy Trigger could order this app's DB-touching Lambdas,
 * since `DependsOn` cannot leave a stack. The schema now belongs to `RecipeSchemaStack`, deployed and
 * migrated by its own pipeline step ahead of this app, so the cross-package bundle dependency is gone and
 * this template no longer changes shape with the state of a sibling package's build output.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The platform stage it rides.
 * @returns The synthesized template.
 * @sideEffect Reads the bundle directories `Code.fromAsset` stages.
 */
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
        // `packages/services/recipe-service/infra/__tests__/recipeDatabaseNameParity.test.ts`.
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

/** One `bedrock:InvokeModel` statement, with its resources resolved to the literal ARNs IAM will see. */
interface BedrockStatement {
    readonly resources: readonly string[];
    /** The statement's `Condition` block, or `undefined` when it grants unconditionally. */
    readonly condition: unknown;
}

/**
 * Every `bedrock:InvokeModel` statement the template grants, across every role.
 *
 * Read from the whole template rather than from one role on purpose: a grant that MOVED to another role is
 * still a grant, and reading only the role this stack means to widen would be blind to exactly that.
 *
 * @param template - The synthesized template.
 * @returns One entry per statement, in template order.
 */
function bedrockStatements(template: Template): readonly BedrockStatement[] {
    const found: BedrockStatement[] = [];

    for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
        const statements: unknown = policy.Properties?.PolicyDocument?.Statement;

        if (!Array.isArray(statements)) {
            continue;
        }

        for (const statement of statements as { Action?: unknown; Resource?: unknown; Condition?: unknown }[]) {
            const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];

            if (!actions.includes('bedrock:InvokeModel')) {
                continue;
            }

            const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];

            found.push({ resources: resources.map(resolveArn), condition: statement.Condition });
        }
    }

    return found;
}

/** A synthesized CloudFormation resource, reduced to what these assertions read. */
interface SynthesizedResource {
    readonly Properties?: Record<string, unknown>;
    readonly DependsOn?: string | string[];
}

/**
 * Every Lambda in the template that is configured with a recipe logical database — i.e. every function
 * whose failure mode is "that schema is not there yet".
 *
 * ⚠️ BOTH spellings, on purpose. The six workers carry `RECIPE_DB_NAME` (their own env contract) and the
 * in-deploy migration runner carries `DB_NAME` (the contract `recipe-service`'s `lambdas/migrate/handler.ts`
 * reads). A guard that knew only one spelling would quietly stop covering whichever kind was added next —
 * and this set is the subject of the VPC, IAM, database-name and barrier assertions alike, so a gap here is
 * a gap in all four at once.
 *
 * @param template - The synthesized template.
 * @returns Logical id → the database name that function is configured with.
 */
function databaseBoundFunctions(template: Template): ReadonlyMap<string, string> {
    const found = new Map<string, string>();

    for (const [logicalId, fn] of Object.entries(template.findResources('AWS::Lambda::Function'))) {
        const variables = (fn as SynthesizedResource).Properties?.['Environment'] as
            { Variables?: Record<string, unknown> } | undefined;
        const name = variables?.Variables?.['RECIPE_DB_NAME'] ?? variables?.Variables?.['DB_NAME'];

        if (typeof name === 'string') {
            found.set(logicalId, name);
        }
    }

    return found;
}

/**
 * The recipe database name every database-bound Lambda in the template is configured with.
 *
 * ⚠️ REWRITTEN when the in-deploy barrier landed (it used to read `RECIPE_DB_NAME` off EVERY Lambda). The
 * stack now also deploys the migration runner, whose env contract is `DB_NAME`, plus CDK's own
 * custom-resource provider, which addresses no database at all — so the old form yielded `undefined`
 * entries and its `toHaveLength(6)` could only be repaired by shrinking what it looked at. Reading the
 * DERIVED database-bound set instead keeps the assertion total AND extends #119's guarantee to the runner,
 * where migrating one database while the workers read another would be the same defect through a new door.
 *
 * @param template - The synthesized template.
 * @returns The configured database names.
 */
function recipeDbNames(template: Template): string[] {
    return [...databaseBoundFunctions(template).values()];
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

    it('VPC-attaches every Lambda that reads the database (ADR-0004)', () => {
        // The load-bearing infra assertion. A Lambda outside the VPC cannot reach the private RDS at
        // all, and `assignPublicIp` does NOT give a VPC Lambda egress (that is a Fargate-only lever) —
        // these are precisely the DB-bound NAT consumers ADR-0004 documents.
        //
        // ⚠️ REWRITTEN when the in-deploy migration barrier landed. This asserted over EVERY
        // `AWS::Lambda::Function` with a literal `toHaveLength(6)`. The stack now also deploys the migration
        // runner (which reads the database and MUST be in the VPC) and CDK's own custom-resource provider
        // for the trigger (which reads nothing, calls only the Lambda API, and must NOT be forced into the
        // VPC — that would put it on the NAT for nothing, ADR-0004). "Every Lambda" was never the rule;
        // "every Lambda that reads the database" is, and it is now stated instead of approximated. The
        // escape hatch is closed immediately below: the ONLY function allowed out of the subject set is
        // CDK's provider, asserted by name and by count, so a real Lambda cannot leave this guard by
        // quietly dropping its database env.
        const bound = databaseBoundFunctions(template);

        // ⚠️ MOVED AGAIN when U11's verification gate landed: seven workers now, plus the runner. The number
        // is pinned rather than derived on purpose — a Lambda that quietly LOSES its database env would
        // otherwise leave this subject set silently, which is the drift ADR-0004's own consumer list suffered.
        // ⚠️ AND AGAIN (2026-08-31) when plan U3's band revocation drain landed: eight workers plus the
        // runner. It reads the band tables and the spend counter, so it is database-bound by construction.
        // ⚠️ AND AGAIN when plan U8's parse leg landed: nine workers plus the runner — it reads the parse
        // cache, the corrections tier and the job tables.
        // ⚠️ AND AGAIN (2026-09-01) when the analytics retention sweeper landed (analytics plan U6): ten
        // workers plus the runner — it deletes aged analytics_events rows, database-bound by construction.
        // ⚠️ AND DOWN BY ONE when the schema barrier moved out: the runner it counted now lives in
        // `kitchensink-recipe-schema-{stage}`, so this is TEN, and the number falling is the change rather
        // than a Lambda quietly losing its database env — which the assertions below still catch.
        expect([...bound.keys()], 'the ten database-bound workers').toHaveLength(10);

        const functions = template.findResources('AWS::Lambda::Function');
        const unbound = Object.keys(functions).filter((name) => !bound.has(name));

        // ⚠️ EMPTY now, where it used to be CDK's trigger provider: with no trigger there is no provider,
        // so every Lambda this stack deploys reads the database and every one of them is VPC-attached.
        expect(unbound.filter((name) => !/CustomResourceProvider/.test(name))).toStrictEqual([]);
        expect(unbound, 'nothing here is exempt from the VPC any more').toStrictEqual([]);

        for (const name of bound.keys()) {
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

    it('schedules the sweeper daily — the outbox has NO other drain trigger', () => {
        // recipe-service never enqueues (a save must not depend on SQS, FR-007b-i), so without this rule
        // nothing ever turns an outbox row into a message and versions accumulate un-archived forever.
        //
        // The cadence is pinned, not incidental: it IS the worst-case archive delay, and it is coupled to
        // ARCHIVE_AGE_ALARM_THRESHOLD_SECONDS (3600s), whose "un-drained for an hour ⇒ stuck" inference
        // only holds while the sweep is faster than an hour. One day is a deliberate, temporary cost
        // posture (owner, 2026-08-15) that is safe ONLY while there is no production traffic — see the
        // ⛔ note on ArchiveSweepSchedule. This assertion is what makes restoring the cadence a
        // test-visible change rather than a silent one.
        template.hasResourceProperties('AWS::Events::Rule', {
            ScheduleExpression: 'rate(1 day)',
            State: 'ENABLED',
        });
    });

    /**
     * ⚠️ THIS TEST USED TO BE THE BUG. It asserted the handler strings with
     * `expect(handlers).toEqual(expect.arrayContaining([…five names…]))` — which proves those five are PRESENT
     * and says nothing whatsoever about a SIXTH. The stack deploys six Lambdas, `esbuild.mjs` bundled five, and
     * `handle-sync-worker` shipped as raw `tsc` output into an asset with no `node_modules`: every cold start
     * was `ERR_MODULE_NOT_FOUND`. `buildInputs.test.ts` iterated the same five names and missed it too.
     *
     * A list copied from the bundler cannot detect that the bundler's list is incomplete. So the subjects are
     * now DISCOVERED from the synthesized template — every `AWS::Lambda::Function` CloudFormation will create —
     * and the expectation is DERIVED from each handler string via esbuild's `outbase: src` layout. There is no
     * list left for a human to keep in step, which is the actual defect; the missing entry was its symptom.
     */
    it('ships a loadable artifact for every Lambda it deploys — derived from the template, not from a list', () => {
        // `handlers/x.handler` → `dist/handlers/x.js`: the exported symbol is everything after the LAST dot.
        // ⚠️ THE SUBJECT SET IS NOW EVERY LAMBDA HERE, with no exclusions at all. It used to exclude CDK's
        // trigger provider by name (asserted to be the ONLY exclusion, so a real Lambda could not leave the
        // guard by looking like a provider); with the schema barrier moved to its own stack there is no
        // trigger, so no provider, so nothing to exclude. The exclusion machinery is kept because the
        // ASSERTION that nothing is excluded is what makes a re-introduced provider visible here.
        const providers = Object.keys(template.findResources('AWS::Lambda::Function')).filter((name) =>
            /CustomResourceProvider/.test(name),
        );

        expect(providers, 'nothing here is CDK-provided any more, so nothing is exempt').toStrictEqual([]);

        const artifacts = Object.entries(template.findResources('AWS::Lambda::Function'))
            .filter(([name]) => !providers.includes(name))
            .map(([, fn]) => fn.Properties?.Handler as string)
            .map((handler) => ({
                handler,
                candidates: BUNDLE_ROOTS.map((root) =>
                    path.join(root, `${handler.slice(0, handler.lastIndexOf('.'))}.js`),
                ),
            }))
            .map(({ handler, candidates }) => ({ handler, file: candidates.find((file) => existsSync(file)) }));

        // Non-vacuity: a template that yielded no Lambdas would make every assertion below trivially pass.
        expect(artifacts.length).toBeGreaterThanOrEqual(7);

        expect(artifacts.filter(({ file }) => file === undefined).map(({ handler }) => handler)).toEqual([]);

        // The failure signature of the real defect: `handleSyncWorker.js` was raw `tsc` output opening
        // `import { sql } from 'drizzle-orm'`, so this reports `drizzle-orm` — the specifier that killed the
        // cold start — rather than merely "an entry point is missing from a config file".
        expect(
            artifacts
                .map(({ handler, file }) => ({ handler, unresolvable: unresolvableImports(file as string) }))
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
        // Regression guard for the original T132 bug: archiveSweeper.ts emits PendingArchiveBacklog under
        // `Stage=process.env['STAGE'] ?? 'unknown'`, and the FR-007b-i backlog alarm above watches the
        // `Stage={stage}` dimension. If STAGE is unset the metric publishes under `unknown`, the alarm
        // watches `sandbox`, and the spec-MUST alarm sits in INSUFFICIENT_DATA forever — silently. This
        // pins the env → dimension match so a future edit that drops STAGE fails here instead of in prod.
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'handlers/archiveSweeper.handler',
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
    it('grants rds-db:connect on a COLON-separated dbuser ARN, on every database-bound role', () => {
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

        // One grant per least-privilege function role (ARCH-IT-7) — a partial fix that repaired some roles
        // would leave those workers silently dead.
        //
        // ⚠️ The count is DERIVED from the database-bound functions rather than the literal `6` it used to
        // be, because the stack now also deploys the in-deploy migration RUNNER, which authenticates as the
        // same `recipe_app` role over RDS-IAM. Leaving the literal would have made the honest repair
        // ("expect 7") indistinguishable from the dishonest one ("expect whatever it is now"), and the
        // runner is where a regression bites hardest: it fails on the FIRST deploy of a new stage, with no
        // previous schema to fall back on.
        // ⚠️ ROLES, not functions, since plan U8: the parse-line Lambda deliberately SHARES the
        // verification gate's role (D6's single-Bedrock-grantee ruling), so the grant count is the count
        // of DISTINCT roles among the database-bound functions — one grant per least-privilege role still,
        // with sharing stated rather than double-counted.
        const boundRoles = new Set(
            [...databaseBoundFunctions(template).keys()].map((logicalId) => {
                const fn = template.findResources('AWS::Lambda::Function')[logicalId] as SynthesizedResource;
                const role = fn.Properties?.['Role'] as { 'Fn::GetAtt'?: [string, string] } | undefined;

                return role?.['Fn::GetAtt']?.[0] ?? JSON.stringify(role);
            }),
        );

        expect(resources).toHaveLength(boundRoles.size);

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

        // Seven workers plus the in-deploy migration runner. The runner is the reason the count first moved:
        // a runner pointed at the base database while the workers read the preview's own would migrate the
        // wrong schema and report success — #119's failure mode arriving through a new door. U11's
        // verification gate is the seventh worker, and it MATTERS here specifically: it writes the spend
        // counter, so a gate reading the shared base database would enforce ONE ceiling across every open
        // preview and deny them all once any of them exhausted it. The band drain (plan U3) is the eighth:
        // it reads the preview's own band tables and spend counter, for exactly the same isolation reason.
        // The parse leg (plan U8) is the ninth — its cache, corrections and job tables are all per-preview.
        // The analytics retention sweeper (analytics plan U6) is the tenth: a sweeper reading the shared
        // base database would delete another preview's (or the base's) event rows on its own schedule.
        // ⚠️ TEN, DOWN FROM ELEVEN: the runner this count included moved to
        // `kitchensink-recipe-schema-{stage}`, which resolves the same name through the same
        // `recipeDatabaseNameForStage` authority (asserted in this suite's schema-barrier block and in
        // recipe-service's own). The workers' half of #119 is what this test owns, and it is unchanged.
        expect(names).toHaveLength(10);
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
            (fn) => fn.Properties?.Handler === 'handlers/accountErasureWorker.handler',
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

    it('publishes NO drop door — the one that matters now belongs to the schema stack', () => {
        // ⛔ THE DOOR TO A PREVIEW'S LOGICAL DATABASE, and where it went. `teardown-sandbox-pr.sh` §1
        // discovers per-PR database drop doors BY SHAPE — any stack output whose key matches
        // `^[A-Za-z]+MigrationFunctionName$` — across the stacks a PR actually has.
        //
        // This stack used to publish one because it shipped a migration runner whose trigger called
        // `ensureDatabaseExists`, so a workers deploy CREATED `kitchensink_recipes_pr_{N}` whether or not
        // `RecipeServiceStack` ever landed — and it often did not (`deploy-recipe` deploys workers first,
        // with two hard-failing steps before the service's own `cdk deploy`; ADR-0007 × ADR-0022 wedged
        // `kitchensink-recipe-service-pr-91` in `UPDATE_ROLLBACK_FAILED` against the nightly-stopped RDS).
        // In every such state the only stack the PR had was this one, and without a door the database
        // leaked silently.
        //
        // ⚠️ The guarantee is STRONGER now, not weaker, which is why this assertion inverted rather than
        // moved. `kitchensink-recipe-schema-{stage}` is deployed FIRST and holds nothing but the runner, so
        // the door exists whenever the database it creates does — there is no partial state in which the
        // database was created and the door was not. Discovery is unchanged; the shape match finds it there.
        const outputs = template.toJSON().Outputs ?? {};
        const doors = Object.keys(outputs).filter((key) => /^[A-Za-z]+MigrationFunctionName$/.test(key));

        expect(doors).toStrictEqual([]);
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
            Handler: 'handlers/erasureOrphanSweeper.handler',
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
            Handler: 'handlers/erasureOrphanSweeper.handler',
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
            (fn) => fn.Properties?.Handler === 'handlers/erasureOrphanSweeper.handler',
        );

        expect(orphanFn?.Properties?.VpcConfig?.SubnetIds).toEqual(['subnet-private-1', 'subnet-private-2']);
        expect(orphanFn?.Properties?.VpcConfig?.SecurityGroupIds).toEqual(['sg-12345678']);
    });

    it('is NOT wired to any SQS event source — it is scheduled, not queue-driven', () => {
        // A regression guard: the orphan sweeper is EventBridge-triggered. An accidental SqsEventSource
        // would both change its trigger semantics and demand a consume grant it deliberately lacks.
        const mappings = Object.values(template.findResources('AWS::Lambda::EventSourceMapping'));

        // The FIVE queue workers (archive + erasure + handle-sync + U11's verification gate + U8's parse
        // leg) have event-source mappings; the orphan sweeper (EventBridge-scheduled) must not have
        // introduced another.
        expect(mappings).toHaveLength(5);
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
        // A COUNT, not a roster. It exists so a regression that silently DROPS an alarm trips here, and so a
        // new one has to be a deliberate edit; the loop below is what actually checks each alarm can page.
        // ⚠️ It was 11, then 15, then 16, and is now 17: the parse leg's CRF-availability, DLQ and throttle
        // alarms, the handle-sync DLQ alarm the derived "every DLQ has a depth alarm" guard found missing,
        // ADR-0024 layer 1's input-bound alarm, and now §4b's residency-refusal alarm. The earlier revision
        // of this comment named all eleven, which is the copied list this repository keeps learning not to
        // write — so what the number guards is stated instead of which alarms make it up.
        expect(Object.keys(alarms)).toHaveLength(17);

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

/**
 * RecipeWorkersStack — the schema barrier MOVED OUT, and this asserts it did not come back.
 *
 * ## What used to be here
 *
 * `cdk deploy` of this app runs BEFORE the recipe SERVICE deploy in both pipelines — it must, because this
 * stack publishes the `account-erasure-queue-{url,arn}` SSM parameters the service resolves at deploy time,
 * and because a queue's CONSUMER must upgrade before its PRODUCER. But the schema those Lambdas read was
 * applied by a trigger inside the SERVICE deploy, so every release put new worker code in front of the old
 * schema and left it there for the whole service deploy — while the still-running previous release kept
 * feeding the archive, erasure and handle-sync queues. On a first-ever `pr-{N}` deploy it was not even skew:
 * the per-PR logical database is CREATED by the migration run (ADR-0006), so the workers addressed a
 * database that did not exist.
 *
 * ADR-0022's answer was a SECOND runner here, shipping recipe-service's bundle, with its own trigger —
 * because no `DependsOn` can span two CDK apps invoked as two `cdk deploy` commands.
 *
 * ## What replaced it
 *
 * `kitchensink-recipe-schema-{stage}` holds the one runner for this database and is deployed and invoked by
 * its own pipeline step ahead of BOTH apps. That is strictly more coverage than two in-stack barriers gave:
 * a barrier could only ever reach its own stack, and one runner ahead of everything reaches every consumer
 * regardless of which app it lives in.
 *
 * So these assertions are the INVERSE of the ones they replace: this stack must carry NO runner and NO
 * trigger. A second runner reintroduces the two-runners-one-database shape, and it would ship whatever
 * bundle this deploy happened to carry rather than the one the pipeline migrated with.
 */

describe('RecipeWorkersStack — the schema barrier lives in its own stack now', () => {
    it('⛔ carries NO migration trigger', () => {
        const template = synth();

        expect(
            Object.keys(template.findResources('Custom::Trigger')),
            'a trigger here would apply the schema from this stack\u2019s own bundle, not the one the ' +
                'pipeline migrated with',
        ).toStrictEqual([]);
    });

    it('⛔ carries NO migration runner — no Lambda in this stack reaches for the migrations bundle', () => {
        // Derived from the template rather than from a name: a runner reintroduced under any construct id
        // still points at `lambdas/migrate/handler.handler`, which is the recipe-service bundle's entry.
        const template = synth();
        const runners = Object.entries(template.findResources('AWS::Lambda::Function'))
            .filter(([, fn]) => String((fn as SynthesizedResource).Properties?.['Handler']).includes('migrate'))
            .map(([id]) => id);

        expect(runners).toStrictEqual([]);
    });

    it('⛔ publishes no migration-function output — the drop door has ONE home', () => {
        // `teardown-sandbox-pr.sh` discovers per-PR database doors by SHAPE across a PR's stacks. Two doors
        // for one database was tolerable; the one that matters is the schema stack's, which is deployed
        // FIRST and holds nothing but the runner, so it exists whenever the database it creates does.
        const outputs = synth().findOutputs('*') as Record<string, unknown>;

        expect(Object.keys(outputs).filter((name) => name.endsWith('MigrationFunctionName'))).toStrictEqual([]);
    });

    it('still points every database-bound Lambda at the PER-PR logical database', () => {
        // Unchanged by the move, and the reason it is re-asserted here: the runner that CREATES that
        // database now lives in another stack, so this is the seam where the two names could drift. Both
        // resolve it through `recipeDatabaseNameForStage`, never by re-spelling it.
        const template = synth('pr-7', 'sandbox');
        const names = [...databaseBoundFunctions(template).values()];

        expect(names.length).toBeGreaterThan(0);

        for (const name of names) {
            expect(name).toBe('kitchensink_recipes_pr_7');
        }
    });
});

/**
 * ADR-0024 layer 4b's RESOURCE scope — the half `llmSpendGuards.test.ts` structurally cannot see.
 *
 * That gate is a TypeScript AST parser over infra SOURCE TEXT: it reads `actions` array literals and judges
 * the GRANTEE set, which is the security invariant. It cannot judge resources at all, because these ARNs are
 * `formatArn` calls that only exist after synth. So the scope is asserted here, where there is a template.
 *
 * ⛔ WHAT THE SCOPE HAS TO GET RIGHT, and what a code-only fix would have broken. The gate calls `Converse`
 * with the model's INVOCATION id (U35), which for a profile-only model is an `inference-profile` ARN in this
 * account — a different resource TYPE from `foundation-model/*`, and one that fans out to regions the grant
 * never named. Threading the invocation id without widening the grant would convert a `ValidationException`
 * that names the problem into an `AccessDenied` that does not.
 */
describe('RecipeWorkersStack — the bedrock:InvokeModel resource scope', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('grants EXACTLY the registry — every self-addressed model by name in the deploy region, nothing else', () => {
        // ⛔ SET EQUALITY, BOTH DIRECTIONS. This used to assert `foundation-model/*` was still present — the
        // "Nova regression assertion" — on the stack comment's claim that the SSM model id "cannot be resolved
        // at synth time". It can: `BEDROCK_MODEL_REGISTRY` is compile-time, and `planReservation` refuses any
        // id outside it before a call is made, so the wildcard authorized exactly the models the runtime
        // could never reach (ADR-0024 §4b, "the stated justification no longer holds"). Nova Micro's path is
        // still authorized — by its own ARN, which is what the equality below proves.
        const granted = new Set(bedrockStatements(template).flatMap(({ resources }) => resources));
        const expected = new Set(
            Object.entries(BEDROCK_MODEL_REGISTRY).flatMap(([modelId, entry]) => {
                const { invocation } = entry;

                // ⛔ RESIDENCY (ADR-0024 §4b): an entry 016 has not warranted is granted NOTHING, so the
                // synthesized policy and `planReservation` agree about which models exist AND which may be
                // reached. Before this, the grant followed registry membership alone and the two disagreed.
                if (residencyClearance(entry, 'us-east-1') === 'unapproved') {
                    return [];
                }

                if (invocation.invocationId === modelId) {
                    return [`arn:aws:bedrock:us-east-1::foundation-model/${modelId}`];
                }

                const profile = `arn:aws:bedrock:us-east-1:123456789012:inference-profile/${invocation.invocationId}`;
                const fanOut =
                    invocation.reach.kind === 'regions'
                        ? invocation.reach.regions.map(
                              (region) => `arn:aws:bedrock:${region}::foundation-model/${modelId}`,
                          )
                        : [];

                return [profile, ...fanOut];
            }),
        );

        expect(expected.has('arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0')).toBe(true);
        expect(granted).toEqual(expected);
    });

    /**
     * ⛔ THE DEPLOYED ROLE MAY NOT NAME A REGION IT WAS NEVER CLEARED FOR — asserted on the synthesized
     * template, on literal strings, and independently of the predicate the derivation itself calls.
     *
     * ADR-0024 §4b's concrete claim was that "the only things standing between recipe text and
     * us-east-2/us-west-2 are the SSM model parameter and this entry's presence in the table". The IAM policy
     * is now the third thing, and this is where that is observable: the fan-out statements were the sole
     * source of any non-deploy-region ARN, so their absence IS the absence of the reach.
     */
    /**
     * ⛔ THE ALARM THAT MAKES A DARK GATE VISIBLE (ADR-0024 §4b).
     *
     * The residency refusal is the one failure on this path that leaves NO other trace: the message is
     * acknowledged, no verdict row is written, nothing is reserved — so DLQ depth stays flat, the Lambda
     * `Errors` metric stays flat, and `VerificationSpendMicros` merely goes quiet, which is what a slow hour
     * looks like too. ⚠️ And `recipe-workers` has no log `SubscriptionFilter` and no metric filter anywhere
     * (the repository's only log drain is `WebhooksStack`'s, targeting the webhook, the API and the identity
     * ECS service), so the `logger.error` beside this metric reaches nothing that alarms.
     *
     * It should read ZERO forever — the shape `VerificationCacheTokensAlarm` already uses — because both the
     * parse pin and the SSM seed are residency-clear and `parseLine.test.ts` keeps the former that way. A
     * non-zero value means a model id was pointed somewhere 016 has not cleared, and nothing is being
     * verified or parsed until it is pointed back.
     */
    it('alarms on a residency refusal, on the Stage rollup, at zero', () => {
        const alarms = template.findResources('AWS::CloudWatch::Alarm', {
            Properties: { MetricName: 'VerificationResidencyRefused' },
        });
        const [alarm] = Object.values(alarms);

        expect(alarm, 'no alarm watches the residency refusal — a dark gate would be invisible').toBeDefined();
        expect(alarm?.Properties?.Namespace).toBe('Commise/RecipeVerification');
        expect(alarm?.Properties?.Threshold).toBe(0);
        expect(alarm?.Properties?.ComparisonOperator).toBe('GreaterThanThreshold');
        // ⚠️ `Stage` ALONE, and this suite's `synth()` deploys the `sandbox` stage. `emitMetric` publishes
        // `[['Stage'], ['Stage','CallSite']]`, so the rollup exists and an alarm selecting the faceted set
        // would watch one leg and miss the other.
        expect(alarm?.Properties?.Dimensions).toEqual([{ Name: 'Stage', Value: 'sandbox' }]);
        expect(alarm?.Properties?.AlarmActions, 'an alarm nobody is paged by is a dashboard').toBeDefined();
    });

    it('names no region outside the deploy region, and neither unwarranted profile', () => {
        const arns = bedrockStatements(template).flatMap(({ resources }) => resources);

        expect(arns.length, 'no bedrock grant was discovered — the assertion would pass over nothing').toBeGreaterThan(
            0,
        );

        for (const arn of arns) {
            expect(arn, arn).toContain('arn:aws:bedrock:us-east-1:');
        }

        const joined = arns.join(' ');

        expect(joined).not.toContain('us.amazon.nova-2-lite-v1:0');
        expect(joined).not.toContain('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    });

    it('leaves the on-demand statement UNCONDITIONED — a model called by its own id needs no profile', () => {
        const onDemandArns = new Set(
            Object.entries(BEDROCK_MODEL_REGISTRY)
                .filter(([modelId, { invocation }]) => invocation.invocationId === modelId)
                .map(([modelId]) => `arn:aws:bedrock:us-east-1::foundation-model/${modelId}`),
        );
        const onDemandStatements = bedrockStatements(template).filter(({ resources }) =>
            resources.some((arn) => onDemandArns.has(arn)),
        );

        expect(onDemandStatements.length).toBeGreaterThan(0);

        for (const { condition, resources } of onDemandStatements) {
            expect(condition).toBeUndefined();
            // …and it carries ONLY on-demand ARNs: a profile's fan-out never shares a statement with it.
            expect(resources.every((arn) => onDemandArns.has(arn))).toBe(true);
        }
    });

    /**
     * ⛔ INVERTED by the residency wiring, and the coverage MOVED rather than softened.
     *
     * Three assertions used to stand here: that every profile-addressed entry got its `inference-profile`
     * ARN, that every region it fans out to was granted, and that each fan-out carried its
     * `bedrock:InferenceProfileArn` condition. Every one of them is now VACUOUS against the shipped table,
     * because both profile-addressed entries are residency-unapproved and neither is granted anything — so
     * relaxing their `toBeGreaterThan(0)` floors to `toBeGreaterThanOrEqual(0)` would leave three tests that
     * run, count, and prove nothing.
     *
     * Where the coverage went, deliberately and in full:
     *
     *  - the profile ARN SHAPE, the fan-out region set and the load-bearing condition are all still asserted
     *    in `bedrockInvokePolicy.test.ts`, against `throughProfile(..., APPROVAL)` fixtures — the pure helper
     *    exists precisely so those questions can be asked without a shipped entry to ask them of;
     *  - what remains assertable HERE is the template's answer for the table it really deploys, which is
     *    that it carries no profile grant at all. That is the inversion below.
     */
    it('emits NO inference-profile grant and NO conditioned fan-out — the shipped table clears no profile', () => {
        const statements = bedrockStatements(template);

        // ⛔ ITS OWN NON-VACUITY FLOOR. Three `toEqual([])` assertions are all satisfied by an extractor that
        // stopped matching anything — the failure mode that turns a guard into a green no-op. A floor in the
        // sibling test does not protect this one.
        expect(statements.length, 'no bedrock statement was discovered — this proves nothing').toBeGreaterThan(0);

        const cleared = Object.entries(BEDROCK_MODEL_REGISTRY).filter(
            ([modelId, entry]) =>
                entry.invocation.invocationId !== modelId && residencyClearance(entry, 'us-east-1') !== 'unapproved',
        );

        // ⛔ THE PRECONDITION THIS INVERSION RESTS ON, asserted rather than assumed. The day 016 warrants a
        // cross-region model this goes red, and the three assertions above come back with it.
        expect(cleared, 'a profile is now residency-cleared — restore the positive assertions').toEqual([]);

        expect(statements.filter(({ condition }) => condition !== undefined)).toEqual([]);
        expect(
            statements.flatMap(({ resources }) => resources).filter((arn) => arn.includes(':inference-profile/')),
        ).toEqual([]);
    });

    it('carries NO wildcard resource at all', () => {
        const wildcards = bedrockStatements(template)
            .flatMap(({ resources }) => resources)
            .filter((arn) => arn.includes('*'));

        // Every ARN the role may invoke is enumerable from the registry at synth time — profiles, fan-outs
        // AND the on-demand models. This used to permit exactly one wildcard, `foundation-model/*`, on the
        // claim that the SSM model id could not be resolved at synth time; it can, and its nag acceptance
        // (`VERIFICATION_BEDROCK_MODEL_WILDCARD`) is gone with it. A `*` reappearing here is a finding, not
        // a convenience.
        expect(wildcards).toEqual([]);
    });
});

/**
 * THE CEILING ALARM WATCHES THE POOL, NOT ITS CONSUMERS (U36).
 *
 * ADR-0024's $100/month ceiling is ONE global pool (KTD-17). U36 adds a `CallSite` dimension so an emptied
 * pool can be attributed — and that dimension must NOT reach the alarm, or the half-ceiling threshold would be
 * evaluated once per consumer against a pool none of them owns exclusively. Two consumers at 60% each would
 * both read as green while the pool is 20% over.
 */
describe('RecipeWorkersStack — the spend alarm still watches the aggregate', () => {
    it('selects the Stage dimension alone, so no call site can hide behind another', () => {
        const alarms = Object.values(synth().findResources('AWS::CloudWatch::Alarm')).filter(
            (alarm) => alarm.Properties?.MetricName === 'VerificationSpendMicros',
        );

        expect(alarms, 'the ceiling alarm must exist for this assertion to mean anything').toHaveLength(1);
        expect(alarms[0]?.Properties?.Dimensions).toEqual([{ Name: 'Stage', Value: 'sandbox' }]);
    });
});

/**
 * The parse-job hand-off (plan U9) — the producer's discovery path.
 *
 * ⛔ SAME FAILURE CLASS AS THE VERIFICATION QUEUE'S: U8 shipped the parse consumer (queue, DLQ, Lambda,
 * CRF grant) with nothing producing. U9's producer reads `RECIPE_PARSE_QUEUE_URL`, which
 * `parseJobConfigSchema` makes REQUIRED — honoured only if this stack actually publishes the parameter
 * the service stack resolves. SSM rather than a CfnOutput export for the ADR-0005 ordering reason the
 * erasure/verification parameters document.
 */
describe('RecipeWorkersStack — the parse-job hand-off', () => {
    const template = synth('sandbox');

    it('publishes the parse queue URL + ARN to per-stage SSM for the recipe-service stack', () => {
        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: '/kitchensink/sandbox/recipe/parse-queue-url',
            Type: 'String',
        });
        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: '/kitchensink/sandbox/recipe/parse-queue-arn',
            Type: 'String',
        });
    });

    it('keys the parameters on the DEPLOY stage, so a pr-{N} service enqueues onto its own queue', () => {
        // ADR-0006: the pr-{N} worker points at the pr-{N} logical database; a message crossing stages
        // would land parse rows in the wrong database and bill the wrong stage's spend pool.
        const prTemplate = synth('pr-73');

        prTemplate.hasResourceProperties('AWS::SSM::Parameter', {
            Name: '/kitchensink/pr-73/recipe/parse-queue-url',
        });
    });
});

/**
 * ⛔ THE DETECTION HALF of the defect `cdkAppDeployCoverage.test.ts` closed the deploy half of.
 *
 * `kitchensink-ingredient-parser-{stage}` had never been deployed to any stage while this stack shipped
 * `RecipeParseLineFunction` into every one of them, pointing `CRF_FUNCTION_NAME` at it with an IAM grant to
 * its ARN. Nothing went red: the adapter mapped the failed invoke to absence, ADR-0026 §3 reads absence as
 * `single-engine llm`, and the two-engine pipeline halved itself behind green checks — while the UNGATED
 * `pr-{N}` LLM leg quietly absorbed the work the CRF was not doing.
 *
 * The deploy fix makes it deployable. These assertions make its DISAPPEARANCE loud, and they are two alarms
 * with deliberately COMPLEMENTARY coverage rather than one:
 *
 *  - **the ratio alarm** is fast and cause-specific. It watches the availability series the adapter
 *    publishes on BOTH paths (0 answered / 1 absent), so `Average == 1` means EVERY invocation in the window
 *    failed — which is what separates "the engine is GONE" from "the engine is busy", the distinction
 *    ADR-0026 §3 spends its whole section defending. A single throttle drops the average below 1 and pages
 *    nobody.
 *  - **the DLQ alarm** is the low-volume latch. The ratio alarm needs traffic to have datapoints; the DLQ
 *    alarm needs one line, and once a line lands there it stays until a human drains it. Between them,
 *    "sustained absence under load" and "one line failed on a quiet stage" are both covered.
 */
describe('RecipeWorkersStack — a vanished CRF engine is LOUD', () => {
    const template = synth('sandbox');

    it('alarms on a COUNT of absent CRF invocations, in ONE period — the only shape that can fire here', () => {
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'kitchensink-recipe-parse-crf-unavailable-sandbox',
            // ⛔ MUST EQUAL the literals `src/parsing/crfInvoke.ts` publishes. They are matched by exact
            // string extraction on the CloudWatch side, so a divergence does not fail a deploy — it leaves
            // this alarm watching a metric nobody writes, reporting a confident OK forever.
            Namespace: 'Commise/RecipeParse',
            MetricName: 'CrfEngineUnavailable',
            // The dimension the emitter attaches unconditionally. An alarm that omits it subscribes to a
            // series that has never had a datapoint (serviceInfraWiringInvariants W4's defect).
            Dimensions: [{ Name: 'Stage', Value: 'sandbox' }],
            // ⛔ Sum over ONE period, and both halves are load-bearing. `Sum` IS the failure count because
            // the emitter publishes 0 on success, so no metric-math expression is needed — which also keeps
            // the alarm readable by W3/W4, since a `MathExpression` resolves to no namespace and both gates
            // skip it. And ONE period, because the CRF is asked only about lines that missed the cache: the
            // series is gappy by construction, so a consecutive-period sustain is unfirable here. An earlier
            // draft of this alarm was `Average >= 1` over five consecutive periods and could not have fired.
            Statistic: 'Sum',
            Period: 300,
            Threshold: 1,
            ComparisonOperator: 'GreaterThanThreshold',
            EvaluationPeriods: 1,
            TreatMissingData: 'notBreaching',
        });
    });

    it('alarms on the parse leg’s own throttles, for the reason the verification gate’s does', () => {
        // `reservedConcurrentExecutions: 1` + an SQS event source means a backlog produces THROTTLED
        // deliveries, and a throttled delivery still burns a message's receive count. Without this, an
        // over-tight concurrency setting drains straight to the DLQ having never run — which, now that the
        // CRF alarm exists, would read as a CRF failure. The two have to be tellable apart.
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'kitchensink-recipe-parse-throttles-sandbox',
            MetricName: 'Throttles',
            Namespace: 'AWS/Lambda',
        });
    });

    it('⛔ EVERY dead-letter queue in this stack has a depth alarm — derived, never enumerated', () => {
        // The parse DLQ shipped with NO alarm while the verification DLQ beside it had one, so a parse line
        // that exhausted its retries disappeared in silence. A list of "the DLQs that need alarms" would
        // have had exactly the same hole, because a copy of a list cannot detect that the list is
        // incomplete (`handle-sync-worker`'s lesson). So both sides are DISCOVERED from the template.
        const queues = template.findResources('AWS::SQS::Queue');
        const alarms = template.findResources('AWS::CloudWatch::Alarm');

        /** Logical ids of every queue that some other queue redrives INTO — i.e. every DLQ, by structure. */
        const deadLetterIds = new Set(
            Object.values(queues).flatMap((queue) => {
                const target = (queue.Properties?.RedrivePolicy as { deadLetterTargetArn?: unknown } | undefined)
                    ?.deadLetterTargetArn;
                const attribute = (target as { 'Fn::GetAtt'?: [string, string] } | undefined)?.['Fn::GetAtt'];

                return attribute === undefined ? [] : [attribute[0]];
            }),
        );

        /** Logical ids of every queue an `ApproximateNumberOfMessagesVisible` alarm watches. */
        const alarmedIds = new Set(
            Object.values(alarms)
                .filter((alarm) => alarm.Properties?.MetricName === 'ApproximateNumberOfMessagesVisible')
                .flatMap((alarm) => {
                    const dimensions = (alarm.Properties?.Dimensions ?? []) as {
                        Name: string;
                        Value?: { 'Fn::GetAtt'?: [string, string] };
                    }[];

                    return dimensions
                        .filter((dimension) => dimension.Name === 'QueueName')
                        .flatMap((dimension) => {
                            const attribute = dimension.Value?.['Fn::GetAtt'];

                            return attribute === undefined ? [] : [attribute[0]];
                        });
                }),
        );

        // Non-vacuity: a template that produced no DLQs would make the equality below trivially true.
        expect(deadLetterIds.size).toBeGreaterThanOrEqual(4);
        expect([...deadLetterIds].filter((id) => !alarmedIds.has(id))).toEqual([]);
    });
});

/**
 * One SQS event source: the queue it drains and the function that drains it, by logical id.
 *
 * Both sides are read from the MAPPING rather than named, because the mapping is the only place the
 * pairing actually exists — a guard that named `RecipeParseQueue` and `RecipeParseLineFunction` would keep
 * passing if the mapping were rewired to a different function.
 */
interface SqsConsumerPair {
    readonly queueId: string;
    readonly functionId: string;
}

/**
 * Every queue→consumer pair in the template, DISCOVERED from `AWS::Lambda::EventSourceMapping`.
 *
 * ⛔ Enumerates nothing. A future queue with an SQS event source joins the subject set of every assertion
 * below on the day it is declared — which is the property a copy of a list cannot have (`handle-sync-worker`'s
 * lesson, restated by the DLQ-alarm guard above).
 *
 * @param template - The synthesized template.
 * @returns One entry per SQS event source mapping; non-SQS sources are skipped.
 */
function sqsConsumerPairs(template: Template): SqsConsumerPair[] {
    return Object.values(template.findResources('AWS::Lambda::EventSourceMapping')).flatMap((mapping) => {
        const source = (mapping.Properties?.EventSourceArn as { 'Fn::GetAtt'?: [string, string] } | undefined)?.[
            'Fn::GetAtt'
        ];
        const target = (mapping.Properties?.FunctionName as { Ref?: string } | undefined)?.Ref;

        return source === undefined || target === undefined ? [] : [{ queueId: source[0], functionId: target }];
    });
}

/**
 * Read a template property that must be a number of seconds, refusing absence.
 *
 * @param value - The raw template property.
 * @param what - The logical id it was read from, for the refusal message.
 * @returns The value, narrowed.
 * @throws When the property is absent or not a number — a comparison against `undefined` would be VACUOUS,
 *   which is worse than a failing one: it would report green for a resource that declared nothing at all.
 */
function requireSeconds(value: unknown, what: string): number {
    if (typeof value !== 'number') {
        throw new TypeError(`${what} declares no numeric timeout; the comparison it feeds would be vacuous`);
    }

    return value;
}

/**
 * Redeliveries a queue whose consumer is pinned at ONE concurrent execution must be allowed before its DLQ.
 *
 * ⛔ A LITERAL, deliberately — importing the stack's own constant would make every assertion below a
 * tautology (the guard would agree with whatever the stack says). This number is the CLAIM; the stack has to
 * meet it.
 *
 * Its size comes from the parse queue's own arithmetic, not from the verification queue's (see the redrive
 * comment on `RecipeParseQueue`): `MAX_PARSE_JOB_LINES` is 200, one message per line, drained one at a time,
 * so the last message of a full-size job waits out the whole job. At the parse queue's 180-second visibility
 * timeout a throttled message burns roughly one receive per redelivery cycle, so 20 buys ~60 minutes of
 * head-of-queue wait — comfortably past a pessimistic 200-line drain and past a CRF deploy window, while
 * still reaching the DLQ (and its depth alarm) inside the queue's 4-day retention when the failure is
 * unbounded.
 */
const PINNED_CONSUMER_REDELIVERY_FLOOR = 20;

/**
 * ⛔ REDELIVERY HEADROOM FOR A CONCURRENCY-PINNED CONSUMER (ADR-0026 §3, ADR-0024 layers 0 and 2).
 *
 * ## The knowledge this guard owns, and why it is a guard rather than a shared constant
 *
 * Two queues here drain into a Lambda carrying `reservedConcurrentExecutions: 1`, and both carry a redrive
 * count of 20 rather than the 5 the stack's other three queues use. They are NOT one constant spelled twice:
 * the verification queue's 20 is derived from the bake-off corpus (~2,432 messages at ~1s, against a
 * 90-second visibility timeout), the parse queue's from `MAX_PARSE_JOB_LINES` (200 messages against a
 * 180-second one). They agree today and would move for DIFFERENT reasons — the DRY test for two literals
 * that merely look alike — and folding them together would let a spend-driven cut to the verification
 * number silently shorten the parse leg's outage tolerance.
 *
 * What IS one piece of knowledge is the RULE: **a consumer pinned at one concurrent execution needs
 * redelivery headroom that an unpinned one does not.** `reservedConcurrentExecutions: 1` plus an SQS event
 * source means a backlog produces THROTTLED deliveries, and a throttled delivery still burns a message's
 * receive count — so at 5 a queue drains to the DLQ having never executed. That rule lives here, once,
 * derived over the construct tree, so it binds every future pinned consumer without anyone remembering to
 * add it to a list.
 *
 * ⚠️ AWS behaviour re-verified 2026-09-03 against current documentation, as the `RecipeParseQueue` and
 * `IngredientVerificationQueue` comments require before either number is tuned: the SQS error-handling page
 * still says a throttled invocation is retried only until "the message's timestamp exceeds your queue's
 * visibility timeout, at which point Lambda drops the message" (i.e. it returns and is received again), and
 * nothing in the current docs exempts a throttled delivery from `ApproximateReceiveCount`. The event
 * source's own `maxConcurrency` still cannot express 1 — the scaling page's console range is "between 2 and
 * 1,000" — so it remains unavailable as an alternative to this headroom.
 */
describe('RecipeWorkersStack — redelivery headroom for concurrency-pinned SQS consumers', () => {
    const template = synth('sandbox');

    it('⛔ gives EVERY queue whose consumer is pinned at one execution real headroom — derived, never enumerated', () => {
        const queues = template.findResources('AWS::SQS::Queue');
        const functions = template.findResources('AWS::Lambda::Function');
        const pairs = sqsConsumerPairs(template);

        const isPinned = ({ functionId }: SqsConsumerPair): boolean =>
            functions[functionId]?.Properties?.ReservedConcurrentExecutions === 1;

        const pinned = pairs.filter(isPinned);

        // Non-vacuity, BOTH directions. An empty `pinned` would make the shortfall assertion trivially true;
        // a `pinned` that swallowed every mapping would mean the predicate is not discriminating anything,
        // and the guard would then be asserting the floor for queues it was never meant to govern.
        expect(pinned.length).toBeGreaterThanOrEqual(2);
        expect(pairs.filter((pair) => !isPinned(pair)).length).toBeGreaterThanOrEqual(1);

        const shortfall = pinned
            .map(({ queueId }) => {
                const redrive = queues[queueId]?.Properties?.RedrivePolicy as { maxReceiveCount?: number } | undefined;

                return { queueId, maxReceiveCount: redrive?.maxReceiveCount };
            })
            .filter(
                ({ maxReceiveCount }) =>
                    maxReceiveCount === undefined || maxReceiveCount < PINNED_CONSUMER_REDELIVERY_FLOOR,
            );

        expect(shortfall).toEqual([]);
    });
});

/**
 * ⛔ EVERY REDELIVERY IS A FRESH ATTEMPT — a queue's visibility timeout strictly exceeds its consumer's.
 *
 * The rule this stack has stated at its archive queue since that queue was written ("visibilityTimeout must
 * exceed the worker's timeout, or SQS redelivers a message the worker is still processing and two
 * invocations race the same archive") and restates at the erasure and verification pairs. It is also the
 * precondition the redelivery headroom above is worthless without: a redelivery that can land while the
 * previous attempt is still running spends a receive on work already in flight rather than buying a retry.
 *
 * ⚠️ THIS GUARD WAS SCOPED TO THE CONCURRENCY-PINNED PAIRS, and the narrowing is now REPAIRED. It was
 * narrowed because `HandleSyncQueue` set a 60-second visibility timeout against a 60-second
 * `HandleSyncWorkerFunction` timeout — EQUAL, so it violated the rule — and that note said outright that
 * widening was owed once the defect was fixed. It is fixed (`HANDLE_SYNC_QUEUE_VISIBILITY_TIMEOUT`), so the
 * subject set is now every SQS consumer pair in the stack, DISCOVERED from the event-source mappings. A rule
 * that governs only the resources that already obey it is not a rule.
 */
describe('RecipeWorkersStack — every redelivery is a FRESH attempt', () => {
    const template = synth('sandbox');

    it('⛔ gives EVERY SQS consumer a queue that outlives it — derived, never enumerated', () => {
        const queues = template.findResources('AWS::SQS::Queue');
        const functions = template.findResources('AWS::Lambda::Function');
        const pairs = sqsConsumerPairs(template);

        // Non-vacuity: the stack wires five SQS consumers (archive, erasure, handle-sync, verification,
        // parse). A reader that found fewer would be missing mappings, and the loop below would pass by
        // never running — the exact vacuity `requireSeconds` exists to refuse one level down.
        expect(pairs.length).toBeGreaterThanOrEqual(5);

        // ⚠️ A SECOND CLAIM RIDES ALONG, stated so a future failure reads as a rule rather than a surprise:
        // because `requireSeconds` THROWS on absence, this also asserts that every SQS-consumed queue
        // DECLARES a visibility timeout. A queue relying on the SQS default of 30 seconds fails here — which
        // is correct (30s under a 60s consumer is the same defect, arrived at by omission), but it fails
        // with a vacuity message rather than a comparison, so read that message as "declare the timeout".
        // ⛔ It reaches consumed queues only: `RecipeParseDlq` has no event-source mapping, declares no
        // visibility timeout, and is correctly outside this subject set.

        for (const { queueId, functionId } of pairs) {
            // Both sides REQUIRED rather than optional-chained into the comparison: an absent value would
            // make `toBeGreaterThan` vacuous rather than false, which is the failure mode this whole block
            // is built to avoid.
            const visibility = requireSeconds(queues[queueId]?.Properties?.VisibilityTimeout, queueId);
            const timeout = requireSeconds(functions[functionId]?.Properties?.Timeout, functionId);

            expect(visibility, `${queueId} must outlive ${functionId}`).toBeGreaterThan(timeout);
        }
    });
});

/**
 * ⛔ NON-TLS ACCESS IS DENIED ON EVERY QUEUE THIS STACK OWNS — the MECHANISM, in this stack.
 *
 * ADR-0013's burn-down #1 recorded `SQS4 / SNS3 no TLS-only policy: 13 → 0 | FIXED` across the seven prod
 * apps. That zero was a one-time COUNT with nothing re-checking it, and it regressed to two: `RecipeParseQueue`
 * and `RecipeParseDlq` shipped with no `enforceSSL`, cdk-nag reported it into this app's advisory channel, and
 * nothing gates on that channel.
 *
 * ⚠️ THIS IS THE OTHER HALF OF `queueBaselineDeclarations.test.ts`, not a duplicate of it. That guard reads
 * SOURCE and answers "is any construction site in the repository missing the property?" — a completeness
 * question a synth-based reader cannot ask, because most CDK apps here need credentials, a VPC lookup and a
 * built bundle to synthesize. This one reads the TEMPLATE and answers "does the property actually produce the
 * control?" — a mechanism question the source reader cannot ask. `transportSecurity.test.ts` asks the same
 * mechanism question of the platform app; this stack was outside its subject set, which is why the regression
 * landed here and not there.
 */
describe('RecipeWorkersStack — every queue denies non-TLS access', () => {
    const template = synth('sandbox');

    it('⛔ covers EVERY queue with a SecureTransport deny — derived, never enumerated', () => {
        const queues = template.findResources('AWS::SQS::Queue');
        const policies = template.findResources('AWS::SQS::QueuePolicy');

        /** Logical ids of the queues some policy document denies non-TLS access to. */
        const denied = new Set(
            Object.values(policies).flatMap((policy) => {
                const properties = policy.Properties ?? {};
                const statements = ((properties['PolicyDocument'] as { Statement?: unknown[] } | undefined)
                    ?.Statement ?? []) as {
                    Effect?: string;
                    Condition?: { Bool?: Record<string, unknown> };
                }[];
                const deniesPlaintext = statements.some(
                    (statement) =>
                        statement.Effect === 'Deny' &&
                        String(statement.Condition?.Bool?.['aws:SecureTransport']) === 'false',
                );

                if (!deniesPlaintext) {
                    return [];
                }

                return ((properties['Queues'] ?? []) as { Ref?: string }[]).flatMap((queue) =>
                    queue.Ref === undefined ? [] : [queue.Ref],
                );
            }),
        );

        // Non-vacuity: ten queues, so an empty or truncated read cannot make the difference below trivial.
        expect(Object.keys(queues).length).toBeGreaterThanOrEqual(10);
        expect(Object.keys(queues).filter((id) => !denied.has(id))).toEqual([]);
    });
});

/**
 * THE LIST GRANT IS SCOPED TO THE RECIPE SUBTREE, LIKE THE DELETE GRANT BESIDE IT.
 *
 * `grantRecipeObjectErasure` narrows `s3:DeleteObject` to `recipes/*` at the object level — but `s3:ListBucket`
 * is a BUCKET-level action, and a bucket-level allow with no condition authorizes `ListObjectsV2` over EVERY
 * prefix of a bucket that also holds other tenants' media. `eraseRecipeObjects` always lists under
 * `recipes/{ownerId}/{recipeId}/`, so the authority it needs is exactly that subtree; AWS spells that as an
 * `s3:prefix` condition on the list statement. Without it the two most destructive roles in the stack could
 * enumerate keys they can neither read nor delete — and enumeration is still disclosure.
 */
describe('RecipeWorkersStack — s3:ListBucket is conditioned on the recipe prefix', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    /** Every statement granting `s3:ListBucket` in the named role's default policy. */
    function listStatements(rolePolicyPrefix: string): readonly { Condition?: unknown }[] {
        const policy = Object.values(template.findResources('AWS::IAM::Policy')).find((candidate) =>
            String(candidate.Properties?.PolicyName ?? '').startsWith(rolePolicyPrefix),
        );

        expect(policy, `${rolePolicyPrefix} must carry an inline policy`).toBeDefined();

        const statements = (policy?.Properties?.PolicyDocument?.Statement ?? []) as {
            Action?: string | string[];
            Condition?: unknown;
        }[];

        return statements.filter((statement) =>
            (typeof statement.Action === 'string' ? [statement.Action] : (statement.Action ?? [])).includes(
                's3:ListBucket',
            ),
        );
    }

    it.each([['AccountErasureWorkerRoleDefaultPolicy'], ['ErasureOrphanSweeperRoleDefaultPolicy']])(
        '%s may list ONLY under recipes/ — the same subtree its delete grant is scoped to',
        (rolePolicyPrefix) => {
            const statements = listStatements(rolePolicyPrefix);

            // Non-vacuity: the grant exists at all.
            expect(statements.length).toBeGreaterThan(0);

            for (const statement of statements) {
                // `s3:prefix` is the prefix parameter of the List call, so `recipes/*` admits exactly the
                // per-recipe prefixes `eraseRecipeObjects` issues and refuses a bare or foreign-prefix listing.
                expect(statement.Condition).toEqual({ StringLike: { 's3:prefix': ['recipes/*'] } });
            }
        },
    );
});

/**
 * ADR-0024 LAYER 1 HAS AN ALARM, because the counter cannot report its own precondition.
 *
 * The reservation is priced from an input-token bound (UTF-8 bytes + a chat-template allowance). If a
 * tokenizer beats that bound, `settleDeltaMicros` — deliberately unclamped — simply charges the overshoot and
 * it vanishes into the month's total. ADR-0024 §2 makes the input cap a PRECONDITION of the ceiling ("if
 * prompt length is unbounded, the reservation is a lie"), so a bound being exceeded is a ceiling not holding,
 * and this alarm is the only thing that says so.
 */
describe('RecipeWorkersStack — the input-bound alarm (ADR-0024 layer 1)', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('alarms on ANY call billed beyond the bound its reservation was priced for', () => {
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'kitchensink-recipe-verification-input-bound-sandbox',
            MetricName: 'VerificationInputBoundExceeded',
            Namespace: 'Commise/RecipeVerification',
            Threshold: 0,
            ComparisonOperator: 'GreaterThanThreshold',
            TreatMissingData: 'notBreaching',
        });
    });

    it('watches the AGGREGATE — Stage alone, never Stage+CallSite', () => {
        // ⛔ The same trap ADR-0024 §4c records for the spend alarm: EMF publishes each dimension SET
        // separately, so an alarm selecting `Stage` + `CallSite` watches ONE consumer's series and sits at a
        // confident OK while another consumer's prompt blows the bound.
        const alarm = Object.values(template.findResources('AWS::CloudWatch::Alarm')).find(
            (candidate) => candidate.Properties?.MetricName === 'VerificationInputBoundExceeded',
        );

        expect(alarm, 'the input-bound alarm must exist').toBeDefined();
        expect(alarm?.Properties?.Dimensions).toEqual([{ Name: 'Stage', Value: 'sandbox' }]);
    });

    it('routes to the same SNS topic every other alarm in this stack does', () => {
        // An alarm with no action is a dashboard widget, not a control — the gap QE-001/T138 closed.
        const alarm = Object.values(template.findResources('AWS::CloudWatch::Alarm')).find(
            (candidate) => candidate.Properties?.MetricName === 'VerificationInputBoundExceeded',
        );

        expect(alarm?.Properties?.AlarmActions).toHaveLength(1);
    });
});
