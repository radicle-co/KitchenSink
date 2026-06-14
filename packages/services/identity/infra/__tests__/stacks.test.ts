import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import { DataStack } from '../lib/data-stack.js';
import { NetworkStack } from '../lib/network-stack.js';
import { IdentityServiceStack } from '../lib/identity-service-stack.js';

let dataTemplate: Template;
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

    const network = new NetworkStack(app, 'TestNetwork', { env });

    const data = new DataStack(app, 'TestData', { env, network, stage: 'test' });

    const service = new IdentityServiceStack(app, 'TestService', {
        env,
        stage: 'test',
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        vpcId: 'vpc-12345678',
    });

    dataTemplate = Template.fromStack(data);
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

    it('data stack JSON contains no auth0 in secret description', () => {
        const json = JSON.stringify(dataTemplate.toJSON());
        expect(json.toLowerCase()).not.toContain('auth0');
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
