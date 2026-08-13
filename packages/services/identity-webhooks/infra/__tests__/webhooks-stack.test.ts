import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import { WebhooksStack } from '../lib/webhooks-stack.js';

// The Lambda code is bundled to dist/ by `npm run build`, which `lambda.Code.fromAsset` needs.
//
// This used to be `describe.skipIf(!distBuilt)` with a comment claiming "in CI the build runs before
// tests, so this suite executes there". That was FALSE, and it meant all 14 assertions below silently
// skipped on every CI run: the `test` job is checkout → setup-node → restore-cache → `turbo run test`,
// with no build step, and turbo's repo-level `test.dependsOn: ["^build"]` builds DEPENDENCIES, not the
// package itself. A green tick therefore proved nothing about this stack. Worse, the guard was
// satisfied by ANY file under dist/ — a stray `.tsbuildinfo` was enough to flip it true.
//
// Fixed at the dependency graph instead of here: this package now carries its own `turbo.json` with
// `test.dependsOn: ["build"]`, so dist is guaranteed present and cache-tracked. A missing dist is now
// a LOUD failure (fromAsset throws) rather than a silent skip — which is the correct direction for a
// suite whose whole job is to assert what production synthesizes.
const here = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(here, '../../dist');

const env = { account: '123456789012', region: 'us-east-1' };

describe('WebhooksStack (authoritative, consumes the consolidated global exports)', () => {
    it('has its Lambda bundle built — the precondition this suite used to skip on', () => {
        expect(
            existsSync(distPath),
            `dist/ is missing at ${distPath}. Run \`npm run build --workspace=@kitchensink/identity-webhooks\`. ` +
                'This assertion replaces a describe.skipIf that hid all 14 tests below on every CI run.',
        ).toBe(true);
    });

    let template: Template;

    beforeAll(() => {
        const app = new App({
            context: {
                // Pre-seed the VPC lookup so Vpc.fromLookup resolves to a dummy VPC during synth.
                'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true':
                    {
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
                                ],
                            },
                        ],
                    },
            },
        });

        const stack = new WebhooksStack(app, 'TestWebhooks', {
            env,
            stage: 'test',
            domainName: 'example.com',
            vpcId: 'vpc-12345678',
            lambdaSecurityGroupId: 'sg-0lambda00000000',
            databaseSecurityGroupId: 'sg-0database000000',
            dbSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:db-AbCdEf',
            authSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:auth-AbCdEf',
            migrationPlanSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:migration-AbCdEf',
            dbInstanceIdentifier: 'kitchensink-identity-test',
            dbEndpoint: 'db.example.internal',
            dbPort: 5432,
            deletionQueueArn: 'arn:aws:sqs:us-east-1:123456789012:kitchensink-deletion-test',
            mediaBucketName: 'kitchensink-media-test',
            archiveBucketName: 'kitchensink-archive-test',
            hostedZoneId: 'Z0123456789ABCDEFGHIJ',
            zoneName: 'example.com',
        });

        template = Template.fromStack(stack);
    });

    // ADR-0011 cannot be discharged without this. The webhook is reachable on TWO base-path mappings —
    // canonical `api/v1` and the deprecated `v1` alias — and the alias may only be deleted once we can
    // prove Clerk is no longer using it. The access log recorded `$context.resourcePath`, which is
    // `/webhooks/users` for BOTH mappings, so three real deliveries observed in production were
    // indistinguishable as to which path they arrived on. `$context.path` is the full incoming path and
    // is what makes them distinguishable; `$context.domainName` also separates the prod custom domain
    // from the raw execute-api host.
    it('access log records the FULL request path, not just the shared resource path (ADR-0011)', () => {
        const stages = template.findResources('AWS::ApiGateway::Stage');
        const formats = Object.values(stages).map(
            (s) => (s.Properties as { AccessLogSetting?: { Format?: string } }).AccessLogSetting?.Format ?? '',
        );

        expect(formats.length).toBeGreaterThan(0);

        for (const format of formats) {
            expect(format, 'access log format must include $context.path').toContain('$context.path');
            expect(format, 'access log format must include $context.domainName').toContain('$context.domainName');
        }
    });

    it('wires the Clerk webhook Lambda (POST handler) and an API Gateway in front of it', () => {
        template.hasResourceProperties('AWS::Lambda::Function', { Handler: 'handlers/identityWebhook.handler' });
        template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    it('exposes the migration runner Lambda name for the deploy workflow to invoke', () => {
        template.hasOutput('MigrationFunctionName', {});
    });

    describe('custom-domain base-path mappings (the public webhook URL shape)', () => {
        // The Clerk webhook's public path is (custom-domain base path) + (resource path `webhooks/users`).
        // The two mappings synthesize to DIFFERENT CloudFormation types, which is a CDK/API Gateway
        // constraint rather than a choice: `AWS::ApiGateway::BasePathMapping` rejects multi-level paths
        // (`DomainName.addBasePathMapping` throws), so a multi-level base path such as `api/v1` must go
        // through `addApiMapping` → `AWS::ApiGatewayV2::ApiMapping`. That is legal here because the domain
        // is REGIONAL with a TLS 1.2 security policy; both are prerequisites AWS enforces for multi-level
        // mappings, and both are asserted below so a future downgrade of either fails loudly here.

        /** The single-level base paths mapped via `AWS::ApiGateway::BasePathMapping`. */
        function singleLevelBasePaths(): string[] {
            return Object.values(template.findResources('AWS::ApiGateway::BasePathMapping')).map(
                (resource) => (resource as { Properties: { BasePath: string } }).Properties.BasePath,
            );
        }

        /** The multi-level base paths mapped via `AWS::ApiGatewayV2::ApiMapping`. */
        function multiLevelBasePaths(): string[] {
            return Object.values(template.findResources('AWS::ApiGatewayV2::ApiMapping')).map(
                (resource) => (resource as { Properties: { ApiMappingKey: string } }).Properties.ApiMappingKey,
            );
        }

        it('serves the canonical `api/v1` base path, so the webhook is POST /api/v1/webhooks/users', () => {
            expect(multiLevelBasePaths()).toContain('api/v1');
        });

        it('no longer maps the RETIRED `v1` alias — both Clerk instances POST to `api/v1` (measured)', () => {
            // RETIRED 2026-08-07, after the evidence its own precondition demanded. The alias existed because
            // the endpoint URL lives in the Clerk DASHBOARD, outside this repository, so nobody could prove
            // Clerk had stopped using it — and the access log could not tell the two apart, since
            // `$context.resourcePath` is `/webhooks/users` for BOTH mappings.
            //
            // What changed: the log now emits `$context.path` (the full incoming path). With prod AND sandbox
            // both instrumented, a driven `user.created`/`user.deleted` pair on EACH instance was observed
            // arriving at:
            //     prod    → 3/3  registration.identity.commise.app/api/v1/webhooks/users          [200]
            //     sandbox → 3/3  registration.identity.sandbox.commise.app/api/v1/webhooks/users  [200]
            // with ZERO deliveries on `/v1/...` in either instrumented window. Svix (Clerk's sender) posts to
            // ONE configured URL per endpoint — it does not spread across paths — so 3/3 identifies the
            // configured URL rather than merely sampling it.
            //
            // Residual risk, stated rather than hidden: a SECOND, currently-idle Svix endpoint configured at
            // `/v1` would be invisible to this method. If user sync ever stops after this change, check the
            // Clerk dashboard's endpoint list FIRST — a 404 on `/v1/webhooks/users` is the signature.
            expect(singleLevelBasePaths()).not.toContain('v1');
        });

        it('maps exactly ONE base path onto the one REST API', () => {
            expect([...multiLevelBasePaths(), ...singleLevelBasePaths()]).toEqual(['api/v1']);
            template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
            // The alias is gone as a RESOURCE, not merely absent from the list above.
            template.resourceCountIs('AWS::ApiGateway::BasePathMapping', 0);
        });

        it('keeps the domain REGIONAL on TLS 1.2 — AWS requires both for a multi-level base path', () => {
            template.hasResourceProperties('AWS::ApiGateway::DomainName', {
                EndpointConfiguration: { Types: ['REGIONAL'] },
                SecurityPolicy: 'TLS_1_2',
            });
        });
    });

    it('provisions the deletion-worker, reconciliation, and migration Lambdas alongside the webhook', () => {
        // The four service Lambdas (webhook + deletion-worker + reconciliation + migration). CDK may add
        // helper functions (e.g. log-retention), so assert "at least four" rather than an exact count.
        const fnCount = Object.keys(template.findResources('AWS::Lambda::Function')).length;
        expect(fnCount).toBeGreaterThanOrEqual(4);
    });

    it('runs reconciliation on a nightly schedule (NOT off the deletion queue)', () => {
        // A1: reconciliation must be driven by an EventBridge schedule, not the SQS deletion queue.
        template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(0 7 * * ? *)' });

        const [reconciliationLogicalId] = Object.entries(
            template.findResources('AWS::Lambda::Function', {
                Properties: { Handler: 'handlers/reconciliation.handler' },
            }),
        )[0]!;

        // The schedule targets the reconciliation function.
        template.hasResourceProperties('AWS::Events::Rule', {
            Targets: [{ Arn: { 'Fn::GetAtt': [reconciliationLogicalId, 'Arn'] } }],
        });
    });

    it('routes the SQS deletion queue to the deletion-worker, not reconciliation', () => {
        // A1: the single SQS event-source mapping must resolve to the deletion-worker function.
        const [deletionWorkerLogicalId] = Object.entries(
            template.findResources('AWS::Lambda::Function', {
                Properties: { Handler: 'handlers/deletion-worker.handler' },
            }),
        )[0]!;

        const mappings = template.findResources('AWS::Lambda::EventSourceMapping');
        expect(Object.keys(mappings)).toHaveLength(1);
        const mapping = Object.values(mappings)[0]!;
        expect(mapping.Properties.FunctionName).toEqual({ Ref: deletionWorkerLogicalId });
    });

    it('provisions the tombstone-sweep Lambda on its own daily EventBridge schedule (CR-002 KTD-3)', () => {
        // The 12-month tombstone → erasure sweep is a NEW scheduled handler, distinct from reconciliation.
        template.hasResourceProperties('AWS::Lambda::Function', { Handler: 'handlers/tombstone-sweep.handler' });

        const [sweepLogicalId] = Object.entries(
            template.findResources('AWS::Lambda::Function', {
                Properties: { Handler: 'handlers/tombstone-sweep.handler' },
            }),
        )[0]!;

        template.hasResourceProperties('AWS::Events::Rule', {
            ScheduleExpression: 'cron(0 3 * * ? *)',
            Targets: [{ Arn: { 'Fn::GetAtt': [sweepLogicalId, 'Arn'] } }],
        });
    });

    it('provisions the erasure-reconciliation Lambda on its own daily schedule, distinct from provisioning reconciliation (CR-002 R7)', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'handlers/erasure-reconciliation.handler',
        });

        const [erasureReconLogicalId] = Object.entries(
            template.findResources('AWS::Lambda::Function', {
                Properties: { Handler: 'handlers/erasure-reconciliation.handler' },
            }),
        )[0]!;

        // 05:00 UTC — distinct from provisioning reconciliation (07:00) and the tombstone-sweep (03:00).
        template.hasResourceProperties('AWS::Events::Rule', {
            ScheduleExpression: 'cron(0 5 * * ? *)',
            Targets: [{ Arn: { 'Fn::GetAtt': [erasureReconLogicalId, 'Arn'] } }],
        });
    });

    it('alarms when an erasure is left incomplete (R7 detective control)', () => {
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            AlarmName: 'kitchensink-erasure-incomplete-test',
            Namespace: 'KitchenSink/IdentityWebhooks',
            MetricName: 'ErasureIncomplete',
            ComparisonOperator: 'GreaterThanThreshold',
            Threshold: 0,
        });
    });

    it('injects the erasure fan-out config (signing key + recipe/food origins) into the deletion-worker', () => {
        const [deletionWorker] = Object.values(
            template.findResources('AWS::Lambda::Function', {
                Properties: { Handler: 'handlers/deletion-worker.handler' },
            }),
        );
        const envVars = (deletionWorker as { Properties: { Environment: { Variables: Record<string, unknown> } } })
            .Properties.Environment.Variables;

        expect(envVars).toHaveProperty('SERVICE_ERASURE_SIGNING_KEY');
        expect(envVars).toHaveProperty('RECIPE_SERVICE_BASE_URL');
        expect(envVars).toHaveProperty('FOOD_SERVICE_BASE_URL');
    });

    it('grants the webhook role GetSecretValue on the auth secret WITH the -?????? wildcard (regression)', () => {
        // Same bug class as the identity service stack: the auth secret is imported from the data stack's
        // suffix-LESS `SecretArn` export, so the grant must append the `-??????` wildcard to match the
        // secret's real ARN — otherwise the lambda's runtime GetSecretValue fallback is denied. Reverting
        // to `secretCompleteArn` drops the wildcard and fails this test.
        const authBase = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:auth-AbCdEf';
        const policies = template.findResources('AWS::IAM::Policy');
        const secretGrantResources = Object.values(policies).flatMap((policy) =>
            ((policy.Properties?.PolicyDocument?.Statement ?? []) as Array<Record<string, unknown>>)
                .filter((statement) =>
                    ([] as string[])
                        .concat(statement['Action'] as string | string[])
                        .includes('secretsmanager:GetSecretValue'),
                )
                .flatMap((statement) => ([] as unknown[]).concat(statement['Resource'] as unknown)),
        );

        expect(secretGrantResources).toContain(`${authBase}-??????`);
        expect(secretGrantResources).not.toContain(authBase);
    });

    /**
     * The alarms, and the two ways one can be dead while looking healthy.
     *
     * `emitMetric` (`src/common/observability.ts`) publishes EVERY metric under
     * `Dimensions: [['service', 'metric', ...Object.keys(dimensions)]]`. EMF publishes ONLY the dimension sets
     * its directive lists — there is no dimensionless rollup — so an alarm that selects no dimensions subscribes
     * to a time series that has never had a datapoint, and `treatMissingData: NOT_BREACHING` renders that as a
     * confident, permanent `OK`. Verified against the deployed account: both `kitchensink-erasure-incomplete-*`
     * alarms reported `Dimensions: []` and "no datapoints were received for 2 periods".
     *
     * The second way is having no action at all, which this stack's only alarm also had.
     */
    describe('alarms watch series the code actually publishes, and page someone', () => {
        /** The dimension keys `emitMetric` attaches to every metric, whatever the caller passes. */
        const EMITTER_DIMENSIONS = ['service', 'metric'];

        const alarmsFor = (metricName: string): ReadonlyArray<Record<string, unknown>> =>
            Object.values(template.findResources('AWS::CloudWatch::Alarm'))
                .map((alarm) => (alarm.Properties ?? {}) as Record<string, unknown>)
                .filter((properties) => properties['MetricName'] === metricName);

        const dimensionsOf = (properties: Record<string, unknown>): ReadonlyMap<string, unknown> =>
            new Map(
                ((properties['Dimensions'] ?? []) as ReadonlyArray<{ Name: string; Value: unknown }>).map(
                    (dimension) => [dimension.Name, dimension.Value],
                ),
            );

        it('selects the emitter’s unconditional dimensions on ErasureIncomplete (was dimensionless → dead)', () => {
            const [alarm] = alarmsFor('ErasureIncomplete');
            const dimensions = dimensionsOf(alarm as Record<string, unknown>);

            expect(alarm).toBeDefined();
            expect([...dimensions.keys()].sort()).toEqual([...EMITTER_DIMENSIONS].sort());
            // The values are the emitter's own: `service: 'identity-webhooks'` and `metric: <metricName>`.
            expect(dimensions.get('service')).toBe('identity-webhooks');
            expect(dimensions.get('metric')).toBe('ErasureIncomplete');
        });

        it('alarms on IdentityWebhookRejected per reason, so shape and signature threshold separately', () => {
            const alarms = alarmsFor('IdentityWebhookRejected');
            const reasons = alarms.map((alarm) => dimensionsOf(alarm).get('reason'));

            // `reason: 'shape'` means Clerk's contract moved — the signal worth paging on. `signature` is
            // dominated by unauthenticated internet scanning against a deliberately public endpoint, so it
            // cannot share a threshold with shape without one burying the other.
            expect(reasons.sort()).toEqual(['shape', 'signature']);

            const shape = alarms.find((alarm) => dimensionsOf(alarm).get('reason') === 'shape') as Record<
                string,
                unknown
            >;
            const signature = alarms.find((alarm) => dimensionsOf(alarm).get('reason') === 'signature') as Record<
                string,
                unknown
            >;

            // Any shape rejection at all is actionable; signature must be sustained before it means anything.
            expect(shape['Threshold']).toBe(0);
            expect(shape['EvaluationPeriods']).toBe(1);
            expect(Number(signature['Threshold'])).toBeGreaterThan(0);
            expect(Number(signature['EvaluationPeriods'])).toBeGreaterThan(1);
        });

        it('carries the emitter’s dimensions on every rejection alarm too', () => {
            // Non-vacuity: without this the loop below passes over an empty set, which is how a
            // for-loop assertion stays green while the resources it checks do not exist.
            expect(alarmsFor('IdentityWebhookRejected')).toHaveLength(2);

            for (const alarm of alarmsFor('IdentityWebhookRejected')) {
                const dimensions = dimensionsOf(alarm);

                expect([...dimensions.keys()].sort()).toEqual([...EMITTER_DIMENSIONS, 'reason'].sort());
                expect(dimensions.get('service')).toBe('identity-webhooks');
                expect(dimensions.get('metric')).toBe('IdentityWebhookRejected');
            }
        });

        it('gives EVERY alarm an action — an alarm that pages nobody is a dashboard', () => {
            const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm'));

            // Non-vacuity: no alarms would make the filter below trivially empty.
            expect(alarms.length).toBeGreaterThanOrEqual(3);
            expect(
                alarms
                    .filter((alarm) => ((alarm.Properties?.AlarmActions ?? []) as unknown[]).length === 0)
                    .map((alarm) => alarm.Properties?.AlarmName),
            ).toEqual([]);
        });

        it('publishes the alarm topic over SSL only', () => {
            template.hasResourceProperties('AWS::SNS::TopicPolicy', {
                PolicyDocument: Match.objectLike({
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Action: 'sns:Publish',
                            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
                            Effect: 'Deny',
                        }),
                    ]),
                }),
            });
        });
    });
});
