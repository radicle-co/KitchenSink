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
        // Pattern mode rejects azp-less native (@clerk/expo) tokens unless the admission gate is on; the
        // mobile app calls the recipe service directly, so non-prod admits `client_type: 'native'`.
        expect(envAll).toContain('CLERK_ADMIT_NATIVE_CLIENT');
    });
});

/**
 * The account-erasure queue hand-off (T136b / C-007).
 *
 * `accountErasureConfigSchema` makes `ACCOUNT_ERASURE_QUEUE_URL` REQUIRED — the service does not boot
 * without it, deliberately, so a stage wired without a queue fails the deploy loudly instead of degrading
 * every "erase my data" request to a silent cron-tick wait. That choice is only honoured if this stack
 * actually supplies the variable, which is what these tests pin.
 */
describe('Account-erasure queue wiring', () => {
    let template: Template;

    beforeAll(() => {
        template = synthTemplate('sandbox', 'sandbox');
    });

    const apiEnvironment = (t: Template): { Name: string; Value: unknown }[] => {
        const taskDefs = t.findResources('AWS::ECS::TaskDefinition');

        return Object.values(taskDefs).flatMap((def) =>
            (def.Properties?.ContainerDefinitions ?? []).flatMap(
                (container: { Environment?: { Name: string; Value: unknown }[] }) => container.Environment ?? [],
            ),
        );
    };

    it('supplies ACCOUNT_ERASURE_QUEUE_URL to the API task', () => {
        // Without this the container crash-loops on boot: the config schema rejects the missing key.
        expect(apiEnvironment(template).map((entry) => entry.Name)).toContain('ACCOUNT_ERASURE_QUEUE_URL');
    });

    it('injects RECIPE_SERVICE_PRINCIPAL_JWT_KEY so the internal erasure route can verify service tokens (CR-002/U4a)', () => {
        // The API container serves `POST /v1/internal/account/erasure`, whose ServiceErasureAuthService
        // verifies the deletion-worker's single-target EdDSA token against this PUBLIC key. U4a deferred the
        // wiring, so the route fail-closed (401) on every deployed stage — the identity fan-out's recipe leg
        // could never succeed. Mirrors food-service's identical assertion for its own leg.
        expect(apiEnvironment(template).map((entry) => entry.Name)).toContain('RECIPE_SERVICE_PRINCIPAL_JWT_KEY');
    });

    it('reads the service-principal PUBLIC key from the BASE stage (a pr-{N} preview shares the sandbox keypair)', () => {
        // The keypair is per-platform-stage, not per-preview: the identity deletion-worker holds ONE private
        // key per base stage, so a pr-{N} recipe service must verify against that same base-stage public key
        // or every preview erasure 401s. (Contrast ACCOUNT_ERASURE_QUEUE_URL above, which is per-stage.)
        const keyEnv = apiEnvironment(template).find((entry) => entry.Name === 'RECIPE_SERVICE_PRINCIPAL_JWT_KEY');
        // `valueForStringParameter` emits a `Ref` to a synthesized CFN parameter whose logical id is the SSM
        // path with the separators stripped — so assert on that flattened form. It carries the resolved stage,
        // which is what actually matters here: `sandbox` (the BASE stage), never the deploy stage `test`.
        const serialized = JSON.stringify(keyEnv?.Value);

        expect(serialized).toContain('sandboxrecipeserviceprincipaljwtpublickey');
        expect(serialized).not.toContain('testrecipeserviceprincipaljwtpublickey');
    });

    it('sources the queue URL from SSM, not a cross-stack export', () => {
        // The mechanism matters as much as the value. An `Fn.importValue` of a recipe-workers export would
        // lock that export for as long as this stack imports it, and the ADR-0005 PR-close cleanup deletes
        // a PR's stacks with no ordering guarantee — deleting workers first would fail with the
        // export-in-use deadlock ADR-0002 documents, unattended, in CI. SSM carries the value with no lock:
        // either stack can be deleted in any order, and a missing parameter still fails the deploy loudly.
        const queueUrlEnv = apiEnvironment(template).find((entry) => entry.Name === 'ACCOUNT_ERASURE_QUEUE_URL');
        const serialized = JSON.stringify(queueUrlEnv?.Value);

        expect(serialized).toContain('Ref');
        expect(serialized).not.toContain('Fn::ImportValue');
    });

    it('reads the queue from THIS stage, never the base stage', () => {
        // A pr-73 service must not enqueue onto the sandbox queue. The workers stack for pr-73 points its
        // Lambdas at the pr-73 logical DB (ADR-0006), so a sandbox erasure message drained by a pr-73
        // worker would find no job row for that owner — and the worker erases unconditionally, so it would
        // delete that owner's rows out of the pr-73 database while the real sandbox job stayed queued.
        // Unlike the platform imports (VPC/ALB/RDS), which correctly ride `baseStage`, the queue is the
        // feature deploy's OWN resource.
        const prTemplate = synthTemplate('pr-73', 'sandbox');
        const parameters = JSON.stringify(prTemplate.toJSON().Parameters ?? {});

        expect(parameters).toContain('/kitchensink/pr-73/recipe/account-erasure-queue-url');
        expect(parameters).not.toContain('/kitchensink/sandbox/recipe/account-erasure-queue-url');
    });

    it('grants the API task role sqs:SendMessage on the erasure queue and nothing more', () => {
        // ARCH-IT-7: the API produces erasure work; only the worker consumes it. A task role that could
        // receive/delete could drain a right-to-erasure request without performing it.
        const policies = Object.values(template.findResources('AWS::IAM::Policy'));
        const sqsPolicy = policies.find((policy) => JSON.stringify(policy).includes('sqs:SendMessage'));
        const serialized = JSON.stringify(sqsPolicy);

        // The policy resource is the task role's single default policy (it also carries rds-db:connect and
        // S3 grants), so assert the actual SQS statement grants exactly sqs:SendMessage — not just presence.
        expect(sqsPolicy?.Properties?.PolicyDocument?.Statement).toContainEqual(
            expect.objectContaining({ Action: 'sqs:SendMessage', Effect: 'Allow' }),
        );
        expect(serialized).not.toContain('sqs:ReceiveMessage');
        expect(serialized).not.toContain('sqs:DeleteMessage');
    });
});
