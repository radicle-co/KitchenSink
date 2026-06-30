import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import { FoodServiceStack } from '../lib/food-service-stack.js';

// These MUST stay byte-identical to `src/observability/emf-metrics.ts` `FOOD_METRIC` (the worker emits
// them) and to the stack's local `FOOD_METRIC` (the alarms/dashboard chart them). They are duplicated
// here rather than imported because the infra tsconfig `rootDir` forbids importing across the
// src↔infra boundary (TS6059); this asserts the synthesized template uses exactly those literals.
const FOOD_METRIC_NAMESPACE = 'Commise/Food';
const FOOD_METRIC = {
    fetchQueueDepth: 'food-fetch-queue-depth',
    tombstoneCount: 'food-tombstone-count',
    pendingAgeSeconds: 'food-fetch-pending-age-seconds',
} as const;

// NetworkStack/DataStack/SharedAlbStack assertions live with the deployed (global) definitions in
// packages/infra/global/__tests__. This suite covers only the food service stack, which is what
// this package owns and deploys.

let serviceTemplate: Template;

const env = { account: '123456789012', region: 'us-east-1' };

beforeAll(() => {
    const app = new App({
        context: {
            stage: 'test',
            // Pre-seed the VPC lookup so `Vpc.fromLookup` resolves to a dummy VPC during synth
            // instead of attempting an AWS call (no credentials in CI).
            'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true':
                {
                    vpcId: 'vpc-12345678',
                    vpcCidrBlock: '10.0.0.0/16',
                    ownerAccountId: '123456789012',
                    availabilityZones: [],
                    subnetGroups: [
                        {
                            name: 'Public',
                            type: 'Public',
                            subnets: [
                                {
                                    subnetId: 'subnet-public-1',
                                    availabilityZone: 'us-east-1a',
                                    routeTableId: 'rtb-public-1',
                                    cidr: '10.0.0.0/24',
                                },
                            ],
                        },
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

    const service = new FoodServiceStack(app, 'TestFoodService', {
        env,
        stage: 'test',
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        workerDesiredCount: 1,
        vpcId: 'vpc-12345678',
    });

    serviceTemplate = Template.fromStack(service);
});

describe('Shared ALB topology (no per-service ALB)', () => {
    it('does NOT create its own Application Load Balancer (uses the shared per-stage ALB)', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    });

    it('attaches exactly one host-based listener rule to the shared HTTPS listener (priority 200)', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        serviceTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: 200,
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    HostHeaderConfig: Match.objectLike({
                        Values: ['food.test.example.com'],
                    }),
                }),
            ]),
        });
    });

    it('creates exactly one target group', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
    });

    it('creates the service A-record (aliased to the shared ALB)', () => {
        serviceTemplate.resourceCountIs('AWS::Route53::RecordSet', 1);
        serviceTemplate.hasResourceProperties('AWS::Route53::RecordSet', {
            Type: 'A',
            Name: 'food.test.example.com.',
        });
    });

    it('exports no FoodAlb* outputs (canonical ALB outputs live on the shared ALB stack)', () => {
        const outputs = serviceTemplate.findOutputs('*');
        const exportNames = Object.values(outputs).map((o: any) => o.Export?.Name ?? '');
        expect(exportNames.some((name: string) => name.includes('FoodAlb'))).toBe(false);
    });
});

describe('Food worker + service wiring', () => {
    it('provisions the API and the single fetch-worker Fargate services', () => {
        serviceTemplate.resourceCountIs('AWS::ECS::Service', 2);
    });

    it('runs BOTH Fargate services in PUBLIC subnets with assignPublicIp ENABLED (ADR-0004, off the NAT)', () => {
        const services = serviceTemplate.findResources('AWS::ECS::Service');
        const configs = Object.values(services).map(
            (resource: any) => resource.Properties.NetworkConfiguration.AwsvpcConfiguration,
        );

        expect(configs).toHaveLength(2);
        for (const config of configs) {
            expect(config.AssignPublicIp).toBe('ENABLED');
            // The seeded VPC lookup exposes exactly one public subnet (subnet-public-1).
            expect(config.Subnets).toEqual(['subnet-public-1']);
        }
    });
});

describe('Vestigial lambdas removed (Decisions B/C/D)', () => {
    it('keeps ONLY the migration-runner Lambda (bulk-sync / stale-refresh / search-indexer are gone)', () => {
        serviceTemplate.resourceCountIs('AWS::Lambda::Function', 1);

        const fns = serviceTemplate.findResources('AWS::Lambda::Function');
        const logicalIds = Object.keys(fns).join(',');

        expect(logicalIds).not.toMatch(/BulkSync|StaleRefresh|SearchIndexer/);
    });

    it('keeps the FoodEventBus but drops the now-consumer-less FoodFetchCompleted rule', () => {
        serviceTemplate.resourceCountIs('AWS::Events::EventBus', 1);

        const rules = serviceTemplate.findResources('AWS::Events::Rule');
        const detailTypes = JSON.stringify(rules);

        expect(detailTypes).not.toMatch(/FoodFetchCompleted/);
    });
});

describe('In-VPC migration-runner Lambda (T-191)', () => {
    it('creates the migration function in a PRIVATE subnet with the food DB env contract', () => {
        serviceTemplate.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'lambdas/migrate/handler.handler',
            Runtime: 'nodejs22.x',
            Timeout: 300,
            MemorySize: 512,
            Architectures: ['arm64'],
            Environment: {
                Variables: Match.objectLike({
                    STAGE: 'test',
                    FOOD_DB_SECRET_ARN: Match.anyValue(),
                    FOOD_DB_ENDPOINT: Match.anyValue(),
                    FOOD_DB_PORT: Match.anyValue(),
                    FOOD_DB_NAME: Match.anyValue(),
                }),
            },
            VpcConfig: Match.objectLike({
                // PRIVATE_WITH_EGRESS → the seeded private subnet; the ONLY food workload on the NAT.
                SubnetIds: Match.arrayWith(['subnet-private-1']),
            }),
        });
    });

    it('grants the migration function read on the food DB secret', () => {
        serviceTemplate.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
                    }),
                ]),
            }),
        });
    });

    it('exports the migration function name for the deploy-time lambda invoke', () => {
        const outputs = serviceTemplate.findOutputs('*');
        const exportNames = Object.values(outputs).map((o: any) => o.Export?.Name ?? '');

        expect(exportNames.some((name: string) => name.includes('FoodMigrationFunctionName'))).toBe(true);
    });
});

describe('Change-refresh Fargate scheduled task (T-001c)', () => {
    it('defines the IngestionScheduled rule firing an ECS RunTask target in a public subnet', () => {
        serviceTemplate.hasResourceProperties('AWS::Events::Rule', {
            ScheduleExpression: 'rate(6 hours)',
            Targets: Match.arrayWith([
                Match.objectLike({
                    EcsParameters: Match.objectLike({
                        LaunchType: 'FARGATE',
                        TaskCount: 1,
                        NetworkConfiguration: {
                            AwsVpcConfiguration: Match.objectLike({
                                AssignPublicIp: 'ENABLED',
                                Subnets: ['subnet-public-1'],
                            }),
                        },
                    }),
                }),
            ]),
        });
    });

    it('defines a task definition running the change-refresh entrypoint', () => {
        serviceTemplate.hasResourceProperties('AWS::ECS::TaskDefinition', {
            ContainerDefinitions: Match.arrayWith([
                Match.objectLike({
                    Command: ['node', 'dist/worker/change-refresh/main.js'],
                }),
            ]),
        });
    });
});

describe('Observability — dashboard, alarms, SNS (T-182/T-183)', () => {
    it('creates the per-stage food-data dashboard', () => {
        serviceTemplate.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
        serviceTemplate.hasResourceProperties('AWS::CloudWatch::Dashboard', {
            DashboardName: 'test-food-data',
        });
    });

    it('creates the alarm SNS topic', () => {
        serviceTemplate.resourceCountIs('AWS::SNS::Topic', 1);
    });

    it('creates exactly the four food alarms with the correct thresholds', () => {
        serviceTemplate.resourceCountIs('AWS::CloudWatch::Alarm', 4);

        // Tombstone > 0 — reads the EMF metric name straight from the source constant (contract link).
        serviceTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
            Namespace: FOOD_METRIC_NAMESPACE,
            MetricName: FOOD_METRIC.tombstoneCount,
            Threshold: 0,
            ComparisonOperator: 'GreaterThanThreshold',
        });

        // fetch_queue depth > 10,000 (FR-046).
        serviceTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
            Namespace: FOOD_METRIC_NAMESPACE,
            MetricName: FOOD_METRIC.fetchQueueDepth,
            Threshold: 10_000,
        });

        // Oldest-pending age > 5 min.
        serviceTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
            Namespace: FOOD_METRIC_NAMESPACE,
            MetricName: FOOD_METRIC.pendingAgeSeconds,
            Threshold: 300,
        });

        // API error rate > 5% — a MathExpression over the TARGET-group 5xx (ADR-0003), no Namespace.
        serviceTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
            Threshold: 5,
            Metrics: Match.arrayWith([Match.objectLike({ Expression: Match.stringLikeRegexp('errors / requests') })]),
        });
    });
});
