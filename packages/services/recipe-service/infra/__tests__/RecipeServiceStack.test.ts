import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { BASE_LISTENER_PRIORITY, EPHEMERAL_SLOT_ORDER, ephemeralBandsForSlot } from '@kitchensink/infra-alb';
import { recipeDatabaseNameForStage } from '@kitchensink/recipe-core/database-name';

import { recipeSubdomainForStage, RecipeServiceStack } from '../lib/RecipeServiceStack.js';

/** Recipe's own per-PR band, read from the allocation authority rather than restated as a literal. */
const RECIPE_PER_PR_BAND = ephemeralBandsForSlot(EPHEMERAL_SLOT_ORDER.indexOf('recipe')).perPr;

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

function synthTemplate(stage: string, baseStage: string, foodServiceUrl?: string): Template {
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
        foodServiceUrl: foodServiceUrl ?? `https://food-${stage}.example.com`,
    });

    return Template.fromStack(stack);
}

/**
 * This stack no longer OWNS a priority resolver. It used to, and that copy is what drifted: its docstring
 * described FOOD's bands, so following the prose put `recipe-pr-{N}` on `food-pr-{N}`. Allocation now lives
 * once in `@kitchensink/infra-alb`, whose suite proves disjointness exhaustively; what belongs here is the
 * wiring — that this stack claims a rule in RECIPE's band, and prod's fixed 300 has not moved.
 */
describe('the listener rule this stack claims on the shared listener', () => {
    it('keeps prod on the fixed 300 already deployed on the live listener', () => {
        expect(BASE_LISTENER_PRIORITY.recipe).toBe(300);

        synthTemplate('prod', 'prod').hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: 300,
        });
    });

    it('lands a per-PR preview in RECIPE`s own band, never in food`s', () => {
        const priorities = Object.values(
            synthTemplate('pr-73', 'sandbox').findResources('AWS::ElasticLoadBalancingV2::ListenerRule'),
        ).map((resource) => resource.Properties.Priority as number);
        const foodBand = ephemeralBandsForSlot(EPHEMERAL_SLOT_ORDER.indexOf('food')).perPr;

        expect(priorities).toHaveLength(1);
        expect(priorities[0]).toBe(RECIPE_PER_PR_BAND.floor + 73);
        // ⛔ MUTATION GUARD: pass `service: 'food'` in the stack and this reds — literally the historical bug.
        expect(priorities[0]).toBeGreaterThan(foodBand.ceiling);
    });
});

describe('recipeSubdomainForStage', () => {
    /**
     * Total by construction. The recipe service is deployed at exactly two kinds of stage — the one
     * persistent PRODUCTION deploy and an ephemeral per-PR preview — so there is no third form for this
     * helper to express, and it takes no `baseStage` to compare against.
     *
     * The dash form is load-bearing: the shared ALB cert covers only single-label wildcards, so a 3-label
     * host fails the TLS handshake. Deploy-stage validity is asserted in `infra/bin/app.ts`, not here.
     */
    it('prod → recipe; every other stage → recipe-{stage} (dash form, covered by *.commise.app)', () => {
        expect(recipeSubdomainForStage('prod')).toBe('recipe');
        expect(recipeSubdomainForStage('pr-73')).toBe('recipe-pr-73');
        expect(recipeSubdomainForStage('team-feature-x')).toBe('recipe-team-feature-x');
    });

    it('never emits a dot after the service label, for ANY stage', () => {
        // The one shape the scheme must never produce: a stage-qualified `recipe.{stage}` host. It is not
        // guarded against — it is unrepresentable, since the only separator this function writes is a dash.
        for (const stage of ['prod', 'sandbox', 'staging', 'pr-1', 'pr-73', 'team-x', 'a.b']) {
            expect(recipeSubdomainForStage(stage)).not.toMatch(/^recipe\./);
        }
    });
});

describe('recipe database name (ADR-0006)', () => {
    /**
     * The RULE itself now lives in `@kitchensink/recipe-core` and is unit-tested there — it had to move so
     * `RecipeWorkersStack` could consume the same authority (#119: the workers previously defaulted to the
     * SHARED database while this stack used the per-PR one). What belongs HERE is the assertion that this
     * stack's synthesized configuration is the rule's output; the cross-stack agreement is pinned by
     * `recipeDatabaseNameParity.test.ts`.
     */
    it('lands the derived per-PR database on the API task definition AND the migration runner', () => {
        const template = synthTemplate('pr-73', 'sandbox');
        const expected = recipeDatabaseNameForStage('pr-73', 'sandbox', 'kitchensink_recipes');

        expect(expected).toBe('kitchensink_recipes_pr_73');
        template.hasResourceProperties('AWS::ECS::TaskDefinition', {
            ContainerDefinitions: Match.arrayWith([
                Match.objectLike({
                    Environment: Match.arrayWith([{ Name: 'DB_NAME', Value: expected }]),
                }),
            ]),
        });
        // The migration runner must target the SAME database, or a preview's schema is applied to the wrong
        // one — the failure mode ADR-0006 exists to prevent.
        template.hasResourceProperties('AWS::Lambda::Function', {
            Environment: Match.objectLike({ Variables: Match.objectLike({ DB_NAME: expected }) }),
        });
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
            Priority: RECIPE_PER_PR_BAND.floor + 73,
            Conditions: Match.arrayWith([
                Match.objectLike({ Field: 'host-header', HostHeaderConfig: { Values: ['recipe-pr-73.example.com'] } }),
            ]),
        });
    });

    it('creates exactly one target group and one A-record', () => {
        template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
        template.resourceCountIs('AWS::Route53::RecordSet', 1);
    });

    // ADR-0011: every VERSIONED endpoint moved under the canonical `/api/{version}/` prefix, but `/health`
    // deliberately did NOT — this target group's health check dials it at the ORIGIN ROOT, and so do the
    // prod/sandbox deploy smoke steps. Nothing in CDK pinned that path before, so a well-meaning "move
    // /health under /api for consistency" would have synthesized a health check against a route the service
    // no longer serves: every task would fail its check, the target group would drain to zero healthy hosts,
    // and the deploy would roll back with no test having objected. This assertion is that objection.
    it('health-checks the UNPREFIXED /health at the origin root (ADR-0011)', () => {
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
            HealthCheckPath: '/health',
            Matcher: { HttpCode: '200' },
        });
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
        // `pr-73` riding `sandbox`, not `sandbox/sandbox`. Two reasons: the recipe service has no persistent
        // non-prod instance (`recipeSubdomainForStage` now refuses that pair), and the base-stage assertion
        // below — that the service-principal key is read from the BASE stage — was VACUOUS while stage and
        // baseStage were the same string. This is also the only non-prod shape CI ever deploys.
        template = synthTemplate('pr-73', 'sandbox');
    });

    const apiEnvironment = (t: Template): { Name: string; Value: unknown }[] => {
        const taskDefs = t.findResources('AWS::ECS::TaskDefinition');

        return Object.values(taskDefs).flatMap((def) =>
            (def.Properties?.ContainerDefinitions ?? []).flatMap(
                (container: { Environment?: { Name: string; Value: unknown }[] }) => container.Environment ?? [],
            ),
        );
    };

    it('supplies FOOD_SERVICE_URL to the API task, with the value the deploy passed in (issue #120)', () => {
        // THE regression this pins. The prop used to be optional and set behind
        // `if (props.foodServiceUrl !== undefined)`, and nothing in `.github/` ever supplied
        // `RECIPE_FOOD_SERVICE_URL` — so the live pr-73 task definition carried ZERO `FOOD_*` variables and
        // the service fell back to `http://localhost:3002`: itself, on food's port. Every cross-service call
        // was connection-refused, and `FoodCatalogGateway` being total meant nothing ever said so. The prop is
        // now REQUIRED, so a deploy cannot synthesize a task that has not been told where food is.
        const foodEnv = apiEnvironment(template).find((entry) => entry.Name === 'FOOD_SERVICE_URL');

        expect(foodEnv).toBeDefined();
        expect(foodEnv?.Value).toBe('https://food-pr-73.example.com');
    });

    it('does NOT supply a FOOD_SERVICE_TOKEN — food is called with the caller’s own Clerk token', () => {
        // A static env bearer cannot satisfy food's Clerk verifier, so there is no service credential to
        // inject. Re-introducing one here would be a step back toward the seam #120 removed.
        expect(apiEnvironment(template).map((entry) => entry.Name)).not.toContain('FOOD_SERVICE_TOKEN');
    });

    it('supplies ACCOUNT_ERASURE_QUEUE_URL to the API task', () => {
        // Without this the container crash-loops on boot: the config schema rejects the missing key.
        expect(apiEnvironment(template).map((entry) => entry.Name)).toContain('ACCOUNT_ERASURE_QUEUE_URL');
    });

    it('injects RECIPE_SERVICE_PRINCIPAL_JWT_KEY so the internal erasure route can verify service tokens (CR-002/U4a)', () => {
        // The API container serves `POST /api/v1/internal/account/erasure`, whose ServiceErasureAuthService
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

/**
 * The food-service origin the ingredients vertical calls (issue #120).
 *
 * `RECIPE_FOOD_SERVICE_URL` reaches this stack through `infra/bin/app.ts` and is written straight into the
 * task definition, so a blank or relative value is a misconfiguration that would otherwise surface as
 * crash-looping tasks and a CloudFormation rollback several minutes later. A GitHub Actions expression that
 * resolves to nothing (an unset step output, a renamed step id) produces exactly that blank. Failing at
 * SYNTH instead names the variable while the deploy log is still on screen.
 */
describe('foodServiceUrl validation', () => {
    it.each([
        ['an empty string', ''],
        ['whitespace', '   '],
        ['a bare host', 'food-pr-73.example.com'],
    ])('refuses to synthesize with %s', (_label, value) => {
        expect(() => synthTemplate('pr-73', 'sandbox', value)).toThrow(/RECIPE_FOOD_SERVICE_URL/);
    });

    it('accepts an absolute https origin', () => {
        expect(() => synthTemplate('pr-73', 'sandbox', 'https://food-pr-73.example.com')).not.toThrow();
    });

    it('accepts an absolute http origin (a local/dev-style target is not this layer’s business)', () => {
        expect(() => synthTemplate('pr-73', 'sandbox', 'http://food.internal:3002')).not.toThrow();
    });
});

/**
 * ADR-0020 / plan U15 — the internal ORIGIN host this service answers on behind the CloudFront edge.
 *
 * Additive by construction: prod gains a SECOND host on its existing rule plus a matching A-record, and the
 * public name keeps serving from the ALB untouched. U17 removes the public host, per service, once the
 * distribution owns the public record.
 *
 * Pinned here because neither failure is visible in a green synth: a SECOND listener rule (instead of a
 * second condition) would have to claim a priority on a namespace shared across stacks and fail the prod
 * deploy with `Priority 'N' is currently in use` (ADR-0003); and a record naming anything other than the
 * host the rule matches yields an origin that resolves to nothing, surfacing only in U16.
 */
describe('the internal-origin host (prod only, ADR-0020 / U15)', () => {
    const internalHost = 'recipe.internal.example.com';

    it('matches BOTH the public and the internal host on the SAME rule in prod', () => {
        const template = synthTemplate('prod', 'prod');

        template.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    // Exact, and public FIRST: nothing has cut over, so the public name must still match.
                    HostHeaderConfig: Match.objectLike({ Values: ['recipe.example.com', internalHost] }),
                }),
            ]),
        });
    });

    it('keeps its live prod priority — an in-place condition update, never a rule replacement', () => {
        synthTemplate('prod', 'prod').hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_LISTENER_PRIORITY.recipe,
        });
    });

    it('publishes the internal A-record at exactly the host the rule matches', () => {
        const template = synthTemplate('prod', 'prod');

        template.resourceCountIs('AWS::Route53::RecordSet', 2);
        template.hasResourceProperties('AWS::Route53::RecordSet', { Type: 'A', Name: `${internalHost}.` });
    });

    it('aliases the internal record to the SAME shared ALB as the public one', () => {
        const records = Object.values(synthTemplate('prod', 'prod').findResources('AWS::Route53::RecordSet')) as Array<{
            Properties: { Name: string; AliasTarget?: unknown };
        }>;
        const publicRecord = records.find((r) => r.Properties.Name === 'recipe.example.com.');
        const internalRecord = records.find((r) => r.Properties.Name === `${internalHost}.`);

        expect(publicRecord?.Properties.AliasTarget).toBeDefined();
        expect(internalRecord?.Properties.AliasTarget).toEqual(publicRecord?.Properties.AliasTarget);
    });

    it('creates nothing internal outside prod — no other stage has the *.internal certificate', () => {
        for (const [stage, baseStage] of [
            ['pr-73', 'sandbox'],
            ['sandbox', 'sandbox'],
        ]) {
            const template = synthTemplate(stage as string, baseStage as string);

            template.resourceCountIs('AWS::Route53::RecordSet', 1);
            expect(JSON.stringify(template.toJSON())).not.toContain('recipe.internal.');
        }
    });
});
