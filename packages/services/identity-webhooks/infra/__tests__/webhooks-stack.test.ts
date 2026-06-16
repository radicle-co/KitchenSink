import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import { WebhooksStack } from '../lib/webhooks-stack.js';

// The Lambda code is bundled to dist/ by `npm run build`. Skip cleanly (don't fail) when it hasn't
// been built — `lambda.Code.fromAsset` would otherwise throw on a missing asset dir. In CI the build
// runs before tests, so this suite executes there.
const here = path.dirname(fileURLToPath(import.meta.url));
const distBuilt = existsSync(path.join(here, '../../dist'));

const env = { account: '123456789012', region: 'us-east-1' };

describe.skipIf(!distBuilt)('WebhooksStack (authoritative, consumes the consolidated global exports)', () => {
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

    it('wires the Clerk webhook Lambda (POST handler) and an API Gateway in front of it', () => {
        template.hasResourceProperties('AWS::Lambda::Function', { Handler: 'handlers/identityWebhook.handler' });
        template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    it('exposes the migration runner Lambda name for the deploy workflow to invoke', () => {
        template.hasOutput('MigrationFunctionName', {});
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
});
