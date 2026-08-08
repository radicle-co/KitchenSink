import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
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

        it('KEEPS the deprecated `v1` base path — the Clerk dashboard is configured to POST there', () => {
            // This alias is NOT dead code and NOT tidy-uppable. The webhook endpoint URL lives in the Clerk
            // DASHBOARD, outside this repository. Dropping `v1` would 404 every user.created/updated/deleted
            // callback and silently stop syncing users into RDS, with no failing deploy and no alarm — the
            // failure would only surface later as missing users. Removal REQUIRES updating the Clerk
            // dashboard endpoint to the `api/v1` URL FIRST, then draining. See ADR-0011.
            expect(singleLevelBasePaths()).toContain('v1');
        });

        it('maps exactly those two base paths onto the one REST API', () => {
            expect([...multiLevelBasePaths(), ...singleLevelBasePaths()]).toHaveLength(2);
            template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
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
});
