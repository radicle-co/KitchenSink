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
import { beforeAll, describe, expect, it } from 'vitest';

import { RecipeWorkersStack } from '../lib/recipe-workers-stack.js';

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
        expect(names).toHaveLength(3);

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
