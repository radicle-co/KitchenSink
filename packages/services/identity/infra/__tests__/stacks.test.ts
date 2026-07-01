import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import { IdentityServiceStack } from '../lib/identity-service-stack.js';

// NetworkStack/DataStack assertions live with the deployed (global) definitions in
// packages/infra/global/__tests__. This suite covers only the service stack, which
// is what this package owns and deploys.

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

    const service = new IdentityServiceStack(app, 'TestService', {
        env,
        stage: 'test',
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        vpcId: 'vpc-12345678',
    });

    serviceTemplate = Template.fromStack(service);
});

describe('No Auth0 references', () => {
    it('service stack JSON contains no AUTH0_DOMAIN', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_DOMAIN');
    });

    it('service stack JSON contains no AUTH0_CLIENT_ID', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_CLIENT_ID');
    });

    it('service stack JSON contains no AUTH0_CLIENT_SECRET', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_CLIENT_SECRET');
    });
});

describe('Identity env vars present', () => {
    const taskHasEnvVar = (name: string): boolean => {
        const tasks = serviceTemplate.findResources('AWS::ECS::TaskDefinition');

        return Object.values(tasks).some((task: any) =>
            (task.Properties?.ContainerDefinitions ?? []).some((container: any) =>
                (container.Environment ?? []).some((env: any) => env.Name === name),
            ),
        );
    };

    it('service task has AUTH_SECRET_ARN env var', () => {
        expect(taskHasEnvVar('AUTH_SECRET_ARN')).toBe(true);
    });

    it('service task has CLERK_JWT_KEY env var (read-through verification)', () => {
        expect(taskHasEnvVar('CLERK_JWT_KEY')).toBe(true);
    });

    it('service task has CLERK_AUTHORIZED_PARTIES env var (azp enforcement)', () => {
        expect(taskHasEnvVar('CLERK_AUTHORIZED_PARTIES')).toBe(true);
    });
});

describe('Alarms notify via SNS (A4)', () => {
    it('provisions an SNS alarm topic', () => {
        serviceTemplate.resourceCountIs('AWS::SNS::Topic', 1);
    });

    it('wires every CloudWatch alarm to an alarm action (no silent alarms)', () => {
        const alarms = serviceTemplate.findResources('AWS::CloudWatch::Alarm');
        const ids = Object.keys(alarms);
        expect(ids.length).toBeGreaterThanOrEqual(3);
        for (const id of ids) {
            const actions = (alarms[id] as any).Properties?.AlarmActions;
            expect(actions, `${id} has no AlarmActions`).toBeDefined();
            expect(actions.length).toBeGreaterThan(0);
        }
    });

    it('has a boot crash-loop alarm on HealthyHostCount treating missing data as breaching', () => {
        serviceTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
            MetricName: 'HealthyHostCount',
            ComparisonOperator: 'LessThanThreshold',
            Threshold: 1,
            TreatMissingData: 'breaching',
        });
    });
});

describe('Shared ALB topology (no per-service ALB)', () => {
    it('does NOT create its own Application Load Balancer (uses the shared per-stage ALB)', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    });

    it('attaches exactly one host-based listener rule to the shared HTTPS listener', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        serviceTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: 100,
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    HostHeaderConfig: Match.objectLike({
                        Values: ['identity.test.example.com'],
                    }),
                }),
            ]),
        });
    });

    it('still creates exactly one target group', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
    });

    it('still creates the service A-record (aliased to the shared ALB)', () => {
        serviceTemplate.resourceCountIs('AWS::Route53::RecordSet', 1);
        serviceTemplate.hasResourceProperties('AWS::Route53::RecordSet', {
            Type: 'A',
            Name: 'identity.test.example.com.',
        });
    });

    it('no longer exports an IdentityAlbArn (canonical ALB outputs live on the shared ALB stack)', () => {
        const outputs = serviceTemplate.findOutputs('*');
        const exportNames = Object.values(outputs).map((o: any) => o.Export?.Name);
        expect(exportNames).not.toContain('TestService:IdentityAlbArn');
        expect(exportNames).not.toContain('TestService:IdentityAlbDnsName');
    });
});

describe('Per-stage Container Insights (ADR-0007)', () => {
    const insightsValue = (template: Template): string => {
        const clusters = Object.values(template.findResources('AWS::ECS::Cluster'));
        const setting = (clusters[0] as any).Properties.ClusterSettings.find(
            (entry: any) => entry.Name === 'containerInsights',
        );

        return setting.Value;
    };

    it('drops the non-prod (test) identity cluster to STANDARD', () => {
        expect(insightsValue(serviceTemplate)).toBe('enabled');
    });

    it('keeps ENHANCED Container Insights for prod', () => {
        const app = new App({
            context: {
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
        const prodService = new IdentityServiceStack(app, 'ProdService', {
            env,
            stage: 'prod',
            domainName: 'example.com',
            imageTag: 'test',
            desiredCount: 1,
            vpcId: 'vpc-12345678',
        });

        expect(insightsValue(Template.fromStack(prodService))).toBe('enhanced');
    });
});
