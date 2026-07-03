import {
    CfnOutput,
    Duration,
    Fn,
    Stack,
    type StackProps,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cloudwatch_actions,
    aws_ec2 as ec2,
    aws_ecr as ecr,
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elbv2,
    aws_events as events,
    aws_events_targets as targets,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_logs as logs,
    aws_rds as rds,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_secretsmanager as secretsmanager,
    aws_sns as sns,
    aws_ssm as ssm,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

/**
 * Canonical food worker metric names — MUST stay byte-identical to `src/observability/emf-metrics.ts`
 * `FOOD_METRIC` (the worker emits these EMF metric names; the dashboard charts and the alarms alarm on
 * them). A CDK test cross-checks these against the exported source constants so the two cannot drift.
 */
const FOOD_METRIC_NAMESPACE = 'Commise/Food';
const FOOD_METRIC = {
    fetchQueueDepth: 'food-fetch-queue-depth',
    resolutionLatencySeconds: 'food-resolution-latency-seconds',
    sourceRollingWindowCount: 'source-rolling-window-count',
    unresolvedBacklog: 'food-unresolved-backlog',
    tombstoneCount: 'food-tombstone-count',
    pendingAgeSeconds: 'food-fetch-pending-age-seconds',
    inFlightLeases: 'food-in-flight-leases',
    workerErrorCount: 'food-worker-error-count',
} as const;

/** The single shared base logical database on the persistent platform instance (ADR-0006). */
export const BASE_FOOD_DATABASE_NAME = 'kitchensink_food';

/**
 * Per-PR listener-rule priority band on the shared sandbox ALB (ADR-0003 + ADR-0006).
 *
 * Base stages use the fixed food priority (200); every per-PR preview rides the shared sandbox
 * listener and MUST carry a unique priority, so `pr-{N}` allocates `PER_PR_PRIORITY_BASE + N`. The
 * band (10000–19999) sits well clear of the fixed service priorities (identity=100, food=200, …).
 */
export const PER_PR_PRIORITY_BASE = 10_000;

/** Width of each ephemeral priority band; also caps the PR number that fits below the named band. */
export const EPHEMERAL_PRIORITY_BAND_WIDTH = 10_000;

/**
 * Listener-rule priority band for a NAMED non-PR ephemeral stage (e.g. `dev`, `team-feature-x`).
 *
 * Kept strictly ABOVE the per-PR band so a hashed named-stage priority can never collide with a
 * `pr-{N}` rule: PRs occupy 10000–19999, named stages 20000–29999 (ALB rule priorities max at 50000,
 * so both fit). Within the named band the stage string is hashed, so two *distinct, concurrently
 * deployed* named stages could still collide — that residual is inherent to hashing and acceptable
 * because named ephemeral stages are deployed one-at-a-time by hand (unlike PRs, which are keyed off
 * the globally unique PR number).
 */
export const NAMED_STAGE_PRIORITY_BASE = 20_000;

/** The fixed shared-ALB listener-rule priority for the food service on a base (prod/sandbox) stage. */
export const BASE_FOOD_LISTENER_PRIORITY = 200;

/**
 * Resolve the food service's logical database name for a stage.
 *
 * Base stages (`stage === baseStage`, i.e. prod/sandbox) use the imported shared `kitchensink_food`
 * database. A per-PR stage gets an isolated logical database `kitchensink_food_{suffix}` on the SAME
 * shared instance, where the suffix is the stage sanitized to a valid lowercase pg identifier (e.g.
 * `pr-7` → `kitchensink_food_pr_7`). The result always matches `^kitchensink_food(_[a-z0-9_]+)?$`, the
 * pattern the migration runner validates before quoting it into `CREATE DATABASE` (ADR-0006).
 *
 * @param stage - The deploy stage (identity: naming/routing/DB isolation).
 * @param baseStage - The persistent platform stage the deploy rides (prod → prod, else → sandbox).
 * @param importedBaseName - The `Fn.importValue` token for the base stage's `FoodDatabaseName` export.
 * @returns The imported base name for a base stage, else the derived per-PR database name.
 */
export function foodDatabaseNameForStage(stage: string, baseStage: string, importedBaseName: string): string {
    if (stage === baseStage) {
        return importedBaseName;
    }

    const suffix = stage
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (suffix === '') {
        throw new Error(
            `Cannot derive a per-PR food database name from stage '${stage}': it sanitizes to an empty ` +
                'suffix. A non-base stage must contain at least one alphanumeric character.',
        );
    }

    return `${BASE_FOOD_DATABASE_NAME}_${suffix}`;
}

/**
 * Resolve the shared-ALB listener-rule priority for a stage.
 *
 * A base stage uses the fixed food priority (200). A per-PR `pr-{N}` stage allocates from the per-PR
 * band (`PER_PR_PRIORITY_BASE + N`, 10000–19999) keyed off the globally unique PR number. Any other
 * non-base (named ephemeral) stage hashes into a SEPARATE band (`NAMED_STAGE_PRIORITY_BASE + hash`,
 * 20000–29999) so a hashed value can never collide with a `pr-{N}` rule — the two bands are disjoint
 * by construction. The per-PR band is capped at {@link EPHEMERAL_PRIORITY_BAND_WIDTH} so an
 * (unrealistically large) PR number can never overflow into the named band; it throws instead.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The resolved base stage.
 * @returns A listener-rule priority for the stage within the shared listener.
 * @throws If a `pr-{N}` number is too large to fit the per-PR band.
 */
export function foodListenerPriorityForStage(stage: string, baseStage: string): number {
    if (stage === baseStage) {
        return BASE_FOOD_LISTENER_PRIORITY;
    }

    const prMatch = /^pr-(\d+)$/.exec(stage);

    if (prMatch) {
        const prNumber = Number(prMatch[1]);

        // Keep the PR band disjoint from the named band by construction; a PR number this large is not
        // real, so fail loudly at synth rather than silently overflow into another stage's priority.
        if (prNumber >= EPHEMERAL_PRIORITY_BAND_WIDTH) {
            throw new Error(
                `PR number ${prNumber} exceeds the per-PR listener-priority band width ` +
                    `(${EPHEMERAL_PRIORITY_BAND_WIDTH}); the shared-ALB priority scheme cannot allocate it.`,
            );
        }

        return PER_PR_PRIORITY_BASE + prNumber;
    }

    // Named non-PR ephemeral stage (e.g. `dev`, a named feature sandbox): hash the stage into the
    // DEDICATED named band so it is stable across synths and stays clear of BOTH the fixed service
    // priorities and the per-PR band (see NAMED_STAGE_PRIORITY_BASE for the residual collision note).
    let hash = 0;

    for (const char of stage) {
        hash = (hash * 31 + char.charCodeAt(0)) % EPHEMERAL_PRIORITY_BAND_WIDTH;
    }

    return NAMED_STAGE_PRIORITY_BASE + hash;
}

/**
 * Resolve the food service's DNS label (the `Host` header + A-record name) for a stage.
 *
 * The shared ALB certificate covers `commise.app`, `*.commise.app`, and `*.sandbox.commise.app`
 * (ADR-0003 / DomainStack) — all **single-label** wildcards. A base stage therefore uses a dotted host
 * that the cert covers: prod → `food` (`food.commise.app`), sandbox → `food.sandbox`
 * (`food.sandbox.commise.app`). A per-PR stage must NOT use `food.pr-{N}` — that 3-label host
 * (`food.pr-7.commise.app`) is uncovered by any wildcard and fails the TLS handshake — so it flips the
 * separator to a dash: `food-{stage}` → `food-pr-7.commise.app`, a single label covered by
 * `*.commise.app` (ADR-0006; matches the `{service}-pr-{N}.commise.app` convention in
 * `sandbox-deploy.yml`). Pure.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The resolved base stage (prod → prod, else → sandbox).
 * @returns The subdomain label to prefix onto the apex domain.
 */
export function foodSubdomainForStage(stage: string, baseStage: string): string {
    if (stage === 'prod') {
        return 'food';
    }

    // A base stage (sandbox) is a single label under the apex, covered by `*.sandbox.commise.app`; a
    // per-PR stage rides `*.commise.app` via the dash form so the shared cert covers the preview host.
    return stage === baseStage ? `food.${stage}` : `food-${stage}`;
}

/** Props for {@link FoodServiceStack}. */
export interface FoodServiceStackProps extends StackProps {
    /** Deploy stage (`prod`, `sandbox`, `pr-{N}`, …) — drives naming, tagging, routing, DB isolation. */
    readonly stage: string;
    /**
     * The persistent platform stage this deploy imports from (ADR-0006): `prod → prod`, everything
     * else → `sandbox`. All platform imports (network/data/alb/domain, the USDA key secret, the VPC)
     * resolve against `baseStage`; `stage` still drives names, tags, routing, the EventBus, the per-PR
     * DB name, and cleanup. Defaults to `stage` (a stage is its own base) so a base-stage synth is
     * byte-identical to the pre-ADR-0006 template.
     */
    readonly baseStage?: string;
    /** Apex domain for the service's `food[.stage].{domain}` record. */
    readonly domainName: string;
    /** Container image tag (commit SHA) for the API and worker tasks. */
    readonly imageTag: string;
    /** Desired count for the ALB-fronted API service. */
    readonly desiredCount: number;
    /** Desired count for the Fargate fetch worker (FR-022: exactly one consumer at MVP). */
    readonly workerDesiredCount: number;
    /** Shared VPC id to import. */
    readonly vpcId: string;
    /** Optional UNRESOLVED-candidate TTL (days) for the change-refresh task (`FOOD_UNRESOLVED_TTL_DAYS`). */
    readonly unresolvedTtlDays?: number;
}

/**
 * Food service infrastructure (feature 003).
 *
 * Mirrors `IdentityServiceStack`: an ECS/Fargate NestJS service fronted by the shared per-stage ALB
 * (owned by the global infra) via a host-based listener rule. Additionally defines the **Fargate
 * consumer worker** (single desired count — the Postgres `fetch_queue` is the demand queue, so there
 * is NO SQS), the **change-refresh Fargate scheduled task** (EventBridge → ECS `RunTask`, T-001c), the
 * **in-VPC migration-runner Lambda** (T-191), and the food **observability** surface (EMF-backed
 * dashboard + alarms). It does NOT create an RDS instance — it `Fn.importValue`s the shared
 * `kitchensink-data-{stage}` exports plus `:FoodDbSecretArn` / `:FoodDatabaseName` and connects to the
 * `kitchensink_food` database.
 *
 * Subnet placement (ADR-0004): the API + worker + change-refresh Fargate workloads run in PUBLIC
 * subnets with `assignPublicIp` (egress to USDA/AWS via the IGW, inbound locked to the service SG). The
 * migration-runner Lambda is the ONLY food workload on the NAT (a VPC Lambda cannot egress via a public
 * IP, and it must reach the private RDS).
 *
 * @implements ARCH-001 FR-022 FR-031 FR-032 FR-046 FR-048 SC-002 SC-006
 */
export class FoodServiceStack extends Stack {
    /** Public HTTPS URL of the food API. */
    public readonly serviceUrl: string;
    /** ECS service name of the Fargate fetch worker (exported for ops/deploy tooling). */
    public readonly foodFetchWorkerServiceName: string;

    public constructor(scope: Construct, id: string, props: FoodServiceStackProps) {
        super(scope, id, props);

        const { stage, imageTag, desiredCount, workerDesiredCount, vpcId, domainName } = props;

        // ADR-0006: platform imports ride the persistent BASE stage (prod → prod, else → sandbox); the
        // `stage` above still drives naming/tagging/routing/DB-isolation. For prod/sandbox stage ===
        // baseStage, so every import string below is unchanged and the synthesized template does not
        // diff. `vpcId` is supplied by the caller already pointing at the base stage's VPC.
        const baseStage = props.baseStage ?? stage;

        // Fargate Spot for non-prod (ADR-0008). Prod runs on-demand `FARGATE` (unchanged → no prod
        // diff); every non-prod stage (sandbox + ephemeral pr-{N} previews) runs interruption-tolerant
        // `FARGATE_SPOT` — the previews are disposable and the fetch worker is idempotent (leased
        // fetch_queue rows re-lease after an interruption). The cluster must advertise the FARGATE_SPOT
        // capacity provider before a service/task strategy can bind, so the flag and strategy are gated
        // together on `stage`, NOT `baseStage` (a pr-{N} preview must run Spot even though it imports
        // the sandbox platform).
        const useSpot = stage !== 'prod';
        const capacityProviderStrategies = useSpot ? [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }] : undefined;

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { vpcId });

        const albSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedAlbSg',
            Fn.importValue(`kitchensink-network-${baseStage}:AlbSecurityGroupId`),
        );

        const serviceSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedServiceSg',
            Fn.importValue(`kitchensink-network-${baseStage}:ServiceSecurityGroupId`),
        );

        // Shared DB connection secret (instance master) + the dedicated least-privilege food role
        // secret (T-001b). NO RDS is created here — the instance is owned by the global DataStack.
        const sharedDbSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedDbSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${baseStage}:DatabaseSecretArn`),
        });

        const foodDbSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedFoodDbSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${baseStage}:FoodDbSecretArn`),
        });

        const database = rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedDatabase', {
            instanceIdentifier: `kitchensink-data-${baseStage}`,
            instanceEndpointAddress: Fn.importValue(`kitchensink-data-${baseStage}:DatabaseEndpoint`),
            port: Number(Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`)),
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(
                    this,
                    'ImportedDbSg',
                    Fn.importValue(`kitchensink-network-${baseStage}:DatabaseSecurityGroupId`),
                ),
            ],
        });

        const repository = ecr.Repository.fromRepositoryName(this, 'FoodServiceRepository', 'kitchensink-food');

        const cluster = new ecs.Cluster(this, 'FoodServiceCluster', {
            vpc,
            // Per-stage observability depth (ADR-0007). Prod keeps ENHANCED (unchanged → no prod diff);
            // non-prod stages (sandbox + per-PR previews) drop to the STANDARD tier — `ENABLED` (CFN
            // `enabled`) is base Container Insights, priced well below the ENHANCED tier — to cap the
            // cost the food cluster adds when it deploys.
            containerInsightsV2: stage === 'prod' ? ecs.ContainerInsights.ENHANCED : ecs.ContainerInsights.ENABLED,
            // ADR-0008: advertise the FARGATE_SPOT capacity provider for non-prod only. `false` (prod)
            // creates no ClusterCapacityProviderAssociations resource, so the prod template is unchanged.
            enableFargateCapacityProviders: useSpot,
        });

        const taskExecutionRole = new iam.Role(this, 'FoodTaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });
        taskExecutionRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['secretsmanager:GetSecretValue'],
                resources: ['*'],
            }),
        );

        // EventBridge bus the worker uses to signal fetch lifecycle (no SQS). The completion event
        // (`FoodFetchCompleted`) is still emitted as part of the event contract for future consumers;
        // there is deliberately NO rule consumer on the bus right now (the prior search-indexer rule
        // was removed — T-180 ships search_vector as a STORED generated column, so no indexer is needed).
        const eventBus = new events.EventBus(this, 'FoodEventBus', {
            eventBusName: `kitchensink-food-${stage}`,
        });

        // Per-PR logical database isolation (ADR-0006). A base stage (prod/sandbox) uses the imported
        // shared `kitchensink_food`; a per-PR stage gets `kitchensink_food_pr_{N}` on the SAME shared
        // instance. For base stages this equals the imported token, so the template does not diff.
        const importedFoodDatabaseName = Fn.importValue(`kitchensink-data-${baseStage}:FoodDatabaseName`);
        const foodDatabaseName = foodDatabaseNameForStage(stage, baseStage, importedFoodDatabaseName);

        const foodDbEnvironment: Record<string, string> = {
            NODE_ENV: 'production',
            STAGE: stage,
            DB_HOST: database.dbInstanceEndpointAddress,
            DB_PORT: Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`),
            DB_NAME: foodDatabaseName,
            FOOD_EVENT_BUS_NAME: eventBus.eventBusName,
            // Clerk session-token verification (FoodAuthGuard → verifyClerkToken). The JWT *public* key
            // and the authorized-parties allowlist are non-secret, resolved from SSM at deploy — same
            // wiring as the identity service. Without these the guard fail-closes and every `/v1/foods/*`
            // request is 401. Prod reads prod params; every other stage (incl. `pr-{N}`) reads the shared
            // sandbox (dev-instance) params, matching `baseStage`.
            CLERK_JWT_KEY: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${baseStage}/clerk/jwt-public-key`,
            ),
            CLERK_AUTHORIZED_PARTIES: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${baseStage}/clerk/authorized-parties`,
            ),
        };

        // Source API credential (`USDA_API_KEY`). The Nest app env validation requires it
        // (config/env.schema.ts) and both the worker and the change-refresh entrypoint THROW without it,
        // so all three containers receive it — injected from Secrets Manager as an `ecs.Secret` (like the
        // DB creds) so the value never lands in the CloudFormation template. The secret is created
        // out-of-band per stage (it is an externally-issued third-party key CDK cannot generate) and
        // imported here by name; the value is set via `aws secretsmanager put-secret-value`.
        const usdaApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
            this,
            'ImportedUsdaApiKeySecret',
            `kitchensink/${baseStage}/food/usda-api-key`,
        );

        const sourceCredentialsSecrets = {
            USDA_API_KEY: ecs.Secret.fromSecretsManager(usdaApiKeySecret),
        };

        const foodDbSecrets = {
            DB_USERNAME: ecs.Secret.fromSecretsManager(foodDbSecret, 'username'),
            DB_PASSWORD: ecs.Secret.fromSecretsManager(foodDbSecret, 'password'),
        };

        // ── API service (ECS/Fargate behind the shared ALB) ─────────────────────────────────────
        const apiTaskRole = new iam.Role(this, 'FoodApiTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for the food API',
        });
        sharedDbSecret.grantRead(apiTaskRole);
        foodDbSecret.grantRead(apiTaskRole);
        eventBus.grantPutEventsTo(apiTaskRole);

        const apiTaskDefinition = new ecs.FargateTaskDefinition(this, 'FoodApiTaskDefinition', {
            cpu: 512,
            memoryLimitMiB: 1024,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole: apiTaskRole,
        });

        const apiLogGroup = new logs.LogGroup(this, 'FoodApiLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        apiTaskDefinition.addContainer('FoodApiContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'food-service', logGroup: apiLogGroup }),
            environment: { ...foodDbEnvironment, PORT: '3000' },
            secrets: { ...foodDbSecrets, ...sourceCredentialsSecrets },
            command: ['node', 'dist/src/main.js'],
            portMappings: [{ containerPort: 3000 }],
            healthCheck: {
                command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
                interval: Duration.seconds(30),
                timeout: Duration.seconds(10),
                retries: 3,
                startPeriod: Duration.seconds(60),
            },
        });

        const apiService = new ecs.FargateService(this, 'FoodApiService', {
            cluster,
            taskDefinition: apiTaskDefinition,
            desiredCount,
            // ADR-0008: non-prod runs on FARGATE_SPOT (undefined for prod keeps on-demand LaunchType
            // FARGATE → no prod diff). Providing a strategy omits LaunchType from the service resource.
            capacityProviderStrategies,
            // Public subnet + public IP so the task egresses to USDA/AWS via the Internet Gateway (free)
            // instead of the NAT. Inbound stays locked to the ALB SG (serviceSecurityGroup), so the
            // public IP is egress-only; the task still reaches the private RDS intra-VPC by SG. This
            // keeps the NAT serving ONLY the migration-runner Lambda (ADR-0004 minimize-nat).
            assignPublicIp: true,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [serviceSecurityGroup],
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(120),
            circuitBreaker: { rollback: true },
        });

        // ── Fargate consumer worker (single desired count; LISTEN/NOTIFY drain loop) ─────────────
        const workerTaskRole = new iam.Role(this, 'FoodWorkerTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for the food fetch worker',
        });
        sharedDbSecret.grantRead(workerTaskRole);
        foodDbSecret.grantRead(workerTaskRole);
        eventBus.grantPutEventsTo(workerTaskRole);

        const workerTaskDefinition = new ecs.FargateTaskDefinition(this, 'FoodWorkerTaskDefinition', {
            cpu: 256,
            memoryLimitMiB: 512,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole: workerTaskRole,
        });

        const workerLogGroup = new logs.LogGroup(this, 'FoodWorkerLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        workerTaskDefinition.addContainer('FoodWorkerContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'food-worker', logGroup: workerLogGroup }),
            environment: { ...foodDbEnvironment, FOOD_WORKER: '1' },
            secrets: { ...foodDbSecrets, ...sourceCredentialsSecrets },
            command: ['node', 'dist/src/worker/main.js'],
        });

        const workerService = new ecs.FargateService(this, 'FoodFetchWorkerService', {
            cluster,
            taskDefinition: workerTaskDefinition,
            // FR-022: exactly one consumer holds the LISTEN connection at MVP.
            desiredCount: workerDesiredCount,
            // ADR-0008: non-prod runs on FARGATE_SPOT (undefined for prod keeps on-demand LaunchType
            // FARGATE → no prod diff). The worker is interruption-tolerant — an interrupted lease
            // expires and the row re-leases, so a Spot reclaim only delays, never drops, a fetch.
            capacityProviderStrategies,
            // Public subnet + public IP (egress-only, inbound SG-locked) — IGW egress off the NAT path,
            // intra-VPC reach to the private RDS by SG (ADR-0004), same as the API service above.
            assignPublicIp: true,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [serviceSecurityGroup],
            // A rolling deploy must not run two consumers; keep at most one task during deploys.
            minHealthyPercent: 0,
            maxHealthyPercent: 100,
        });
        this.foodFetchWorkerServiceName = workerService.serviceName;

        // ── Change-refresh Fargate scheduled task (T-001c / D-REFRESH) ──────────────────────────
        // An EventBridge schedule → ECS `RunTask` of a dedicated task definition running the
        // change-refresh entrypoint (`runOnce()` then exit). This is NOT a long-running ECS *service*
        // (RunTask uses only a task def), so the "exactly 2 ECS services" invariant still holds.
        const changeRefreshTaskRole = new iam.Role(this, 'FoodChangeRefreshTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for the change-refresh scheduled task (T-053)',
        });
        sharedDbSecret.grantRead(changeRefreshTaskRole);
        foodDbSecret.grantRead(changeRefreshTaskRole);
        // T-053: this named role is the only refresh-path principal allowed to PutEvents on the bus.
        eventBus.grantPutEventsTo(changeRefreshTaskRole);

        const changeRefreshTaskDefinition = new ecs.FargateTaskDefinition(this, 'FoodChangeRefreshTaskDefinition', {
            cpu: 256,
            memoryLimitMiB: 512,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole: changeRefreshTaskRole,
        });

        const changeRefreshLogGroup = new logs.LogGroup(this, 'FoodChangeRefreshLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        const changeRefreshEnvironment: Record<string, string> = {
            ...foodDbEnvironment,
        };

        if (props.unresolvedTtlDays !== undefined) {
            changeRefreshEnvironment.FOOD_UNRESOLVED_TTL_DAYS = String(props.unresolvedTtlDays);
        }

        changeRefreshTaskDefinition.addContainer('FoodChangeRefreshContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'food-change-refresh', logGroup: changeRefreshLogGroup }),
            environment: changeRefreshEnvironment,
            secrets: { ...foodDbSecrets, ...sourceCredentialsSecrets },
            command: ['node', 'dist/src/worker/change-refresh/main.js'],
        });

        // D-REFRESH is explicitly low-priority idle-drain background work that yields to live demand
        // (no fixed-cadence promise). Every 6 hours is frequent enough to pick up upstream changes
        // without competing with the demand-driven fetch path.
        const changeRefreshRule = new events.Rule(this, 'IngestionScheduled', {
            description:
                'Change-refresh: re-enqueue RESOLVED foods for a selective in-place re-pull (FR-032, D-REFRESH)',
            schedule: events.Schedule.rate(Duration.hours(6)),
            targets: [
                new targets.EcsTask({
                    cluster,
                    taskDefinition: changeRefreshTaskDefinition,
                    taskCount: 1,
                    // ADR-0004: Fargate egress to USDA via the IGW (public subnet + public IP); inbound
                    // SG-locked (egress-only). Reaches the private RDS intra-VPC by SG.
                    subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
                    assignPublicIp: true,
                    securityGroups: [serviceSecurityGroup],
                }),
            ],
        });

        // ADR-0008: run the change-refresh RunTask on FARGATE_SPOT for non-prod too (the 6-hourly
        // re-pull is idempotent and interruption-tolerant). The L2 `EcsTask` target (CDK 2.254) only
        // exposes `launchType`, not a capacity-provider strategy, so inject the strategy on the
        // synthesized rule target via an escape hatch. `LaunchType` and `CapacityProviderStrategy` are
        // mutually exclusive in `EcsParameters`, so the default `LaunchType: FARGATE` is deleted first.
        // Guarded to non-prod, so prod keeps `LaunchType: FARGATE` unchanged → no prod diff.
        if (useSpot) {
            const cfnChangeRefreshRule = changeRefreshRule.node.defaultChild as events.CfnRule;
            cfnChangeRefreshRule.addPropertyDeletionOverride('Targets.0.EcsParameters.LaunchType');
            cfnChangeRefreshRule.addPropertyOverride('Targets.0.EcsParameters.CapacityProviderStrategy', [
                { CapacityProvider: 'FARGATE_SPOT', Weight: 1 },
            ]);
        }

        // ── In-VPC migration-runner Lambda (T-191 / FU-MIGRATE) ─────────────────────────────────
        // The RDS instance is PRIVATE_ISOLATED, so the deploy pipeline invokes this VPC-attached Lambda
        // to apply the ordered SQL against kitchensink_food. It is the ONLY food workload on the NAT (a
        // VPC Lambda's public IP does NOT give egress — ADR-0004 — and it must reach the private RDS).
        // Asset: esbuild bundles to dist-lambda/ (npm run bundle:lambda, run by infra:synth/deploy).
        // Synth must not fail when the asset is absent (e.g. a bare `cdk synth`), so fall back to an
        // inline placeholder when dist-lambda/ has not been built — the real deploy always builds it.
        const lambdaAssetDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist-lambda');
        const migrationCode = existsSync(lambdaAssetDir)
            ? lambda.Code.fromAsset(lambdaAssetDir)
            : lambda.Code.fromInline('export const handler = async () => ({ ok: false, reason: "asset-not-built" });');

        const migrationFn = new lambda.Function(this, 'FoodMigrationFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'lambdas/migrate/handler.handler',
            code: migrationCode,
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: {
                STAGE: stage,
                FOOD_DB_SECRET_ARN: foodDbSecret.secretArn,
                FOOD_DB_ENDPOINT: database.dbInstanceEndpointAddress,
                FOOD_DB_PORT: Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`),
                // Per-PR isolation (ADR-0006): the runner creates this DB if absent then migrates into
                // it. Base stages resolve to the imported `kitchensink_food`, so no template diff.
                FOOD_DB_NAME: foodDatabaseName,
            },
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [serviceSecurityGroup],
        });
        foodDbSecret.grantRead(migrationFn);

        // ── Shared ALB host-rule + DNS (mirrors identity) ───────────────────────────────────────
        // This service does NOT create its own ALB. It imports the shared per-stage ALB's HTTPS
        // listener (owned by the global infra — kitchensink-alb-${stage}) and attaches a host-based
        // rule for its subdomain. See docs/architecture/decisions/0003-shared-alb-per-stage.md.
        const isProd = stage === 'prod';
        const subdomain = foodSubdomainForStage(stage, baseStage);
        const serviceDomain = `${subdomain}.${domainName}`;

        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-domain-${baseStage}:HostedZoneId`),
            zoneName: domainName,
        });

        // Named '…SharedTargets' to match identity's shared-ALB convention (a TG belongs to exactly one
        // load balancer — the shared ALB — and cannot be moved). See identity-service-stack.ts.
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'FoodServiceSharedTargets', {
            vpc,
            port: 3000,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            targets: [apiService.loadBalancerTarget({ containerName: 'FoodApiContainer', containerPort: 3000 })],
            healthCheck: {
                enabled: true,
                path: '/health',
                healthyHttpCodes: '200',
                interval: Duration.seconds(30),
                timeout: Duration.seconds(10),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 10,
            },
        });

        const sharedHttpsListener = elbv2.ApplicationListener.fromApplicationListenerAttributes(
            this,
            'SharedHttpsListener',
            {
                listenerArn: Fn.importValue(`kitchensink-alb-${baseStage}:SharedAlbHttpsListenerArn`),
                securityGroup: albSecurityGroup,
            },
        );

        // Per-service listener-rule priority allocation: identity=100, food=200. Future services pick
        // 300, 400, … A per-PR preview rides the SHARED sandbox listener, so it MUST NOT reuse 200 —
        // it allocates from the per-PR band (PER_PR_PRIORITY_BASE + N; ADR-0006). Base stages keep 200,
        // so their template does not diff. Priorities must be unique across all rules on the listener.
        new elbv2.ApplicationListenerRule(this, 'FoodServiceListenerRule', {
            listener: sharedHttpsListener,
            priority: foodListenerPriorityForStage(stage, baseStage),
            conditions: [elbv2.ListenerCondition.hostHeaders([serviceDomain])],
            targetGroups: [targetGroup],
        });

        const sharedAlb = elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, 'SharedAlb', {
            loadBalancerArn: Fn.importValue(`kitchensink-alb-${baseStage}:SharedAlbArn`),
            securityGroupId: Fn.importValue(`kitchensink-network-${baseStage}:AlbSecurityGroupId`),
            loadBalancerDnsName: Fn.importValue(`kitchensink-alb-${baseStage}:SharedAlbDnsName`),
            loadBalancerCanonicalHostedZoneId: Fn.importValue(
                `kitchensink-alb-${baseStage}:SharedAlbCanonicalHostedZoneId`,
            ),
        });

        new route53.ARecord(this, 'FoodServiceAliasRecord', {
            zone: hostedZone,
            recordName: subdomain,
            target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(sharedAlb)),
        });

        this.serviceUrl = `https://${serviceDomain}`;

        // ── Observability: SNS + alarms (T-183) + dashboard (T-182) ─────────────────────────────
        // Food-specific alarms read the EMF metrics the worker emits (Commise/Food namespace, no extra
        // IAM — CloudWatch auto-extracts from the worker log group). The API 5xx alarm uses the
        // TARGET-group 5xx (per ADR-0003 §Decision-5; the shared ALB's own 5xx is now multi-tenant).
        const alarmTopic = new sns.Topic(this, 'FoodAlarmTopic', {
            displayName: `Food service alarms (${stage})`,
        });
        const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);

        const emfMetric = (metricName: string, statistic: string): cloudwatch.Metric =>
            new cloudwatch.Metric({
                namespace: FOOD_METRIC_NAMESPACE,
                metricName,
                period: Duration.minutes(5),
                statistic,
            });

        // Any tombstone (NOT_FOUND/FAILED) row is worth a look — alarm at > 0 (DSN-9 / FR-016).
        const tombstoneAlarm = new cloudwatch.Alarm(this, 'FoodTombstoneAlarm', {
            metric: emfMetric(FOOD_METRIC.tombstoneCount, 'max'),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'Food has tombstone (NOT_FOUND/FAILED) rows',
        });
        tombstoneAlarm.addAlarmAction(alarmAction);

        // API error rate > 5% — target-group target 5xx over request count (ADR-0003). Division by a
        // zero request count yields no datapoint (no traffic → no alarm), treated as not-breaching.
        const target5xx = targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
            period: Duration.minutes(5),
            statistic: 'sum',
        });
        const requestCount = targetGroup.metrics.requestCount({ period: Duration.minutes(5), statistic: 'sum' });
        const apiErrorRate = new cloudwatch.MathExpression({
            expression: '100 * (errors / requests)',
            usingMetrics: { errors: target5xx, requests: requestCount },
            period: Duration.minutes(5),
            label: 'API 5xx error rate (%)',
        });
        const apiErrorRateAlarm = new cloudwatch.Alarm(this, 'FoodApiErrorRateAlarm', {
            metric: apiErrorRate,
            threshold: 5,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'Food API target 5xx error rate > 5%',
        });
        apiErrorRateAlarm.addAlarmAction(alarmAction);

        // fetch_queue backpressure: pending depth > 10,000 (FR-046).
        const queueDepthAlarm = new cloudwatch.Alarm(this, 'FoodQueueDepthAlarm', {
            metric: emfMetric(FOOD_METRIC.fetchQueueDepth, 'max'),
            threshold: 10_000,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'Food fetch_queue pending depth > 10,000 (FR-046 backpressure)',
        });
        queueDepthAlarm.addAlarmAction(alarmAction);

        // Freshness: the oldest pending row's first_requested age > 5 min (demand not being drained).
        const pendingAgeAlarm = new cloudwatch.Alarm(this, 'FoodPendingAgeAlarm', {
            metric: emfMetric(FOOD_METRIC.pendingAgeSeconds, 'max'),
            threshold: 300,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'Oldest pending fetch_queue row older than 5 minutes',
        });
        pendingAgeAlarm.addAlarmAction(alarmAction);

        // Dashboard (T-182). Per-stage name; ephemeral (pr-{N}) stages carry the pr-{N} prefix so the
        // PR-close name sweep catches it (ADR-0005); prod keeps the bare `food-data`.
        const dashboardName = isProd ? 'food-data' : `${stage}-food-data`;
        const dashboard = new cloudwatch.Dashboard(this, 'FoodDataDashboard', { dashboardName });
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Fetch queue depth & oldest-pending age',
                left: [emfMetric(FOOD_METRIC.fetchQueueDepth, 'max')],
                right: [emfMetric(FOOD_METRIC.pendingAgeSeconds, 'max')],
            }),
            new cloudwatch.GraphWidget({
                title: 'In-flight leases',
                left: [emfMetric(FOOD_METRIC.inFlightLeases, 'max')],
            }),
        );
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Per-source rolling-60-min calls',
                left: [emfMetric(FOOD_METRIC.sourceRollingWindowCount, 'sum')],
            }),
            new cloudwatch.GraphWidget({
                title: 'UNRESOLVED backlog & tombstones',
                left: [emfMetric(FOOD_METRIC.unresolvedBacklog, 'max'), emfMetric(FOOD_METRIC.tombstoneCount, 'max')],
            }),
        );
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Resolution latency (p50/p90, seconds)',
                left: [
                    emfMetric(FOOD_METRIC.resolutionLatencySeconds, 'p50'),
                    emfMetric(FOOD_METRIC.resolutionLatencySeconds, 'p90'),
                ],
            }),
            new cloudwatch.GraphWidget({
                title: 'Worker error rate',
                left: [emfMetric(FOOD_METRIC.workerErrorCount, 'sum')],
            }),
        );

        // ── Outputs ─────────────────────────────────────────────────────────────────────────────
        new CfnOutput(this, 'FoodServiceUrl', {
            value: this.serviceUrl,
            exportName: `${this.stackName}:FoodServiceUrl`,
        });
        new CfnOutput(this, 'FoodFetchWorkerServiceName', {
            value: this.foodFetchWorkerServiceName,
            exportName: `${this.stackName}:foodFetchWorkerServiceName`,
        });
        new CfnOutput(this, 'FoodEventBusName', {
            value: eventBus.eventBusName,
            exportName: `${this.stackName}:FoodEventBusName`,
        });
        // Exported for the deploy-time `lambda invoke` migration step (mirrors identity-webhooks).
        new CfnOutput(this, 'FoodMigrationFunctionName', {
            value: migrationFn.functionName,
            exportName: `${this.stackName}:FoodMigrationFunctionName`,
        });
    }
}
