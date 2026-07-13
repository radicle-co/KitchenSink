import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    BASE_RECIPE_LISTENER_PRIORITY,
    PER_PR_PRIORITY_BASE,
    recipeDatabaseNameForStage,
    recipeListenerPriorityForStage,
    recipeSubdomainForStage,
    RecipeServiceStack,
} from '../lib/recipe-service-stack.js';

// Pre-seed the VPC lookup so `Vpc.fromLookup` resolves to a dummy VPC during synth instead of an AWS call.
const VPC_LOOKUP_CONTEXT = {
    'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true': {
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
};

function synthTemplate(stage: string, baseStage: string): Template {
    const app = new App({ context: { ...VPC_LOOKUP_CONTEXT } });
    const stack = new RecipeServiceStack(app, `Recipe-${stage}`, {
        env: { account: '123456789012', region: 'us-east-1' },
        stage,
        baseStage,
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        vpcId: 'vpc-12345678',
        cloudfrontUrl: 'https://cdn.example.com',
    });

    return Template.fromStack(stack);
}

describe('recipeListenerPriorityForStage', () => {
    it('uses the fixed recipe priority (300) on a base stage', () => {
        expect(recipeListenerPriorityForStage('sandbox', 'sandbox')).toBe(BASE_RECIPE_LISTENER_PRIORITY);
        expect(BASE_RECIPE_LISTENER_PRIORITY).toBe(300);
    });

    it('allocates per-PR priorities from the per-PR band keyed off the PR number', () => {
        expect(recipeListenerPriorityForStage('pr-73', 'sandbox')).toBe(PER_PR_PRIORITY_BASE + 73);
    });

    it('throws for an out-of-band PR number', () => {
        expect(() => recipeListenerPriorityForStage('pr-99999', 'sandbox')).toThrow(/band width/);
    });
});

describe('recipeSubdomainForStage', () => {
    it('prod → recipe; sandbox → recipe.sandbox; pr-{N} → recipe-pr-{N} (dash form)', () => {
        expect(recipeSubdomainForStage('prod', 'prod')).toBe('recipe');
        expect(recipeSubdomainForStage('sandbox', 'sandbox')).toBe('recipe.sandbox');
        expect(recipeSubdomainForStage('pr-73', 'sandbox')).toBe('recipe-pr-73');
    });
});

describe('recipeDatabaseNameForStage', () => {
    it('base stage uses the imported shared name; per-PR derives an isolated logical DB', () => {
        expect(recipeDatabaseNameForStage('sandbox', 'sandbox', 'kitchensink_recipes')).toBe('kitchensink_recipes');
        expect(recipeDatabaseNameForStage('pr-73', 'sandbox', 'kitchensink_recipes')).toBe('kitchensink_recipes_pr_73');
    });
});

describe('Shared ALB topology (no per-service ALB)', () => {
    let template: Template;

    beforeAll(() => {
        template = synthTemplate('pr-73', 'sandbox');
    });

    it('does NOT create its own load balancer (uses the shared per-stage ALB)', () => {
        template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    });

    it('attaches exactly one host-based listener rule at the per-PR priority', () => {
        template.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: PER_PR_PRIORITY_BASE + 73,
            Conditions: Match.arrayWith([
                Match.objectLike({ Field: 'host-header', HostHeaderConfig: { Values: ['recipe-pr-73.example.com'] } }),
            ]),
        });
    });

    it('creates exactly one target group and one A-record', () => {
        template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
        template.resourceCountIs('AWS::Route53::RecordSet', 1);
    });

    it('provisions exactly one ECS API service (recipe workers are a separate package)', () => {
        template.resourceCountIs('AWS::ECS::Service', 1);
    });

    it('runs the Fargate service in PUBLIC subnets with assignPublicIp ENABLED (ADR-0004, off the NAT)', () => {
        const services = template.findResources('AWS::ECS::Service');
        const config = Object.values(services)[0]?.Properties?.NetworkConfiguration?.AwsvpcConfiguration;
        expect(config?.AssignPublicIp).toBe('ENABLED');
        expect(config?.Subnets).toEqual(['subnet-public-1']);
    });

    it('non-prod wires the azp PATTERN + preview mode (not the exact-match list)', () => {
        const taskDefs = template.findResources('AWS::ECS::TaskDefinition');
        const envAll = Object.values(taskDefs).flatMap((t) =>
            (t.Properties?.ContainerDefinitions ?? []).flatMap((c: { Environment?: { Name: string }[] }) =>
                (c.Environment ?? []).map((e) => e.Name),
            ),
        );
        expect(envAll).toContain('CLERK_AZP_PATTERN');
        expect(envAll).toContain('CLERK_AZP_PREVIEW_MODE');
        expect(envAll).not.toContain('CLERK_AUTHORIZED_PARTIES');
    });
});
