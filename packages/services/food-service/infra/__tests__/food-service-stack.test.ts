import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import { FoodServiceStack } from '../lib/food-service-stack.js';

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
});
