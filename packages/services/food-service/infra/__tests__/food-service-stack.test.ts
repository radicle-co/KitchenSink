import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import {
    FoodServiceStack,
    foodDatabaseNameForStage,
    foodListenerPriorityForStage,
    foodSubdomainForStage,
    BASE_FOOD_LISTENER_PRIORITY,
    PER_PR_PRIORITY_BASE,
    NAMED_STAGE_PRIORITY_BASE,
    EPHEMERAL_PRIORITY_BAND_WIDTH,
} from '../lib/food-service-stack.js';

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

    it('non-prod wires Clerk auth env with the azp PATTERN + preview mode (not the exact-match list)', () => {
        // Without CLERK_JWT_KEY the FoodAuthGuard fail-closes and every /v1/foods/* request is 401.
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
                ':secretsmanager:us-east-1:123456789012:secret:kitchensink/test/food/usda-api-key-??????',
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

        // Base food priority is unchanged.
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_FOOD_LISTENER_PRIORITY,
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    HostHeaderConfig: Match.objectLike({ Values: ['food.example.com'] }),
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
            Priority: PER_PR_PRIORITY_BASE + 7,
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

describe('foodSubdomainForStage (ADR-0006 — cert-safe per-PR host)', () => {
    it('uses the dotted host for base stages (covered by the wildcard certs)', () => {
        expect(foodSubdomainForStage('prod', 'prod')).toBe('food');
        expect(foodSubdomainForStage('sandbox', 'sandbox')).toBe('food.sandbox');
    });

    it('uses the dash form for a per-PR stage so `*.commise.app` covers it (no 3-label host)', () => {
        expect(foodSubdomainForStage('pr-7', 'sandbox')).toBe('food-pr-7');
        expect(foodSubdomainForStage('pr-123', 'sandbox')).toBe('food-pr-123');
    });
});

describe('foodDatabaseNameForStage', () => {
    it('returns the imported base name for a base (stage === baseStage) stage', () => {
        expect(foodDatabaseNameForStage('prod', 'prod', '<imported-token>')).toBe('<imported-token>');
        expect(foodDatabaseNameForStage('sandbox', 'sandbox', '<imported-token>')).toBe('<imported-token>');
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

describe('foodListenerPriorityForStage', () => {
    it('keeps the fixed food priority for a base stage', () => {
        expect(foodListenerPriorityForStage('prod', 'prod')).toBe(BASE_FOOD_LISTENER_PRIORITY);
        expect(foodListenerPriorityForStage('sandbox', 'sandbox')).toBe(BASE_FOOD_LISTENER_PRIORITY);
    });

    it('allocates pr-{N} into the per-PR band as PER_PR_PRIORITY_BASE + N', () => {
        expect(foodListenerPriorityForStage('pr-7', 'sandbox')).toBe(PER_PR_PRIORITY_BASE + 7);
        expect(foodListenerPriorityForStage('pr-42', 'sandbox')).toBe(PER_PR_PRIORITY_BASE + 42);
    });

    it('gives distinct per-PR priorities that never collide with the base priority', () => {
        const a = foodListenerPriorityForStage('pr-1', 'sandbox');
        const b = foodListenerPriorityForStage('pr-15', 'sandbox');

        expect(a).not.toBe(b);
        expect(a).toBeGreaterThan(BASE_FOOD_LISTENER_PRIORITY);
        expect(b).toBeGreaterThan(BASE_FOOD_LISTENER_PRIORITY);
    });

    it('hashes a named non-PR stage into a band disjoint from the per-PR band', () => {
        const priority = foodListenerPriorityForStage('team-feature-x', 'sandbox');

        // Named stages live at 20000–29999, strictly above the per-PR band (10000–19999), so a hashed
        // value can never equal a `pr-{N}` rule's priority on the shared listener.
        expect(priority).toBeGreaterThanOrEqual(NAMED_STAGE_PRIORITY_BASE);
        expect(priority).toBeLessThan(NAMED_STAGE_PRIORITY_BASE + EPHEMERAL_PRIORITY_BAND_WIDTH);
        expect(priority).toBeGreaterThanOrEqual(PER_PR_PRIORITY_BASE + EPHEMERAL_PRIORITY_BAND_WIDTH);
    });

    it('is deterministic across synths for the same named stage', () => {
        expect(foodListenerPriorityForStage('dev', 'sandbox')).toBe(foodListenerPriorityForStage('dev', 'sandbox'));
    });

    it('throws for a PR number too large to fit the per-PR band (cannot overflow into the named band)', () => {
        expect(() => foodListenerPriorityForStage(`pr-${EPHEMERAL_PRIORITY_BAND_WIDTH}`, 'sandbox')).toThrow(
            /exceeds the per-PR listener-priority band/,
        );
    });
});
