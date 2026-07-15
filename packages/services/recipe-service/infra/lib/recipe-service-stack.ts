import {
    CfnOutput,
    Duration,
    Fn,
    Stack,
    type StackProps,
    aws_ec2 as ec2,
    aws_ecr as ecr,
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elbv2,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_logs as logs,
    aws_rds as rds,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
    aws_ssm as ssm,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

/** The single shared base logical database on the persistent platform instance (ADR-0006). */
export const BASE_RECIPE_DATABASE_NAME = 'kitchensink_recipes';

/**
 * Per-PR listener-rule priority band on the shared sandbox ALB (ADR-0003 + ADR-0006).
 *
 * CRITICAL: every per-PR preview of EVERY feature service rides the ONE shared sandbox HTTPS listener, so
 * a per-PR priority must be unique across services, not just across PR numbers. Each feature service
 * therefore owns a DISJOINT per-PR band: food uses 10000–19999 (its `PER_PR_PRIORITY_BASE`), so recipe
 * MUST NOT reuse 10000 — recipe-pr-73 (10073) would collide with the already-deployed food-pr-73 (10073),
 * which is exactly the "Priority '10073' is currently in use" failure this avoids. Recipe takes
 * 30000–39999. Do NOT "align" this back to 10000 to match food.
 */
export const PER_PR_PRIORITY_BASE = 30_000;

/** Width of each ephemeral priority band; also caps the PR number that fits below the named band. */
export const EPHEMERAL_PRIORITY_BAND_WIDTH = 10_000;

/** Listener-rule priority band for a NAMED non-PR ephemeral stage (recipe's, disjoint from food's). */
export const NAMED_STAGE_PRIORITY_BASE = 40_000;

/**
 * The fixed shared-ALB listener-rule priority for the recipe service on a base (prod/sandbox) stage.
 * identity = 100, food = 200, recipe = 300 (priorities must be unique across the shared listener).
 */
export const BASE_RECIPE_LISTENER_PRIORITY = 300;

/**
 * Resolve the recipe service's logical database name for a stage. Base stages use the imported shared
 * `kitchensink_recipes`; a per-PR stage gets an isolated `kitchensink_recipes_{suffix}` on the SAME shared
 * instance (ADR-0006). Mirrors {@link foodDatabaseNameForStage}.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The persistent platform stage the deploy rides.
 * @param importedBaseName - The `Fn.importValue` token for the base stage's `RecipeDatabaseName` export.
 * @returns The imported base name for a base stage, else the derived per-PR database name.
 */
export function recipeDatabaseNameForStage(stage: string, baseStage: string, importedBaseName: string): string {
    if (stage === baseStage) {
        return importedBaseName;
    }

    const suffix = stage
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (suffix === '') {
        throw new Error(
            `Cannot derive a per-PR recipe database name from stage '${stage}': it sanitizes to an empty suffix.`,
        );
    }

    return `${BASE_RECIPE_DATABASE_NAME}_${suffix}`;
}

/**
 * Resolve the shared-ALB listener-rule priority for a stage (base = 300; per-PR = 10000+N; named =
 * 20000+hash), keeping the per-PR and named bands disjoint. Mirrors {@link foodListenerPriorityForStage}.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The resolved base stage.
 * @returns A listener-rule priority unique within the shared listener.
 * @throws If a `pr-{N}` number is too large to fit the per-PR band.
 */
export function recipeListenerPriorityForStage(stage: string, baseStage: string): number {
    if (stage === baseStage) {
        return BASE_RECIPE_LISTENER_PRIORITY;
    }

    const prMatch = /^pr-(\d+)$/.exec(stage);

    if (prMatch) {
        const prNumber = Number(prMatch[1]);

        if (prNumber >= EPHEMERAL_PRIORITY_BAND_WIDTH) {
            throw new Error(
                `PR number ${prNumber} exceeds the per-PR listener-priority band width ` +
                    `(${EPHEMERAL_PRIORITY_BAND_WIDTH}); the shared-ALB priority scheme cannot allocate it.`,
            );
        }

        return PER_PR_PRIORITY_BASE + prNumber;
    }

    let hash = 0;

    for (const char of stage) {
        hash = (hash * 31 + char.charCodeAt(0)) % EPHEMERAL_PRIORITY_BAND_WIDTH;
    }

    return NAMED_STAGE_PRIORITY_BASE + hash;
}

/**
 * Resolve the recipe service's DNS label for a stage. prod → `recipe`; a base stage (sandbox) →
 * `recipe.sandbox` (covered by `*.sandbox.commise.app`); a per-PR stage → `recipe-{stage}` (single label
 * covered by `*.commise.app`, so the shared cert covers the preview host). Mirrors food. Pure.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The resolved base stage.
 * @returns The subdomain label to prefix onto the apex domain.
 */
export function recipeSubdomainForStage(stage: string, baseStage: string): string {
    if (stage === 'prod') {
        return 'recipe';
    }

    return stage === baseStage ? `recipe.${stage}` : `recipe-${stage}`;
}

/** Props for {@link RecipeServiceStack}. */
export interface RecipeServiceStackProps extends StackProps {
    /** Deploy stage (`prod`, `sandbox`, `pr-{N}`, …) — drives naming, tagging, routing, DB isolation. */
    readonly stage: string;
    /** The persistent platform stage this deploy imports from (ADR-0006): prod → prod, else → sandbox. */
    readonly baseStage?: string;
    /** Apex domain for the service's `recipe[.stage].{domain}` record. */
    readonly domainName: string;
    /** Container image tag (commit SHA) for the API task. */
    readonly imageTag: string;
    /** Desired count for the ALB-fronted API service. */
    readonly desiredCount: number;
    /** Shared VPC id to import. */
    readonly vpcId: string;
    /** CloudFront/CDN origin for serving photos. No CDN exists yet, so a placeholder is passed in. */
    readonly cloudfrontUrl: string;
    /** Optional food service origin (ingredient nutrition resolution; optional — degrades if absent). */
    readonly foodServiceUrl?: string;
}

/**
 * Recipe service infrastructure (feature 001).
 *
 * Mirrors the food service's API topology: an ECS/Fargate NestJS service fronted by the shared per-stage
 * ALB via a host-based listener rule (priority 300), connecting to the shared RDS `kitchensink_recipes`
 * logical database via RDS IAM auth (recipe_app), plus the in-VPC migration-runner Lambda. It creates NO
 * RDS (owned by the global DataStack) and NO worker/change-refresh tasks (recipe's version-archive +
 * account-erasure workers live in the separate `recipe-workers` package). Fargate Spot for non-prod
 * (ADR-0008); public-subnet egress off the NAT (ADR-0004).
 */
export class RecipeServiceStack extends Stack {
    /** Public HTTPS URL of the recipe API. */
    public readonly serviceUrl: string;

    public constructor(scope: Construct, id: string, props: RecipeServiceStackProps) {
        super(scope, id, props);

        const { stage, imageTag, desiredCount, vpcId, domainName, cloudfrontUrl } = props;
        const baseStage = props.baseStage ?? stage;

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

        // NO RDS created here — owned by the global DataStack. recipe_app connects via RDS IAM auth, so no
        // DB secret; the instance resource id is imported so grantConnect can scope rds-db:connect.
        const database = rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedDatabase', {
            instanceIdentifier: `kitchensink-data-${baseStage}`,
            instanceResourceId: Fn.importValue(`kitchensink-data-${baseStage}:DatabaseResourceId`),
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

        const repository = ecr.Repository.fromRepositoryName(this, 'RecipeServiceRepository', 'kitchensink-recipes');

        // Reuse the shared DataStack media/archive buckets for recipe photos + version archives.
        const photosBucket = s3.Bucket.fromBucketName(
            this,
            'ImportedPhotosBucket',
            Fn.importValue(`kitchensink-data-${baseStage}:MediaBucketName`),
        );
        const versionsBucket = s3.Bucket.fromBucketName(
            this,
            'ImportedVersionsBucket',
            Fn.importValue(`kitchensink-data-${baseStage}:ArchiveBucketName`),
        );

        const cluster = new ecs.Cluster(this, 'RecipeServiceCluster', {
            vpc,
            containerInsightsV2: stage === 'prod' ? ecs.ContainerInsights.ENHANCED : ecs.ContainerInsights.ENABLED,
            enableFargateCapacityProviders: useSpot,
        });

        const taskExecutionRole = new iam.Role(this, 'RecipeTaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });

        const importedRecipeDatabaseName = Fn.importValue(`kitchensink-data-${baseStage}:RecipeDatabaseName`);
        const recipeDatabaseName = recipeDatabaseNameForStage(stage, baseStage, importedRecipeDatabaseName);

        const recipeDbEnvironment: Record<string, string> = {
            // recipe's config keys its environment on NODE_ENV (unlike food's STAGE): prod → 'production'
            // (which also disables the dev-auth bypass and forces exact-match azp); every non-prod deployed
            // stage → 'staging' so the per-PR azp PATTERN is permitted. RECIPE_DEV_AUTH_USER_ID is never set
            // here, so the dev bypass stays inert regardless. (Follow-up: consider aligning recipe's azp
            // gating to food's STAGE-based rule for cross-service consistency.)
            NODE_ENV: stage === 'prod' ? 'production' : 'staging',
            STAGE: stage,
            DB_HOST: database.dbInstanceEndpointAddress,
            DB_PORT: Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`),
            DB_NAME: recipeDatabaseName,
            // recipe_app authenticates via RDS IAM (no password) — see src/database/pool-config.ts.
            DB_USERNAME: 'recipe_app',
            S3_BUCKET_PHOTOS: photosBucket.bucketName,
            S3_BUCKET_VERSIONS: versionsBucket.bucketName,
            // No CloudFront distribution exists yet; a placeholder keeps config valid so the service boots
            // and serves recipe CRUD. Photo-via-CDN serving lands with a real distribution later.
            CLOUDFRONT_URL: cloudfrontUrl,
            // Clerk session-token verification (networkless; public key + azp allowlist from SSM at deploy).
            CLERK_JWT_KEY: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${baseStage}/clerk/jwt-public-key`,
            ),
        };

        if (props.foodServiceUrl !== undefined) {
            recipeDbEnvironment['FOOD_SERVICE_URL'] = props.foodServiceUrl;
        }

        // Stage-gated azp enforcement (ADR-0001), mirroring identity + food.
        if (baseStage === 'prod') {
            recipeDbEnvironment['CLERK_AUTHORIZED_PARTIES'] = ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/prod/clerk/authorized-parties`,
            );
        } else {
            recipeDbEnvironment['CLERK_AZP_PATTERN'] = ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/sandbox/clerk/azp-pattern`,
            );
            recipeDbEnvironment['CLERK_AZP_PREVIEW_MODE'] = ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/sandbox/clerk/azp-preview-mode`,
            );
            // Pattern mode rejects azp-less native (@clerk/expo) tokens unless the native-admission gate is
            // on. The mobile app calls the recipe service directly, so admit its `client_type: 'native'`
            // tokens. Prod stays list mode (skips the azp check on absent azp) → no flag, template unchanged.
            recipeDbEnvironment['CLERK_ADMIT_NATIVE_CLIENT'] = 'true';
        }

        // ── API service (ECS/Fargate behind the shared ALB) ─────────────────────────────────────
        const apiTaskRole = new iam.Role(this, 'RecipeApiTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for the recipe API',
        });
        database.grantConnect(apiTaskRole, 'recipe_app');
        photosBucket.grantReadWrite(apiTaskRole);
        versionsBucket.grantReadWrite(apiTaskRole);

        const apiTaskDefinition = new ecs.FargateTaskDefinition(this, 'RecipeApiTaskDefinition', {
            cpu: 512,
            memoryLimitMiB: 1024,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole: apiTaskRole,
        });

        const apiLogGroup = new logs.LogGroup(this, 'RecipeApiLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        apiTaskDefinition.addContainer('RecipeApiContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'recipe-service', logGroup: apiLogGroup }),
            environment: { ...recipeDbEnvironment, PORT: '3000' },
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

        const apiService = new ecs.FargateService(this, 'RecipeApiService', {
            cluster,
            taskDefinition: apiTaskDefinition,
            desiredCount,
            capacityProviderStrategies,
            // Public subnet + public IP so the task egresses to Clerk/AWS via the IGW (off the NAT path);
            // inbound stays locked to the ALB SG; intra-VPC reach to the private RDS by SG (ADR-0004).
            assignPublicIp: true,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [serviceSecurityGroup],
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(120),
            circuitBreaker: { rollback: true },
        });

        // ── In-VPC migration-runner Lambda (mirrors food FU-MIGRATE) ────────────────────────────
        // The RDS is PRIVATE_ISOLATED, so the deploy pipeline invokes this VPC-attached Lambda to apply the
        // ordered SQL against kitchensink_recipes. Asset bundled by esbuild.mjs to dist-lambda/; a bare
        // `cdk synth` (no bundle) falls back to an inline placeholder so synth never fails.
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);
        const migrationFn = new lambda.Function(this, 'RecipeMigrationFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            architecture: lambda.Architecture.ARM_64,
            handler: hasLambdaAsset ? 'lambdas/migrate/handler.handler' : 'index.handler',
            code: hasLambdaAsset
                ? lambda.Code.fromAsset(lambdaAssetDir)
                : lambda.Code.fromInline(
                      'export const handler = async () => ({ ok: false, reason: "asset-not-built" });',
                  ),
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: {
                STAGE: stage,
                DB_HOST: database.dbInstanceEndpointAddress,
                DB_PORT: Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`),
                DB_NAME: recipeDatabaseName,
                DB_USERNAME: 'recipe_app',
            },
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [serviceSecurityGroup],
        });
        database.grantConnect(migrationFn, 'recipe_app');

        // ── Shared ALB host-rule + DNS (mirrors identity/food) ──────────────────────────────────
        const subdomain = recipeSubdomainForStage(stage, baseStage);
        const serviceDomain = `${subdomain}.${domainName}`;

        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-domain-${baseStage}:HostedZoneId`),
            zoneName: domainName,
        });

        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'RecipeServiceSharedTargets', {
            vpc,
            port: 3000,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            targets: [apiService.loadBalancerTarget({ containerName: 'RecipeApiContainer', containerPort: 3000 })],
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

        // identity=100, food=200, recipe=300. A per-PR preview rides the SHARED sandbox listener, so it
        // MUST NOT reuse 300 — it allocates from the per-PR band (ADR-0006). Base stages keep 300.
        new elbv2.ApplicationListenerRule(this, 'RecipeServiceListenerRule', {
            listener: sharedHttpsListener,
            priority: recipeListenerPriorityForStage(stage, baseStage),
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

        new route53.ARecord(this, 'RecipeServiceAliasRecord', {
            zone: hostedZone,
            recordName: subdomain,
            target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(sharedAlb)),
        });

        this.serviceUrl = `https://${serviceDomain}`;

        // ── Outputs ─────────────────────────────────────────────────────────────────────────────
        new CfnOutput(this, 'RecipeServiceUrl', {
            value: this.serviceUrl,
            exportName: `${this.stackName}:RecipeServiceUrl`,
        });
        new CfnOutput(this, 'RecipeMigrationFunctionName', {
            value: migrationFn.functionName,
            exportName: `${this.stackName}:RecipeMigrationFunctionName`,
        });
    }
}
