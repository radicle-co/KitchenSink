import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import {
    BASE_LISTENER_PRIORITY,
    EDGE_CUTOVER_SERVICES_ENV,
    EDGE_ORIGIN_HEADER_NAME,
    EPHEMERAL_SLOT_ORDER,
    edgeOriginHeaderFor,
    ephemeralBandsForSlot,
    listenerPriorityForStage,
} from '@kitchensink/infra-alb';
import { NODE_LAMBDA_RUNTIME } from '@kitchensink/infra-security';

import {
    FoodServiceStack,
    foodDatabaseNameForStage,
    foodServiceOriginForStage,
    foodSubdomainForStage,
} from '../lib/FoodServiceStack.js';

/**
 * The migration runner's handler entry, derived the way `FoodServiceStack` derives it.
 *
 * The stack ships the real bundle when `dist-lambda/` exists and an inline placeholder otherwise, and the
 * two have different entry points. CI never bundles before the unit tier, so a literal here is a test that
 * only passes on a developer machine that happened to have built.
 */
const MIGRATION_HANDLER = existsSync(resolve(fileURLToPath(import.meta.url), '../../../dist-lambda'))
    ? 'lambdas/migrate/handler.handler'
    : 'index.handler';

/** Food's own per-PR band, read from the allocation authority rather than restated as a literal. */
const FOOD_PER_PR_BAND = ephemeralBandsForSlot(EPHEMERAL_SLOT_ORDER.indexOf('food')).perPr;

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

/**
 * The VPC-lookup context every synth in this suite shares — `Vpc.fromLookup` resolves to this dummy
 * VPC instead of calling AWS. The lookup key ignores `stage`, so one seeded entry serves prod/pr-N too.
 */
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

/**
 * Synthesize a food service template for a stage/baseStage pair.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The platform stage it imports from.
 * @returns The synthesized template.
 */
function synthFoodTemplate(stage: string, baseStage: string): Template {
    const app = new App({ context: { ...VPC_LOOKUP_CONTEXT } });
    const stack = new FoodServiceStack(app, `Food-${stage}`, {
        env: { account: '123456789012', region: 'us-east-1' },
        stage,
        baseStage,
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        workerDesiredCount: 1,
        vpcId: 'vpc-12345678',
    });

    return Template.fromStack(stack);
}

// A THIRD copy of the metric names, after `src/observability/emfMetrics.ts` and the stack's own — the
// infra tsconfig's `rootDir` forbids importing across the src↔infra boundary (TS6059), so none of the
// three can reference another. Be clear about what this buys: asserting the synthesized template uses
// these literals proves the template matches THIS file, not that the worker emits them. The
// emitter↔alarm agreement is enforced repo-wide by
// `packages/infra/global/__tests__/serviceInfraWiringInvariants.test.ts` W3.
const FOOD_METRIC_NAMESPACE = 'Commise/Food';
const FOOD_METRIC = {
    fetchQueueDepth: 'food-fetch-queue-depth',
    retryBudgetExhausted: 'food-retry-budget-exhausted',
    tombstoneCount: 'food-tombstone-count',
    pendingAgeSeconds: 'food-fetch-pending-age-seconds',
    localStoreServeRate: 'food-local-store-serve-rate',
    sourceRollingWindowCount: 'source-rolling-window-count',
    sourceRateLimitRemaining: 'source-rate-limit-remaining',
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
        // `baseStage` is now REQUIRED in practice for any non-prod stage: the stack defaults it to `stage`,
        // and `foodSubdomainForStage` refuses `stage === baseStage` outside prod because that names a
        // persistent non-prod instance, which the food service does not have. So this suite synthesizes the
        // real ephemeral shape — a named stage riding the shared sandbox platform, exactly like `pr-{N}`.
        baseStage: 'sandbox',
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

    it('attaches exactly one host-based listener rule to the shared HTTPS listener', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        serviceTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            // Derived, not the literal 200: `test` is an EPHEMERAL named stage riding the sandbox platform,
            // so it draws from the named-stage band. 200 is prod's base priority, and asserting it here
            // would only have held while this suite synthesized the forbidden `stage === baseStage` shape.
            Priority: listenerPriorityForStage({ service: 'food', stage: 'test', baseStage: 'sandbox' }),
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    HostHeaderConfig: Match.objectLike({
                        // The DASH form — a 3-label `food.test.example.com` matches no wildcard cert.
                        Values: ['food-test.example.com'],
                    }),
                }),
            ]),
        });
    });

    it('creates exactly one target group', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
    });

    // ADR-0011: every VERSIONED endpoint moved under the canonical `/api/{version}/` prefix, but `/health`
    // deliberately did NOT — this target group's health check dials it at the ORIGIN ROOT, and so do the
    // prod/sandbox deploy smoke steps. Nothing in CDK pinned that path before, so a well-meaning "move
    // /health under /api for consistency" would have synthesized a health check against a route the service
    // no longer serves: every task would fail its check, the target group would drain to zero healthy hosts,
    // and the deploy would roll back with no test having objected. This assertion is that objection.
    it('health-checks the UNPREFIXED /health at the origin root (ADR-0011)', () => {
        serviceTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
            HealthCheckPath: '/health',
            Matcher: { HttpCode: '200' },
        });
    });

    it('creates the service A-record (aliased to the shared ALB)', () => {
        serviceTemplate.resourceCountIs('AWS::Route53::RecordSet', 1);
        serviceTemplate.hasResourceProperties('AWS::Route53::RecordSet', {
            Type: 'A',
            Name: 'food-test.example.com.',
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

    it('injects USDA_API_KEY from Secrets Manager (never as plaintext container env)', () => {
        const taskDefs = serviceTemplate.findResources('AWS::ECS::TaskDefinition');
        const containers = Object.values(taskDefs).flatMap(
            (resource: any) => resource.Properties.ContainerDefinitions as any[],
        );

        // Every long-running container that needs the source credential (api, worker, change-refresh)
        // declares USDA_API_KEY in `Secret` (→ Secrets Manager ValueFrom), and NONE leaks it as plaintext
        // `Environment` — so the key never lands in the CloudFormation template (ADR-0004 secret hygiene).
        const withUsdaSecret = containers.filter((c) => (c.Secrets ?? []).some((s: any) => s.Name === 'USDA_API_KEY'));
        expect(withUsdaSecret).toHaveLength(3);

        for (const container of containers) {
            const envNames = (container.Environment ?? []).map((e: any) => e.Name);
            expect(envNames).not.toContain('USDA_API_KEY');
        }
    });

    // Every container's env names (across all task definitions in a template).
    const containerEnvSets = (template: Template): string[][] =>
        Object.values(template.findResources('AWS::ECS::TaskDefinition'))
            .flatMap((resource: any) => resource.Properties.ContainerDefinitions as any[])
            .map((container) => (container.Environment ?? []).map((entry: any) => entry.Name as string));

    it('injects FOOD_SERVICE_PRINCIPAL_JWT_KEY so the internal erasure route can verify service tokens (CR-002/U4b/R11)', () => {
        // The API container (which serves /api/v1/internal/account/erasure) carries the PUBLIC verification key.
        // Without it the FoodServiceErasureAuthService fail-closes and every service-principal erase is 401.
        const withErasureKey = containerEnvSets(synthFoodTemplate('test', 'sandbox')).filter((envNames) =>
            envNames.includes('FOOD_SERVICE_PRINCIPAL_JWT_KEY'),
        );

        expect(withErasureKey.length).toBeGreaterThanOrEqual(1);
    });

    it('non-prod wires Clerk auth env with the azp PATTERN + preview mode (not the exact-match list)', () => {
        // Without CLERK_JWT_KEY the FoodAuthGuard fail-closes and every /api/v1/foods/* request is 401.
        // Non-prod (sandbox / pr-{N}) runs the self-owned preview pattern in transition mode (ADR-0001).
        const withClerk = containerEnvSets(synthFoodTemplate('test', 'sandbox')).filter(
            (envNames) =>
                envNames.includes('CLERK_JWT_KEY') &&
                envNames.includes('CLERK_AZP_PATTERN') &&
                envNames.includes('CLERK_AZP_PREVIEW_MODE') &&
                // Pattern mode admits the mobile app's azp-less native tokens via this gate (non-prod only).
                envNames.includes('CLERK_ADMIT_NATIVE_CLIENT') &&
                !envNames.includes('CLERK_AUTHORIZED_PARTIES'),
        );

        expect(withClerk).toHaveLength(3);
    });

    it('prod keeps the exact-match list (CLERK_AUTHORIZED_PARTIES), never the preview pattern', () => {
        const withClerk = containerEnvSets(synthFoodTemplate('prod', 'prod')).filter(
            (envNames) =>
                envNames.includes('CLERK_JWT_KEY') &&
                envNames.includes('CLERK_AUTHORIZED_PARTIES') &&
                !envNames.includes('CLERK_AZP_PATTERN') &&
                !envNames.includes('CLERK_AZP_PREVIEW_MODE') &&
                // Prod runs list mode (Clerk skips the azp check on absent azp) → no native gate, unchanged.
                !envNames.includes('CLERK_ADMIT_NATIVE_CLIENT'),
        );

        expect(withClerk).toHaveLength(3);
    });
});

describe('USDA API-key secret grant (regression: suffix-less GetSecretValue never matches the real ARN)', () => {
    // The USDA key is imported by NAME via `fromSecretNameV2`, and injected via
    // `ecs.Secret.fromSecretsManager`, which grants the task EXECUTION role `GetSecretValue` scoped to
    // that secret. Because the import is name-based (no complete ARN at synth), CDK MUST append the
    // `-??????` wildcard so the grant matches the secret's real ARN (`...usda-api-key-XXXXXX`, the 6
    // random chars Secrets Manager suffixes). A regression to a suffix-LESS / exact-ARN grant (e.g.
    // `fromSecretCompleteArn`, or hand-building the bare ARN) never matches the live secret: the
    // execution role gets AccessDenied on GetSecretValue, the container never launches, and every deploy
    // hangs on ECS "NotStabilized" then rolls back — the exact bug that bit identity/webhooks. These
    // assertions document that food does it RIGHT and fail loudly if the wildcard is ever dropped.
    const usdaSecretResource = {
        'Fn::Join': [
            '',
            [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':secretsmanager:us-east-1:123456789012:secret:kitchensink/sandbox/food/usda-api-key-??????',
            ],
        ],
    };

    it('grants GetSecretValue on the USDA secret via a name-based ARN WITH the -?????? wildcard suffix', () => {
        serviceTemplate.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
                        Resource: usdaSecretResource,
                    }),
                ]),
            },
        });
    });

    it('lands that grant on the shared task EXECUTION role (the principal that pulls the secret at task start)', () => {
        serviceTemplate.hasResourceProperties('AWS::IAM::Policy', {
            Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('FoodTaskExecutionRole') })]),
            PolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
                        Resource: usdaSecretResource,
                    }),
                ]),
            },
        });
    });

    it('never grants the USDA secret on a bare/exact ARN missing the -?????? wildcard (the AccessDenied bug shape)', () => {
        const policies = serviceTemplate.findResources('AWS::IAM::Policy');
        const usdaGrants = Object.values(policies).flatMap((policy: any) =>
            ((policy.Properties?.PolicyDocument?.Statement ?? []) as Array<Record<string, unknown>>).filter(
                (statement) => {
                    const actions = ([] as string[]).concat(statement['Action'] as string | string[]);

                    return (
                        actions.includes('secretsmanager:GetSecretValue') &&
                        JSON.stringify(statement['Resource']).includes('usda-api-key')
                    );
                },
            ),
        );

        // The grant must exist (otherwise the tasks could never read the key) ...
        expect(usdaGrants.length).toBeGreaterThan(0);

        // ... and EVERY USDA GetSecretValue grant must carry the wildcard suffix — a `usda-api-key` not
        // immediately followed by `-??????` is the suffix-less regression that produces AccessDenied.
        for (const grant of usdaGrants) {
            const resource = JSON.stringify(grant['Resource']);
            expect(resource).toContain('usda-api-key-??????');
            expect(resource).not.toMatch(/usda-api-key(?!-\?{6})/);
        }
    });
});

describe('Vestigial lambdas removed (Decisions B/C/D)', () => {
    /**
     * REWRITTEN, not relaxed. This asserted `resourceCountIs('AWS::Lambda::Function', 1)`, which stopped
     * being true when the stack gained its in-deploy schema-migration trigger: `aws-cdk-lib/triggers`
     * synthesizes a shared custom-resource PROVIDER handler alongside it. That function is CDK framework
     * machinery, not a food workload, so counting it would have made the count meaningless — and simply
     * bumping the number to 2 would have thrown away what the assertion was for.
     *
     * The invariant it was really expressing is unchanged and is now stated directly: this stack authors
     * exactly ONE Lambda of its own (the migration runner), and every other function in the template is a
     * CDK custom-resource provider. A resurrected bulk-sync/stale-refresh/search-indexer fails on the first
     * assertion, not on a name match, so the check does not depend on guessing what it would be called.
     */
    it('authors ONLY the migration-runner Lambda (bulk-sync / stale-refresh / search-indexer are gone)', () => {
        const logicalIds = Object.keys(serviceTemplate.findResources('AWS::Lambda::Function'));
        const authored = logicalIds.filter((id) => id.startsWith('Food'));

        expect(authored).toHaveLength(1);
        expect(authored[0]).toMatch(/^FoodMigrationFunction/);
        expect(logicalIds).not.toEqual([]);

        for (const id of logicalIds.filter((candidate) => !candidate.startsWith('Food'))) {
            expect(id, 'the only non-food Lambdas here may be CDK custom-resource providers').toMatch(
                /CustomResourceProvider/,
            );
        }

        expect(logicalIds.join(',')).not.toMatch(/BulkSync|StaleRefresh|SearchIndexer/);
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
            // ⛔ DERIVED from the bundle's presence, exactly as the stack derives it — not the literal
            // `lambdas/migrate/handler.handler`. The stack falls back to an inline placeholder (whose entry
            // is `index.handler`) when `dist-lambda/` is absent, which is ALWAYS the case in CI: nothing
            // runs `bundle:lambda` before the unit tier. Hard-coding the asset-branch handler made this test
            // pass only on a machine that happened to have built, and fail in CI — the same
            // "invisible if you built before" class as the stale-bundle defect in `esbuild.mjs`.
            //
            // Asserting the PAIRING is also stronger than asserting either literal: it catches a handler
            // that no longer matches the code source it ships with, in whichever branch is taken.
            Handler: MIGRATION_HANDLER,
            // Read from the shared pin, not re-hardcoded. The literal here was `nodejs22.x` and this test
            // was the only thing in the repo that broke when the runtime moved to `nodejs24.x` — a second
            // authoritative copy of a version that is supposed to live in exactly one place
            // (`NODE_LAMBDA_RUNTIME`, which the stack itself uses). Asserting the constant keeps the
            // contract ("this Lambda runs the pinned runtime") while making the next bump a one-line change.
            Runtime: NODE_LAMBDA_RUNTIME.name,
            Timeout: 300,
            MemorySize: 512,
            Architectures: ['arm64'],
            Environment: {
                Variables: Match.objectLike({
                    STAGE: 'test',
                    // No FOOD_DB_SECRET_ARN — `food_app` authenticates via RDS IAM, not a secret.
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

    it('grants the migration function rds-db:connect on the food_app db-user (RDS IAM auth)', () => {
        // The db-user ARN is `…:dbuser:<DatabaseResourceId>/food_app`; assert the action + that the
        // resource ARN is scoped to the food_app db-user (the resource-id import + /food_app suffix).
        const json = JSON.stringify(serviceTemplate.toJSON());

        expect(json).toContain('rds-db:connect');
        expect(json).toContain('/food_app');
        expect(json).toContain(':DatabaseResourceId');
    });

    it('exports the migration function name for the deploy-time lambda invoke', () => {
        const outputs = serviceTemplate.findOutputs('*');
        const exportNames = Object.values(outputs).map((o: any) => o.Export?.Name ?? '');

        expect(exportNames.some((name: string) => name.includes('FoodMigrationFunctionName'))).toBe(true);
    });

    /**
     * Task #152. `prod-deploy.yml`'s food smoke was a `/health` retry loop, which a task running a
     * weeks-old image satisfies perfectly — the same shape as identity's before #137. Closing it needs the
     * two inputs identity's smoke resolves from its own stack's exports: the cluster and the API service.
     *
     * These are exported (not merely output) BECAUSE the alternative is what the recipe leg still does —
     * `aws ecs list-clusters | grep recipe-service-${STAGE}-` — where a renamed cluster matches NOTHING and
     * the smoke fails for a reason unrelated to the deploy, or worse, matches a DIFFERENT stage's cluster.
     * An export resolved by name either exists or fails loudly.
     */
    it('exports the API cluster and service ARNs so the prod smoke can read the RUNNING task definition', () => {
        const outputs = serviceTemplate.findOutputs('*');
        // Matched by SUFFIX: this suite synthesizes under the construct id `TestFoodService`, so
        // `${this.stackName}` is not the real `kitchensink-food-service-{stage}` prefix. The prefix is
        // pinned by the no-diff synth parity suite instead; what matters here is the export's own name.
        const exportNames = Object.values(outputs).map((o: any) => (o.Export?.Name ?? '').split(':').pop());

        expect(exportNames).toContain('FoodClusterArn');
        expect(exportNames).toContain('FoodApiServiceArn');
    });

    it('points FoodApiServiceArn at the API service, not the fetch worker', () => {
        // The two Fargate services share an image tag, but only the API is behind the ALB host rule the
        // smoke probes — reading the worker's task definition would be checking the wrong thing.
        const outputs = serviceTemplate.findOutputs('*');
        const [apiServiceArn] = Object.values(outputs).filter((output: any) =>
            (output.Export?.Name ?? '').endsWith(':FoodApiServiceArn'),
        );

        expect(JSON.stringify(apiServiceArn)).toContain('FoodApiService');
        expect(JSON.stringify(apiServiceArn)).not.toContain('FoodFetchWorkerService');
    });
});

describe('Change-refresh Fargate scheduled task (T-001c)', () => {
    it('defines the IngestionScheduled rule firing an ECS RunTask target in a public subnet', () => {
        // NOTE: the shared `serviceTemplate` is a non-prod (test) stage, so the RunTask target runs on
        // FARGATE_SPOT (ADR-0008) — `LaunchType` is replaced by a capacity-provider strategy. The
        // per-stage launch/Spot behaviour is asserted in the 'Per-stage Fargate Spot (ADR-0008)' suite;
        // here we only pin the schedule, task count, and public-subnet placement.
        serviceTemplate.hasResourceProperties('AWS::Events::Rule', {
            ScheduleExpression: 'rate(6 hours)',
            Targets: Match.arrayWith([
                Match.objectLike({
                    EcsParameters: Match.objectLike({
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
                    Command: ['node', 'dist/src/worker/change-refresh/main.js'],
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

    /** The dashboard's rendered JSON body, whether CDK emitted it as a literal or as an `Fn::Join`. */
    function dashboardBody(): string {
        const dashboards = serviceTemplate.findResources('AWS::CloudWatch::Dashboard');
        const body = Object.values(dashboards)[0]?.Properties?.DashboardBody as
            | string
            | { 'Fn::Join': [string, unknown[]] };

        if (typeof body === 'string') {
            return body;
        }

        return body['Fn::Join'][1].map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join('');
    }

    /**
     * T-199(b) — SC-004/SC-005 had no charted signal, so the local-store serve rate was provable only under
     * k6. The API emits ONE `Percent` observation per golden-record read (100 served / 0 not), so `Average`
     * over the period IS the serve-rate percentage the criterion is written in.
     *
     * Deliberately a WIDGET and not an alarm: SC-004's ">80%" only holds "once the local store contains
     * 5,000+ unique RESOLVED foods", and a per-PR preview (or a cold prod store) legitimately sits far
     * below that — an alarm would page on an expected state.
     */
    /**
     * ⛔ A DASHBOARD WIDGET MUST CHART A METRIC THE EMITTER ACTUALLY PUBLISHES.
     *
     * `Per-source rolling-60-min calls` charted `source-rolling-window-count` with NO dimensions, while
     * `recordSourceRollingWindow` publishes it under `Dimensions: [['source']]` ONLY — EMF publishes the
     * dimension sets it is given and no aggregate beside them, so the widget resolved to a series that has
     * never existed and drew an empty graph. Nobody noticed because an empty graph and a quiet system look
     * identical.
     *
     * ⚠️ `serviceInfraWiringInvariants` W3 cannot catch this: it gates ALARMS on metric NAMES, and this is
     * a WIDGET on a metric whose name was right and whose dimensions were not.
     *
     * The dimensioned set is DERIVED from the emitting source, never listed here — a copy of a list cannot
     * detect that the list is incomplete.
     */
    it('charts every dimensioned metric with its dimension, not as a bare series', () => {
        // ⚠️ Read as TEXT, never imported: `infra/tsconfig.json` sets `rootDir: infra`, which is the same
        // boundary that makes the stack keep its own copy of `FOOD_METRIC`. Importing across it does not
        // compile, and duplicating the names here would be the third copy of a list this file already
        // copies once — so both the keys and their values are derived from the emitter's own source.
        const emitterPath = resolve(fileURLToPath(import.meta.url), '../../../src/observability/emfMetrics.ts');
        const emitterSource = readFileSync(emitterPath, 'utf8');

        const emittedNames = new Map<string, string>(
            [...emitterSource.matchAll(/^\s{4}(\w+): '([a-z0-9-]+)',$/gmu)].map(
                (entry) => [entry[1], entry[2]] as [string, string],
            ),
        );

        // An emit call carrying `dimensions:` names its metric a little earlier in the same object.
        const dimensioned = new Map<string, string>();

        for (const match of emitterSource.matchAll(/FOOD_METRIC\.(\w+)[\s\S]{0,400}?dimensions:\s*\{\s*(\w+)/gu)) {
            const [, metricKey, dimension] = match;

            if (metricKey !== undefined && dimension !== undefined) {
                dimensioned.set(metricKey, dimension);
            }
        }

        // Non-vacuity: an emitter that stopped using dimensions must fail here rather than pass silently.
        expect(dimensioned.size).toBeGreaterThanOrEqual(1);

        const body = dashboardBody();

        for (const [metricKey, dimension] of dimensioned) {
            const metricName = emittedNames.get(metricKey);

            expect(metricName, `${metricKey} is not a known metric`).toBeDefined();

            // The bare form is `["Commise/Food","<name>",{...}]`; a dimensioned one interposes the
            // dimension name before the options object.
            const bare = new RegExp(`"Commise/Food","${metricName}",\\{`, 'u');

            expect(
                bare.test(body),
                `dashboard charts ${metricName} with no dimensions, but it is only emitted with "${dimension}"`,
            ).toBe(false);
        }
    });

    /**
     * U38 — the reading and the model must land on ONE widget, because the comparison IS the evidence.
     * `source-rolling-window-count` is what we MODEL in Postgres; `source-rate-limit-remaining` is what
     * USDA REPORTS. While the two move together the window is ours alone (per-key); a `remaining` that
     * falls faster than our count says the bucket is shared (per-IP). Charting them on separate widgets —
     * or emitting the reading with nothing charting it at all — leaves that question to be settled by
     * argument, which is exactly what the unit set out to stop.
     */
    it('charts the REPORTED rate limit beside the MODELLED window count, on one widget', () => {
        // The body is not parseable JSON — CDK renders unresolved tokens into it — so widgets are split
        // on their titles, which CDK emits before each widget's own `metrics` array.
        const widgets = dashboardBody().split('"title":"');
        const modelled = widgets.filter((widget) => widget.includes(FOOD_METRIC.sourceRollingWindowCount));

        // Length 1 is the non-vacuity guard in both directions: charted nowhere fails, charted twice fails.
        expect(modelled).toHaveLength(1);
        expect(modelled[0]).toContain(FOOD_METRIC.sourceRateLimitRemaining);
    });

    it('charts the local-store serve rate as an Average on a 0–100 axis (SC-004/SC-005, T-199b)', () => {
        const body = dashboardBody();

        // CDK omits `stat` when it is the widget default (Average) and renders it explicitly otherwise
        // (`{"stat":"Sum"}`, `{"stat":"p50"}` above), so a BARE metric entry is the assertion that this is
        // averaged. Summing 100/0 observations would report a nonsense multiple of the read count.
        expect(body).toContain(`["Commise/Food","${FOOD_METRIC.localStoreServeRate}"]`);
        expect(body).toContain('"yAxis":{"left":{"min":0,"max":100}}');
    });

    it('creates the alarm SNS topic', () => {
        serviceTemplate.resourceCountIs('AWS::SNS::Topic', 1);
    });

    it('creates exactly the five food alarms with the correct thresholds', () => {
        // Five since U9 added the retry-budget-exhaustion alarm, which is deliberately SEPARATE from the
        // tombstone alarm below: DSN-9 keeps `NOT_FOUND` quiet, and folding a blackholed food into that
        // count would bury it among the outcomes it does not resemble.
        serviceTemplate.resourceCountIs('AWS::CloudWatch::Alarm', 5);

        serviceTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
            Namespace: FOOD_METRIC_NAMESPACE,
            MetricName: FOOD_METRIC.retryBudgetExhausted,
            Threshold: 0,
            ComparisonOperator: 'GreaterThanThreshold',
        });

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

// ── ADR-0007: per-stage Container Insights ───────────────────────────────────────────────────────
describe('Per-stage Container Insights (ADR-0007)', () => {
    it('runs the prod cluster with ENHANCED Container Insights', () => {
        const template = synthFoodTemplate('prod', 'prod');

        template.hasResourceProperties('AWS::ECS::Cluster', {
            ClusterSettings: Match.arrayWith([Match.objectLike({ Name: 'containerInsights', Value: 'enhanced' })]),
        });
    });

    it('drops non-prod clusters to STANDARD Container Insights', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');

        template.hasResourceProperties('AWS::ECS::Cluster', {
            ClusterSettings: Match.arrayWith([Match.objectLike({ Name: 'containerInsights', Value: 'enabled' })]),
        });
    });
});

// ── ADR-0008: per-stage Fargate Spot ───────────────────────────────────────────────────────────
describe('Per-stage Fargate Spot (ADR-0008)', () => {
    const serviceStrategies = (template: Template): unknown[] =>
        Object.values(template.findResources('AWS::ECS::Service')).map(
            (resource: any) => resource.Properties.CapacityProviderStrategy,
        );

    it('runs both non-prod (pr-7) services on FARGATE_SPOT with the capacity provider on the cluster', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');

        for (const strategy of serviceStrategies(template)) {
            expect(strategy).toEqual([{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }]);
        }

        template.hasResourceProperties('AWS::ECS::ClusterCapacityProviderAssociations', {
            CapacityProviders: Match.arrayWith(['FARGATE_SPOT']),
        });
    });

    it('runs the non-prod change-refresh RunTask on FARGATE_SPOT (no LaunchType on the rule target)', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');
        const rule = Object.values(template.findResources('AWS::Events::Rule')).find((resource: any) =>
            (resource.Properties.Targets ?? []).some((target: any) => target.EcsParameters),
        ) as any;
        const ecsParameters = rule.Properties.Targets.find((target: any) => target.EcsParameters).EcsParameters;

        expect(ecsParameters.CapacityProviderStrategy).toEqual([{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }]);
        expect(ecsParameters.LaunchType).toBeUndefined();
    });

    it('keeps prod on on-demand FARGATE — no Spot strategy, no capacity-provider association (no prod diff)', () => {
        const template = synthFoodTemplate('prod', 'prod');

        for (const strategy of serviceStrategies(template)) {
            expect(strategy).toBeUndefined();
        }

        for (const service of Object.values(template.findResources('AWS::ECS::Service'))) {
            expect((service as any).Properties.LaunchType).toBe('FARGATE');
        }

        template.resourceCountIs('AWS::ECS::ClusterCapacityProviderAssociations', 0);

        const rule = Object.values(template.findResources('AWS::Events::Rule')).find((resource: any) =>
            (resource.Properties.Targets ?? []).some((target: any) => target.EcsParameters),
        ) as any;
        const ecsParameters = rule.Properties.Targets.find((target: any) => target.EcsParameters).EcsParameters;

        expect(ecsParameters.LaunchType).toBe('FARGATE');
        expect(ecsParameters.CapacityProviderStrategy).toBeUndefined();
    });
});

// ── ADR-0006: base-stage imports + per-PR logical database ───────────────────────────────────────
describe('Base-stage platform imports (ADR-0006)', () => {
    it('for a base (prod) stage imports the prod platform and the shared kitchensink_food DB name', () => {
        const template = synthFoodTemplate('prod', 'prod');
        const json = JSON.stringify(template.toJSON());

        // Base stage rides its own platform, and the DB name is the imported FoodDatabaseName export.
        expect(json).toContain('kitchensink-data-prod:FoodDatabaseName');
        expect(json).toContain('kitchensink-network-prod:ServiceSecurityGroupId');
        expect(json).not.toContain('kitchensink_food_pr_');

        // Base food priority is unchanged — 200, the value already on the live prod listener.
        expect(BASE_LISTENER_PRIORITY.food).toBe(200);
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_LISTENER_PRIORITY.food,
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    // `arrayWith`, because prod's rule now ALSO carries the internal-origin host (U15).
                    // What this test owns is the bare `food` label; the exact pair is pinned below, in
                    // "the internal-origin host (prod only)".
                    HostHeaderConfig: Match.objectLike({ Values: Match.arrayWith(['food.example.com']) }),
                }),
            ]),
        });
    });

    it('for a per-PR stage imports the SANDBOX platform (baseStage), never a per-PR platform', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');
        const json = JSON.stringify(template.toJSON());

        expect(json).toContain('kitchensink-network-sandbox:ServiceSecurityGroupId');
        expect(json).toContain('kitchensink-data-sandbox:DatabaseResourceId');
        expect(json).toContain('kitchensink-alb-sandbox:SharedAlbHttpsListenerArn');
        expect(json).toContain('kitchensink-domain-sandbox:HostedZoneId');
        // Never references a per-PR platform stack (there is none).
        expect(json).not.toContain('kitchensink-data-pr-7');
        expect(json).not.toContain('kitchensink-network-pr-7');
    });

    it('gives a per-PR stage an isolated kitchensink_food_pr_7 logical DB (container + migration env)', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');
        const taskDefs = template.findResources('AWS::ECS::TaskDefinition');
        const containers = Object.values(taskDefs).flatMap(
            (resource: any) => resource.Properties.ContainerDefinitions as any[],
        );
        const dbNames = containers.flatMap((container) =>
            (container.Environment ?? [])
                .filter((entry: any) => entry.Name === 'DB_NAME')
                .map((entry: any) => entry.Value),
        );

        expect(dbNames.length).toBeGreaterThan(0);

        for (const value of dbNames) {
            expect(value).toBe('kitchensink_food_pr_7');
        }

        // The migration-runner Lambda targets the same per-PR DB.
        template.hasResourceProperties('AWS::Lambda::Function', {
            Environment: {
                Variables: Match.objectLike({ FOOD_DB_NAME: 'kitchensink_food_pr_7' }),
            },
        });
    });

    it('allocates the per-PR stage a listener priority in the per-PR band with its own host rule', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');

        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: FOOD_PER_PR_BAND.floor + 7,
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    // Dash form (single label) so the `*.commise.app` cert covers the preview host —
                    // `food.pr-7.*` (3 labels) would fail the TLS handshake (ADR-0006).
                    HostHeaderConfig: Match.objectLike({ Values: ['food-pr-7.example.com'] }),
                }),
            ]),
        });
    });
});

describe('foodServiceOriginForStage (the ONE definition the recipe deploy consumes — issue #120)', () => {
    it('composes the stage label with the apex into an https origin', () => {
        expect(foodServiceOriginForStage('prod', 'commise.app')).toBe('https://food.commise.app');
        expect(foodServiceOriginForStage('pr-73', 'commise.app')).toBe('https://food-pr-73.commise.app');
    });

    it('never emits a trailing slash (the food client strips one, but callers embed this verbatim)', () => {
        expect(foodServiceOriginForStage('pr-1', 'commise.app').endsWith('/')).toBe(false);
    });

    it('stays SINGLE-label under the apex for every non-prod stage (the wildcard-cert constraint)', () => {
        // `https://food.pr-7.commise.app` would match neither `*.commise.app` nor `*.sandbox.commise.app`
        // and would fail the TLS handshake — so recipe would be pointed at a host it can never reach.
        for (const stage of ['pr-7', 'pr-123', 'sandbox']) {
            const host = new URL(foodServiceOriginForStage(stage, 'commise.app')).hostname;

            expect(host.split('.')).toHaveLength(3);
        }
    });
});

describe('foodSubdomainForStage (ADR-0006 — cert-safe per-PR host)', () => {
    it('prod → food; every other stage → food-{stage} (dash form, covered by *.commise.app)', () => {
        expect(foodSubdomainForStage('prod')).toBe('food');
        expect(foodSubdomainForStage('pr-7')).toBe('food-pr-7');
        expect(foodSubdomainForStage('pr-123')).toBe('food-pr-123');
    });

    it('never emits a dot after the service label, for ANY stage', () => {
        // Mirrors the recipe assertion: a stage-qualified `food.{stage}` host is unrepresentable rather than
        // guarded, because the only separator this function writes is a dash. A 3-label host would also fail
        // the TLS handshake — no wildcard on the shared cert covers it.
        for (const stage of ['prod', 'sandbox', 'staging', 'pr-7', 'team-x']) {
            expect(foodSubdomainForStage(stage)).not.toMatch(/^food\./);
        }
    });
});

describe('foodDatabaseNameForStage', () => {
    it('returns the imported base name for a base (stage === baseStage) stage', () => {
        // PROD is the only reachable base stage for this service: `foodSubdomainForStage` refuses
        // `stage === baseStage` outside prod, because there is no persistent non-prod food instance. Asserting
        // `('sandbox', 'sandbox')` here would pin behaviour for a deploy shape that can no longer exist.
        expect(foodDatabaseNameForStage('prod', 'prod', '<imported-token>')).toBe('<imported-token>');
    });

    it('derives a sanitized per-PR database name from the stage', () => {
        expect(foodDatabaseNameForStage('pr-7', 'sandbox', 'x')).toBe('kitchensink_food_pr_7');
        expect(foodDatabaseNameForStage('pr-123', 'sandbox', 'x')).toBe('kitchensink_food_pr_123');
        expect(foodDatabaseNameForStage('team-feature-x', 'sandbox', 'x')).toBe('kitchensink_food_team_feature_x');
    });

    it('produces only valid lowercase pg identifiers', () => {
        expect(foodDatabaseNameForStage('PR-7', 'sandbox', 'x')).toMatch(/^kitchensink_food(_[a-z0-9_]+)?$/);
    });

    it('throws (rather than emitting an invalid name) when the stage sanitizes to an empty suffix', () => {
        // A misconfigured all-punctuation stage would otherwise yield `kitchensink_food_`, which fails
        // the migration runner's identifier pattern in a non-obvious way — fail loudly at synth instead.
        expect(() => foodDatabaseNameForStage('---', 'sandbox', 'x')).toThrow(/empty/);
    });
});

/**
 * This stack no longer OWNS a priority resolver — allocation lives once in `@kitchensink/infra-alb`, whose
 * suite proves disjointness exhaustively across every reserved slot and the full PR range. What remains
 * testable HERE is the wiring: that this stack claims a rule in FOOD's band and not in another service's,
 * which is precisely the drift that fired when each service kept its own copy of the scheme.
 */
describe('the listener rule this stack claims on the shared listener', () => {
    it('lands in FOOD`s own per-PR band, strictly below the next service`s', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');
        const priorities = Object.values(template.findResources('AWS::ElasticLoadBalancingV2::ListenerRule')).map(
            (resource) => resource.Properties.Priority as number,
        );
        const recipeBand = ephemeralBandsForSlot(EPHEMERAL_SLOT_ORDER.indexOf('recipe')).perPr;

        expect(priorities).toHaveLength(1);
        expect(priorities[0]).toBe(FOOD_PER_PR_BAND.floor + 7);
        // ⛔ MUTATION GUARD: pass `service: 'recipe'` in the stack and this reds — the exact class of bug the
        // duplicated per-service resolvers produced (`Priority '10073' is currently in use`).
        expect(priorities[0]).toBeGreaterThanOrEqual(FOOD_PER_PR_BAND.floor);
        expect(priorities[0]).toBeLessThanOrEqual(FOOD_PER_PR_BAND.ceiling);
        expect(priorities[0]).toBeLessThan(recipeBand.floor);
    });
});

/**
 * ADR-0020 / plan U15 — the internal ORIGIN host this service answers on behind the CloudFront edge.
 *
 * U15 is deliberately ADDITIVE and changes nothing about how traffic reaches this service today: prod gains
 * a SECOND host on its existing rule and a matching A-record, while the public name keeps serving from the
 * ALB exactly as before. U17 is what removes the public host, one service at a time, once the distribution
 * owns the public record.
 *
 * Two failure modes are pinned here because neither is observable from a green synth:
 *
 *   - **a SECOND listener rule instead of a second condition** would need its own priority on a namespace
 *     shared across stacks (ADR-0003) and fail the prod deploy with `Priority 'N' is currently in use`; and
 *   - **a record that does not name the host the rule matches** resolves to nothing, which surfaces as a
 *     dead CloudFront origin in U16 rather than as a test failure here.
 */
describe('the internal-origin host (prod only, ADR-0020 / U15)', () => {
    const internalHost = 'food.internal.example.com';

    it('matches BOTH the public and the internal host on the SAME rule in prod', () => {
        const template = synthFoodTemplate('prod', 'prod');

        template.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    // Exact, and public FIRST: nothing has cut over, so the public name must still match.
                    HostHeaderConfig: Match.objectLike({ Values: ['food.example.com', internalHost] }),
                }),
            ]),
        });
    });

    it('keeps its live prod priority — an in-place condition update, never a rule replacement', () => {
        synthFoodTemplate('prod', 'prod').hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_LISTENER_PRIORITY.food,
        });
    });

    it('publishes the internal A-record at exactly the host the rule matches', () => {
        const template = synthFoodTemplate('prod', 'prod');

        // Two records in prod: the public name and the internal one. The trailing dot is CDK's FQDN form.
        template.resourceCountIs('AWS::Route53::RecordSet', 2);
        template.hasResourceProperties('AWS::Route53::RecordSet', {
            Type: 'A',
            Name: `${internalHost}.`,
        });
    });

    it('aliases the internal record to the SAME shared ALB as the public one', () => {
        // The internal name is a second door onto the same load balancer, not a new target. Comparing the
        // two alias targets catches an origin pointed at some other (or an unresolved) ALB import.
        const records = Object.values(
            synthFoodTemplate('prod', 'prod').findResources('AWS::Route53::RecordSet'),
        ) as Array<{ Properties: { Name: string; AliasTarget?: unknown } }>;
        const publicRecord = records.find((r) => r.Properties.Name === 'food.example.com.');
        const internalRecord = records.find((r) => r.Properties.Name === `${internalHost}.`);

        expect(publicRecord?.Properties.AliasTarget).toBeDefined();
        expect(internalRecord?.Properties.AliasTarget).toEqual(publicRecord?.Properties.AliasTarget);
    });

    it('creates nothing internal outside prod — no other stage has the *.internal certificate', () => {
        // KTD-7 scopes CloudFront to prod, and only prod's DomainStack mints `*.internal.{domain}`. A host
        // condition on any other stage would match a name that can never complete a TLS handshake.
        for (const [stage, baseStage] of [
            ['pr-7', 'sandbox'],
            ['sandbox', 'sandbox'],
        ]) {
            const template = synthFoodTemplate(stage as string, baseStage as string);

            template.resourceCountIs('AWS::Route53::RecordSet', 1);
            expect(JSON.stringify(template.toJSON())).not.toContain('.internal.');
        }
    });
});

/**
 * ⛔ THE ACCEPTANCE CRITERION for food's half of the U17 DNS cutover.
 *
 * U15 gave prod's listener rule a SECOND host (`food.internal.example.com`) while the public name kept
 * serving — a door added, with the old one still open. U17 closes the old one: `food.example.com` stops
 * being this stack's Route 53 record (EdgeStack publishes it, aliased to the distribution) and stops being
 * a host this rule answers on, so the only way in is through CloudFront.
 *
 * Both halves are asserted together in every test below, because getting one without the other is the
 * failure. Keeping the record while dropping the host condition leaves the public name resolving to an ALB
 * that answers it with ADR-0003's default 404. Dropping the record while keeping the condition leaves a
 * rule matching a name nothing resolves to — invisible until EdgeStack is also deployed, or forever if it
 * is not.
 */
describe('the U17 DNS cutover (prod only, ADR-0020)', () => {
    const internalHost = 'food.internal.example.com';
    const publicHost = 'food.example.com';

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
            return synthFoodTemplate('prod', 'prod');
        } finally {
            if (previous === undefined) {
                delete process.env[EDGE_CUTOVER_SERVICES_ENV];
            } else {
                process.env[EDGE_CUTOVER_SERVICES_ENV] = previous;
            }
        }
    }

    it('changes NOTHING when the cutover has not been declared — an unset variable is not a cutover', () => {
        // The default every existing deploy takes. It must be byte-identical to the U15 state: this stack
        // still owns the public record and still answers on both hosts.
        const template = synthProdWithCutover(undefined);

        template.resourceCountIs('AWS::Route53::RecordSet', 2);
        template.hasResourceProperties('AWS::Route53::RecordSet', { Type: 'A', Name: `${publicHost}.` });
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Conditions: Match.arrayWith([
                Match.objectLike({ HostHeaderConfig: Match.objectLike({ Values: [publicHost, internalHost] }) }),
            ]),
        });
    });

    it('⛔ releases the public A-record once food has cut over, so EdgeStack can claim it', () => {
        // Route 53 refuses a duplicate record, so if this stack kept it the EdgeStack deploy would fail.
        // That is the LOUD failure; this assertion is what keeps it from being the silent one instead.
        const template = synthProdWithCutover('food');
        const names = Object.values(template.findResources('AWS::Route53::RecordSet')).map(
            (record) => (record as { Properties: { Name: string } }).Properties.Name,
        );

        expect(names).not.toContain(`${publicHost}.`);
        // The internal record STAYS — it is what the distribution origins at, and it is this stack's.
        expect(names).toContain(`${internalHost}.`);
        template.resourceCountIs('AWS::Route53::RecordSet', 1);
    });

    it('⛔ stops answering on the public host once food has cut over, leaving only the origin host', () => {
        // The lockdown's other half. CloudFront sends `Host: food.internal.example.com`
        // (ALL_VIEWER_EXCEPT_HOST_HEADER), so the public host on this rule serves nothing after the cutover
        // except a way around the edge for anyone who reaches the ALB directly.
        const template = synthProdWithCutover('food');

        template.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Conditions: Match.arrayWith([
                Match.objectLike({ HostHeaderConfig: Match.objectLike({ Values: [internalHost] }) }),
            ]),
        });

        // ⚠️ Asserted on the RULE, not on the template as a whole. An earlier version of this test swept
        // the whole template for the public host and failed — correctly. `food.example.com` still appears
        // in the service's published `serviceUrl`/SSM origin, and that is the POINT of the cutover rather
        // than a leftover: callers go on addressing the public name, which now resolves to CloudFront.
        // What must disappear is the ALB answering to it directly.
        const hostValues = Object.values(template.findResources('AWS::ElasticLoadBalancingV2::ListenerRule')).flatMap(
            (rule) =>
                (
                    rule as {
                        Properties: { Conditions?: readonly { HostHeaderConfig?: { Values?: string[] } }[] };
                    }
                ).Properties.Conditions?.flatMap((condition) => condition.HostHeaderConfig?.Values ?? []) ?? [],
        );

        expect(hostValues).toEqual([internalHost]);
    });

    it('keeps its OWN priority through the cutover — the rule is edited, never replaced', () => {
        // A rule that changed priority would collide with whatever holds the old one (ADR-0003), and the
        // deploy would fail with `Priority 'N' is currently in use`.
        synthProdWithCutover('food').hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_LISTENER_PRIORITY.food,
        });
    });

    it('is unmoved by ANOTHER service cutting over — U17 cuts one at a time', () => {
        // The sequencing guarantee. Identity going first must leave food exactly as it was, or the
        // "verify between each" step is verifying a system that already moved underneath it.
        const template = synthProdWithCutover('identity');

        template.resourceCountIs('AWS::Route53::RecordSet', 2);
        template.hasResourceProperties('AWS::Route53::RecordSet', { Type: 'A', Name: `${publicHost}.` });
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Conditions: Match.arrayWith([
                Match.objectLike({ HostHeaderConfig: Match.objectLike({ Values: [publicHost, internalHost] }) }),
            ]),
        });
    });

    it('⛔ ignores the cut-over set entirely outside prod, where there is no distribution to cut over TO', () => {
        // The worst available outcome: a stray variable in a sandbox or per-PR deploy deleting the only
        // record that preview has. Non-prod must be inert no matter what the environment says.
        const previous = process.env[EDGE_CUTOVER_SERVICES_ENV];
        process.env[EDGE_CUTOVER_SERVICES_ENV] = 'food,recipe,identity';

        try {
            for (const [stage, baseStage] of [
                ['sandbox', 'sandbox'],
                ['pr-91', 'sandbox'],
            ]) {
                const template = synthFoodTemplate(stage as string, baseStage as string);

                template.resourceCountIs('AWS::Route53::RecordSet', 1);
                template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
                    Conditions: Match.arrayWith([Match.objectLike({ Field: 'host-header' })]),
                });
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
 * ⛔ THE ACCEPTANCE CRITERION for the secret origin header, food's ALB side (plan U17, ADR-0020 trap 5).
 *
 * The prefix-list restriction on prod's ALB authorizes **CloudFront**, not **our** CloudFront:
 * `food.internal.example.com` is published in the PUBLIC zone, so anyone may point their own distribution at
 * it and reach this target group with the edge verifier out of the path. The header is the actual boundary.
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
        const template = synthFoodTemplate('prod', 'prod');

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
        const values = ruleHeaderConditionValues(synthFoodTemplate('prod', 'prod'));

        expect(values).toHaveLength(1);
        expect(values[0]).toMatch(/^\{\{resolve:secretsmanager:/u);
    });

    it('⛔ adds NO header condition on any other stage — nothing there sends it', () => {
        for (const [stage, baseStage] of [
            ['sandbox', 'sandbox'],
            ['pr-91', 'sandbox'],
            ['test', 'sandbox'],
        ]) {
            const template = synthFoodTemplate(stage as string, baseStage as string);

            expect(ruleHeaderConditionValues(template), `stage ${stage}`).toEqual([]);
            expect(JSON.stringify(template.toJSON()), `stage ${stage}`).not.toContain(EDGE_ORIGIN_HEADER_NAME);
        }
    });

    it('keeps its live prod priority — an in-place condition update, never a rule replacement', () => {
        synthFoodTemplate('prod', 'prod').hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_LISTENER_PRIORITY.food,
        });
    });

    it('stays within ALB’s five-condition ceiling', () => {
        const rules = Object.values(
            synthFoodTemplate('prod', 'prod').findResources('AWS::ElasticLoadBalancingV2::ListenerRule'),
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
        process.env[EDGE_CUTOVER_SERVICES_ENV] = 'food';

        try {
            expect(ruleHeaderConditionValues(synthFoodTemplate('prod', 'prod'))).toHaveLength(1);
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
 * The message substrate's per-stage OWNERSHIP split (R1, plan U5).
 *
 * ⛔ The split is mechanical, not stylistic, and getting it backwards fails in two different silent ways.
 * A per-PR table added to the GLOBAL app would never be created at all — `bin/app.ts` tags that app
 * `Environment=global` and sandbox-deploy never runs it with `stage=pr-{N}` — and if it somehow were, it
 * would carry the one tag ADR-0005's teardown uses to decide what NOT to delete, leaking a table per closed
 * pull request forever. A base-stage table created HERE would be a second table competing for the name the
 * global stack already owns.
 */
describe('the message substrate this stack owns (plan U5)', () => {
    it('creates its OWN table for a per-PR stage, so teardown reclaims it with the preview', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');

        template.resourceCountIs('AWS::DynamoDB::Table', 1);
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'kitchensink-messages-pr-7',
            KeySchema: [
                { AttributeName: 'PK', KeyType: 'HASH' },
                { AttributeName: 'SK', KeyType: 'RANGE' },
            ],
            TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
            StreamSpecification: { StreamViewType: 'KEYS_ONLY' },
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

    it('creates NO table for a base stage — the global MessageSubstrateStack owns that one', () => {
        synthFoodTemplate('prod', 'prod').resourceCountIs('AWS::DynamoDB::Table', 0);
    });

    it('resolves a base stage`s table from SSM, never a CFN import and never a hardcoded name', () => {
        // ⛔ SSM, not `Fn.importValue`: a per-PR substrate export IS deleted on PR close, and PR-close
        // deletes a PR's stacks in NO fixed order — so an importing stack holds the export hostage and
        // deadlocks the teardown, unattended, in CI (the ADR-0002 export-in-use failure that
        // RecipeServiceStack:230 already documents).
        const json = JSON.stringify(synthFoodTemplate('prod', 'prod').toJSON());

        expect(json).toContain('/kitchensink/prod/messaging/table-name');
        expect(json).not.toContain('kitchensink-messaging-prod:MessageTableName');
    });

    it('grants the worker PutItem and NOTHING else on the table', () => {
        // The producer half never reads what it wrote. A Query/Scan grant would be a permission with no
        // caller — and the surface an attacker inherits if the worker is compromised.
        const template = synthFoodTemplate('pr-7', 'sandbox');
        const policies = Object.values(template.findResources('AWS::IAM::Policy')) as Array<{
            Properties: { PolicyDocument: { Statement: Array<{ Sid?: string; Action?: unknown }> } };
        }>;
        const statements = policies
            .flatMap((p) => p.Properties.PolicyDocument.Statement)
            .filter((s) => s.Sid === 'FoodWorkerPublishesMessages');

        expect(statements).toHaveLength(1);
        expect(statements[0]?.Action).toEqual('dynamodb:PutItem');
    });
});

/**
 * The schema-before-traffic gate (ADR-0021 / the prod deploy-ordering hazard).
 *
 * ## What breaks without it
 *
 * `cdk deploy` returns only once the ECS service has STABILISED, so a pipeline that deploys and then
 * invokes the migration runner has already put the new image in front of live traffic for the whole
 * stabilisation window. Food's read path now joins `food_nutrient_view` (migration `0006`), so that window
 * is `relation "food_nutrient_view" does not exist` — a 500 on every nutrition read, and since prod is
 * fronted by CloudFront, a 500 that gets CACHED.
 *
 * ## Why the fix is IN the stack and not in the workflow
 *
 * The obvious repair — move the pipeline's migrate step above its `cdk deploy` — is WORSE than the hazard,
 * and silently so. `esbuild.mjs` copies `src/db/migrations/*.sql` into `dist-lambda/migrations/` at BUILD
 * time and that bundle ships WITH `cdk deploy`, so invoking first invokes the PREVIOUS deploy's Lambda with
 * the PREVIOUS migration set: exit 0, "nothing pending", nothing applied, and the new tasks still meet a
 * missing relation. The only place that can run the NEW migrations before the NEW tasks serve is inside the
 * deploy, between the Lambda's code update and the ECS service's rollout — which is what
 * `aws-cdk-lib/triggers` expresses and what these assertions pin.
 *
 * ## What each assertion is load-bearing for
 *
 * The trigger is tied to the function the PIPELINE invokes (the `FoodMigrationFunctionName` output), not to
 * "some Lambda": a second runner drifting from the one CI calls is exactly the class of defect
 * `serviceInfraWiringInvariants.test.ts` exists for. The ECS dependency is asserted over EVERY
 * `AWS::ECS::Service` the stack synthesizes rather than a named one, so a third Fargate service added later
 * is covered without anyone remembering this file. And the trigger's socket timeout is compared against the
 * runner's OWN timeout rather than a literal, because the default is two minutes and the runner is allowed
 * five — a full migration that outlives the socket fails a deploy that had already applied the schema.
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
        const template = synthFoodTemplate('pr-7', 'sandbox');
        const migrationFunctionId = pipelineInvokedMigrationFunctionId(template);
        const versions = Object.entries(template.findResources('AWS::Lambda::Version')) as Array<
            [string, { Properties: { FunctionName: { Ref?: string } } }]
        >;

        // One version, on the migration function. `triggers.Trigger` keys the custom resource to
        // `handler.currentVersion`, which is what makes it re-execute when — and only when — the bundled
        // migration set changes.
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
        const template = synthFoodTemplate('pr-7', 'sandbox');
        const [triggerId] = Object.keys(template.findResources('Custom::Trigger'));
        const services = Object.entries(template.findResources('AWS::ECS::Service')) as Array<
            [string, SynthesizedResource]
        >;

        // Guards the loop below against passing vacuously if the services are ever renamed away.
        expect(services.length, 'expected the API service and the fetch worker').toBeGreaterThanOrEqual(2);

        for (const [serviceId, service] of services) {
            expect(dependsOn(service), `${serviceId} must not roll out before the migration trigger has run`).toContain(
                triggerId,
            );
        }
    });

    it('gives the trigger longer to wait than the runner is allowed to take', () => {
        const template = synthFoodTemplate('pr-7', 'sandbox');
        const migrationFunctionId = pipelineInvokedMigrationFunctionId(template);
        const runner = template.findResources('AWS::Lambda::Function')[migrationFunctionId] as {
            Properties: { Timeout: number };
        };
        const [trigger] = Object.values(template.findResources('Custom::Trigger')) as SynthesizedResource[];

        expect(Number(trigger?.Properties?.['Timeout'])).toBeGreaterThanOrEqual(runner.Properties.Timeout * 1000);
        // A trigger that skipped re-execution on a code change would apply nothing on the deploy that
        // introduces a migration — the exact silent no-op this whole gate exists to remove.
        expect(trigger?.Properties?.['ExecuteOnHandlerChange']).toBe(true);
    });
});
