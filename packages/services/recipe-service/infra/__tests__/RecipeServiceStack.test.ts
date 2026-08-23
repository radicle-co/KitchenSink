import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import {
    BASE_LISTENER_PRIORITY,
    EDGE_CUTOVER_SERVICES_ENV,
    EDGE_ORIGIN_HEADER_NAME,
    EPHEMERAL_SLOT_ORDER,
    edgeOriginHeaderFor,
    ephemeralBandsForSlot,
} from '@kitchensink/infra-alb';
import { recipeDatabaseNameForStage } from '@kitchensink/recipe-core/database-name';

import { recipeSubdomainForStage, RecipeServiceStack } from '../lib/RecipeServiceStack.js';

/** Recipe's own per-PR band, read from the allocation authority rather than restated as a literal. */
const RECIPE_PER_PR_BAND = ephemeralBandsForSlot(EPHEMERAL_SLOT_ORDER.indexOf('recipe')).perPr;

/**
 * Every value the listener rules demand for the secret origin header (ADR-0020 / U17).
 *
 * Collected across ALL rules and conditions rather than asserted positionally, so a header condition added
 * to the wrong rule, or a second rule carrying it, is visible rather than matched by luck.
 *
 * @param template - A synthesized template.
 * @returns The condition values, in template order.
 */
function ruleHeaderConditionValues(template: Template): readonly string[] {
    return Object.values(template.findResources('AWS::ElasticLoadBalancingV2::ListenerRule')).flatMap(
        (rule) =>
            (
                rule as {
                    Properties: {
                        Conditions?: readonly {
                            HttpHeaderConfig?: { HttpHeaderName?: string; Values?: readonly string[] };
                        }[];
                    };
                }
            ).Properties.Conditions?.filter(
                (condition) => condition.HttpHeaderConfig?.HttpHeaderName === EDGE_ORIGIN_HEADER_NAME,
            ).flatMap((condition) => condition.HttpHeaderConfig?.Values ?? []) ?? [],
    );
}

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
 * The VERIFICATION queue hand-off (plan U11 / ADR-0024) — the producer's other half.
 *
 * ⛔ THE FAILURE THESE PIN ALREADY HAPPENED. U11 shipped the gate's consumer complete — a Lambda, its queue
 * and DLQ, its `bedrock:InvokeModel` grant, its EMF alarms and its spend ledger — and `RecipeWorkersStack`
 * published `/kitchensink/{stage}/recipe/verification-queue-url` under the comment "cross-stack hand-off to
 * recipe-service's PRODUCER". Nothing read it. The gate was deployed, alarmed, and verified nothing, behind
 * a fully green repository.
 *
 * `ingredientVerificationConfigSchema` now makes the URL REQUIRED, so the container refuses to boot without
 * it — and that choice is only honoured if this stack supplies it, which is what these tests are for.
 */
describe('Ingredient-verification queue wiring', () => {
    let template: Template;

    beforeAll(() => {
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

    it('supplies INGREDIENT_VERIFICATION_QUEUE_URL to the API task', () => {
        // Without this the container crash-loops on boot: the config schema rejects the missing key.
        expect(apiEnvironment(template).map((entry) => entry.Name)).toContain('INGREDIENT_VERIFICATION_QUEUE_URL');
    });

    it('sources it from SSM, not a cross-stack export', () => {
        // Same reason as the erasure queue: an `Fn.importValue` locks the workers export while this stack
        // references it, and ADR-0005's PR-close cleanup deletes a PR's stacks in no guaranteed order.
        const serialized = JSON.stringify(
            apiEnvironment(template).find((entry) => entry.Name === 'INGREDIENT_VERIFICATION_QUEUE_URL')?.Value,
        );

        expect(serialized).toContain('Ref');
        expect(serialized).not.toContain('Fn::ImportValue');
    });

    it('reads the queue from THIS stage, never the base stage', () => {
        // ⛔ A pr-73 service must not enqueue onto the sandbox queue. The pr-73 worker points at the pr-73
        // logical database (ADR-0006), and ADR-0024's spend counter lives in that database — so a message
        // crossing stages would be judged against, and BILLED against, the wrong stage's ceiling.
        const parameters = JSON.stringify(template.toJSON().Parameters ?? {});

        expect(parameters).toContain('/kitchensink/pr-73/recipe/verification-queue-url');
        expect(parameters).not.toContain('/kitchensink/sandbox/recipe/verification-queue-url');
    });

    it('grants sqs:SendMessage scoped to the verification queue ARN, and NOTHING else on it', () => {
        // The API PRODUCES verification work; only the gate Lambda consumes it. A task role that could
        // receive would let the API drain requests without verifying them.
        //
        // ⛔ ASSERTED ON THE STATEMENT'S ACTION LIST, not on string-ABSENCE over the template. The earlier
        // version checked only that `sqs:ReceiveMessage` and `sqs:DeleteMessage` appeared nowhere — so
        // mutating `actions: ['sqs:SendMessage']` to `['sqs:*']` kept it green while handing the API receive
        // AND delete on the queue. A negative assertion cannot see a wildcard.
        const parameters = JSON.stringify(template.toJSON().Parameters ?? {});

        expect(parameters).toContain('/kitchensink/pr-73/recipe/verification-queue-arn');

        const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
            (policy: { Properties?: { PolicyDocument?: { Statement?: unknown[] } } }) =>
                policy.Properties?.PolicyDocument?.Statement ?? [],
        );
        const verificationStatements = statements.filter((statement) =>
            JSON.stringify(statement).includes('verificationqueuearn'),
        );

        // Exactly one statement names this queue, and its action list is exactly one action.
        expect(verificationStatements).toHaveLength(1);
        expect(verificationStatements[0]).toMatchObject({ Action: 'sqs:SendMessage', Effect: 'Allow' });
    });

    it('does NOT grant the API task bedrock:InvokeModel — ADR-0024 layer 4b keeps that to ONE role', () => {
        // ⛔ The producer's whole reason for existing is that recipe-service CANNOT call Bedrock. Layer 4b is
        // the only bypass control the design has: "a permission nobody else holds cannot be bypassed; a
        // metric nobody else emits cannot notice."
        expect(JSON.stringify(template.toJSON())).not.toContain('bedrock:InvokeModel');
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

/**
 * ⛔ THE ACCEPTANCE CRITERION for recipe's half of the U17 DNS cutover — the SECOND service to cut over,
 * after food and before identity.
 *
 * U15 gave prod's listener rule a second host while the public name kept serving. U17 closes the old door:
 * `recipe.example.com` stops being this stack's Route 53 record (EdgeStack publishes it, aliased to the
 * distribution) and stops being a host this rule answers on. Both halves must move together — keeping the
 * record without the condition leaves the public name resolving to an ALB that 404s it (ADR-0003's default
 * action); keeping the condition without the record leaves a rule matching a name nothing resolves to.
 */
describe('the U17 DNS cutover (prod only, ADR-0020)', () => {
    const internalHost = 'recipe.internal.example.com';
    const publicHost = 'recipe.example.com';

    /**
     * Synthesize prod with a given cut-over set, restoring the environment afterwards.
     *
     * @param cutOver - The `EDGE_CUTOVER_SERVICES` value, or `undefined` to leave it unset.
     * @returns The synthesized prod template.
     * @sideEffect Temporarily mutates `process.env`.
     */
    function synthProdWithCutover(cutOver: string | undefined): Template {
        const previous = process.env[EDGE_CUTOVER_SERVICES_ENV];

        if (cutOver === undefined) {
            delete process.env[EDGE_CUTOVER_SERVICES_ENV];
        } else {
            process.env[EDGE_CUTOVER_SERVICES_ENV] = cutOver;
        }

        try {
            return synthTemplate('prod', 'prod');
        } finally {
            if (previous === undefined) {
                delete process.env[EDGE_CUTOVER_SERVICES_ENV];
            } else {
                process.env[EDGE_CUTOVER_SERVICES_ENV] = previous;
            }
        }
    }

    /**
     * Every host this template's listener rules answer on.
     *
     * @param template - The synthesized template.
     * @returns The flattened host-header values.
     */
    function ruleHosts(template: Template): readonly string[] {
        return Object.values(template.findResources('AWS::ElasticLoadBalancingV2::ListenerRule')).flatMap(
            (rule) =>
                (
                    rule as {
                        Properties: { Conditions?: readonly { HostHeaderConfig?: { Values?: string[] } }[] };
                    }
                ).Properties.Conditions?.flatMap((condition) => condition.HostHeaderConfig?.Values ?? []) ?? [],
        );
    }

    it('changes NOTHING when the cutover has not been declared — an unset variable is not a cutover', () => {
        const template = synthProdWithCutover(undefined);

        template.resourceCountIs('AWS::Route53::RecordSet', 2);
        template.hasResourceProperties('AWS::Route53::RecordSet', { Type: 'A', Name: `${publicHost}.` });
        expect(ruleHosts(template)).toEqual([publicHost, internalHost]);
    });

    it('⛔ releases the public A-record once recipe has cut over, so EdgeStack can claim it', () => {
        const template = synthProdWithCutover('recipe');
        const names = Object.values(template.findResources('AWS::Route53::RecordSet')).map(
            (record) => (record as { Properties: { Name: string } }).Properties.Name,
        );

        expect(names).not.toContain(`${publicHost}.`);
        // The internal record STAYS — it is what the distribution origins at, and it is this stack's.
        expect(names).toContain(`${internalHost}.`);
        template.resourceCountIs('AWS::Route53::RecordSet', 1);
    });

    it('⛔ stops answering on the public host once recipe has cut over, leaving only the origin host', () => {
        // Asserted on the RULE, not the whole template: `recipe.example.com` legitimately survives as this
        // service's own published origin, which is the point of the cutover — callers keep addressing the
        // public name, which now resolves to CloudFront. What must go is the ALB answering it directly.
        expect(ruleHosts(synthProdWithCutover('recipe'))).toEqual([internalHost]);
    });

    it('keeps its OWN priority through the cutover — the rule is edited, never replaced', () => {
        // A rule that changed priority would collide with whatever holds the old one (ADR-0003).
        synthProdWithCutover('recipe').hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_LISTENER_PRIORITY.recipe,
        });
    });

    it('is unmoved by food cutting over FIRST — U17 cuts one at a time', () => {
        // The sequencing guarantee: food going first must leave recipe exactly as it was, or the
        // "verify between each" step is verifying a system that already moved underneath it.
        const template = synthProdWithCutover('food');

        template.resourceCountIs('AWS::Route53::RecordSet', 2);
        expect(ruleHosts(template)).toEqual([publicHost, internalHost]);
    });

    it('⛔ ignores the cut-over set entirely outside prod, where there is no distribution to cut over TO', () => {
        // The worst available outcome: a stray variable in a sandbox or per-PR deploy deleting the only
        // record that preview has.
        const previous = process.env[EDGE_CUTOVER_SERVICES_ENV];
        process.env[EDGE_CUTOVER_SERVICES_ENV] = 'food,recipe,identity';

        try {
            for (const [stage, baseStage] of [
                ['sandbox', 'sandbox'],
                ['pr-91', 'sandbox'],
            ]) {
                const template = synthTemplate(stage as string, baseStage as string);

                template.resourceCountIs('AWS::Route53::RecordSet', 1);
                expect(ruleHosts(template)).toEqual([`recipe-${stage}.example.com`]);
            }
        } finally {
            if (previous === undefined) {
                delete process.env[EDGE_CUTOVER_SERVICES_ENV];
            } else {
                process.env[EDGE_CUTOVER_SERVICES_ENV] = previous;
            }
        }
    });
});

/**
 * ⛔ THE ACCEPTANCE CRITERION for the secret origin header, recipe's ALB side (plan U17, ADR-0020 trap 5).
 *
 * The prefix-list restriction on prod's ALB authorizes **CloudFront**, not **our** CloudFront:
 * `recipe.internal.example.com` is published in the PUBLIC zone, so anyone may point their own distribution
 * at it and reach this target group with the edge verifier out of the path. The header is the boundary.
 *
 * Three properties are pinned because each fails in a way a green synth cannot show:
 *
 *   - **an additional condition on the EXISTING rule, never a second rule** — priority is one namespace
 *     shared across independently-deployed stacks, so a second rule must claim one and the deploy dies with
 *     `Priority 'N' is currently in use` (ADR-0003);
 *   - **prod only** — sandbox and every per-PR preview have no distribution to send the header, and a rule
 *     demanding it there matches nothing and answers ADR-0003's default 404 to the entire preview; and
 *   - **≤ 5 conditions** — ALB's per-rule limit, which a third or fourth condition would silently approach.
 */
describe('the secret origin header condition (prod only, ADR-0020 / U17)', () => {
    it('⛔ requires the header on the SAME rule as the host condition, never a second rule', () => {
        const header = edgeOriginHeaderFor('prod');
        const template = synthTemplate('prod', 'prod');

        expect(header).toBeDefined();
        template.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'http-header',
                    HttpHeaderConfig: Match.objectLike({ HttpHeaderName: header!.headerName }),
                }),
            ]),
        });
    });

    it('⛔ matches a dynamic REFERENCE, never a literal — this repository is public', () => {
        const values = ruleHeaderConditionValues(synthTemplate('prod', 'prod'));

        expect(values).toHaveLength(1);
        expect(values[0]).toMatch(/^\{\{resolve:secretsmanager:/u);
    });

    it('⛔ adds NO header condition on any other stage — nothing there sends it', () => {
        for (const [stage, baseStage] of [
            ['sandbox', 'sandbox'],
            ['pr-91', 'sandbox'],
            ['test', 'sandbox'],
        ]) {
            const template = synthTemplate(stage as string, baseStage as string);

            expect(ruleHeaderConditionValues(template), `stage ${stage}`).toEqual([]);
            expect(JSON.stringify(template.toJSON()), `stage ${stage}`).not.toContain(EDGE_ORIGIN_HEADER_NAME);
        }
    });

    it('keeps its live prod priority — an in-place condition update, never a rule replacement', () => {
        synthTemplate('prod', 'prod').hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_LISTENER_PRIORITY.recipe,
        });
    });

    it('stays within ALB\u2019s five-condition ceiling', () => {
        const rules = Object.values(
            synthTemplate('prod', 'prod').findResources('AWS::ElasticLoadBalancingV2::ListenerRule'),
        ) as Array<{ Properties: { Conditions?: readonly unknown[] } }>;

        for (const rule of rules) {
            expect(rule.Properties.Conditions ?? []).toHaveLength(2);
            expect((rule.Properties.Conditions ?? []).length).toBeLessThanOrEqual(5);
        }
    });

    it('survives the cutover — the header is the boundary AFTER the public host is dropped', () => {
        // The cutover removes the public host from the rule, leaving the origin host as the only match. If
        // the header condition went with it, the origin would be reachable by anyone who resolves the name.
        const previous = process.env[EDGE_CUTOVER_SERVICES_ENV];
        process.env[EDGE_CUTOVER_SERVICES_ENV] = 'recipe';

        try {
            expect(ruleHeaderConditionValues(synthTemplate('prod', 'prod'))).toHaveLength(1);
        } finally {
            if (previous === undefined) {
                delete process.env[EDGE_CUTOVER_SERVICES_ENV];
            } else {
                process.env[EDGE_CUTOVER_SERVICES_ENV] = previous;
            }
        }
    });
});

/**
 * The schema-before-traffic gate (the prod deploy-ordering hazard) — the recipe half.
 *
 * The mechanism and the reasoning are identical to food's (see
 * `packages/services/food-service/infra/__tests__/FoodServiceStack.test.ts`): `cdk deploy` returns only once
 * ECS has stabilised, so deploy-then-migrate serves the new image against the old schema for the whole
 * stabilisation window, and the obvious repair (migrate first, in the pipeline) invokes the PREVIOUS
 * deploy's bundle and applies nothing. Only a trigger inside the deploy can order the two.
 *
 * ⚠️ RECIPE IS THE SERVICE WHERE THIS CHANGES THE POLICY, so record it here rather than in a report nobody
 * will find. Migration `0019_drop_duplicated_nutrition.sql` is CONTRACTING — it drops seven columns — and
 * its own header states "Production deploys CODE BEFORE MIGRATING", which was true and was the right order
 * for it: dropping a column the running code still reads is an outage, and deploy-first meant the readers
 * were gone before the drop. That is no longer the order. From here the invariant is EXPAND-FIRST: every
 * migration must be safe to apply while the PREVIOUS release is still serving, so a contracting migration
 * ships in a LATER release than the code that stopped reading the column — never in the same one. That is
 * the standard expand/contract discipline, and it is strictly safer than the order it replaces, because a
 * rolling ECS deployment runs old and new tasks CONCURRENTLY: same-release contraction was only ever safe
 * by virtue of `cdk deploy` having already drained the old tasks, which is a property of the pipeline, not
 * of the change.
 */
describe('the in-deploy schema-migration gate (ECS must not serve before the schema exists)', () => {
    /** Resource shape as `Template.findResources` returns it — `DependsOn` included, which is the point. */
    interface SynthesizedResource {
        readonly Properties?: Record<string, unknown>;
        readonly DependsOn?: string | readonly string[];
    }

    /**
     * The logical ID the stack's `*MigrationFunctionName` output points at — i.e. the function the
     * production pipeline resolves and invokes. Everything below is anchored to THIS function so the
     * in-deploy gate cannot silently drift onto a different one.
     *
     * @param template - A synthesized template.
     * @returns The migration function's logical ID.
     */
    function pipelineInvokedMigrationFunctionId(template: Template): string {
        const outputs = template.findOutputs('*') as Record<string, { Value?: { Ref?: string } }>;
        const entry = Object.entries(outputs).find(([name]) => name.endsWith('MigrationFunctionName'));

        expect(entry, 'the stack must still export the migration function the pipeline invokes').toBeDefined();

        const ref = entry?.[1].Value?.Ref;

        expect(typeof ref, 'the migration-function output must be a Ref to a function in this stack').toBe('string');

        return ref as string;
    }

    /** `DependsOn` is a string OR an array in CloudFormation; normalize before asserting membership. */
    const dependsOn = (resource: SynthesizedResource): readonly string[] =>
        typeof resource.DependsOn === 'string' ? [resource.DependsOn] : (resource.DependsOn ?? []);

    it('runs the migration runner during the deploy, as a trigger on the function CI invokes', () => {
        const template = synthTemplate('pr-7', 'sandbox');
        const migrationFunctionId = pipelineInvokedMigrationFunctionId(template);
        const versions = Object.entries(template.findResources('AWS::Lambda::Version')) as Array<
            [string, { Properties: { FunctionName: { Ref?: string } } }]
        >;

        expect(versions).toHaveLength(1);
        expect(versions[0]?.[1].Properties.FunctionName).toEqual({ Ref: migrationFunctionId });

        const triggers = Object.entries(template.findResources('Custom::Trigger'));

        expect(triggers, 'the stack must define exactly one in-deploy migration trigger').toHaveLength(1);
        // Destructured rather than optional-chained through the cast: `(x?.y as T).z` short-circuits to
        // `undefined` and THEN dereferences, so a missing trigger would throw a TypeError instead of
        // failing the assertion above with its message. oxlint flags exactly that (no-unsafe-optional-chaining).
        const trigger = triggers[0]?.[1] as SynthesizedResource | undefined;
        const versionLogicalId = versions[0]?.[0];

        expect(trigger, 'the trigger resource must be present to inspect').toBeDefined();
        expect(versionLogicalId, 'the runner must publish a version for the trigger to key on').toBeDefined();
        expect(JSON.stringify(trigger?.Properties?.['HandlerArn'])).toContain(versionLogicalId);

        // `executeAfter(migrationFn)`, read back out of the template. The runner's `rds-db:connect` grant
        // lands on its OWN role, inside the function's construct subtree, and the custom resource only
        // *references* the version — so without this edge CloudFormation is free to invoke the trigger
        // before that policy exists, and the first deploy of any new stage dies on an auth error.
        const triggerDependsOn = dependsOn(triggers[0]?.[1] as SynthesizedResource);

        expect(triggerDependsOn).toContain(migrationFunctionId);
        expect(
            triggerDependsOn.some((id) => /ServiceRoleDefaultPolicy/.test(id)),
            'the trigger must wait for the runner role policy that carries its rds-db:connect grant',
        ).toBe(true);
    });

    it('holds EVERY Fargate service in this stack behind that trigger', () => {
        const template = synthTemplate('pr-7', 'sandbox');
        const [triggerId] = Object.keys(template.findResources('Custom::Trigger'));
        const services = Object.entries(template.findResources('AWS::ECS::Service')) as Array<
            [string, SynthesizedResource]
        >;

        expect(services.length, 'expected the recipe API service').toBeGreaterThanOrEqual(1);

        for (const [serviceId, service] of services) {
            expect(dependsOn(service), `${serviceId} must not roll out before the migration trigger has run`).toContain(
                triggerId,
            );
        }
    });

    it('gives the trigger longer to wait than the runner is allowed to take', () => {
        const template = synthTemplate('pr-7', 'sandbox');
        const migrationFunctionId = pipelineInvokedMigrationFunctionId(template);
        const runner = template.findResources('AWS::Lambda::Function')[migrationFunctionId] as {
            Properties: { Timeout: number };
        };
        const [trigger] = Object.values(template.findResources('Custom::Trigger')) as SynthesizedResource[];

        expect(Number(trigger?.Properties?.['Timeout'])).toBeGreaterThanOrEqual(runner.Properties.Timeout * 1000);
        expect(trigger?.Properties?.['ExecuteOnHandlerChange']).toBe(true);
    });
});
