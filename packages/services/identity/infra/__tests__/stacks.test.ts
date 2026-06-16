import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
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
