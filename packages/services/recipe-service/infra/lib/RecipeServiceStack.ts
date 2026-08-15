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

import { listenerPriorityForStage } from '@kitchensink/infra-alb';
import { AcceptedNagFindings, NODE_LAMBDA_RUNTIME, acceptNagFindings } from '@kitchensink/infra-security';
import { recipeDatabaseNameForStage } from '@kitchensink/recipe-core/database-name';

/**
 * Resolve the recipe service's DNS label for a stage. prod → `recipe`; every other stage → `recipe-{stage}`
 * (a SINGLE label, so `*.commise.app` covers it — a 3-label `recipe.pr-7.commise.app` matches no wildcard
 * and fails the TLS handshake). Mirrors `foodSubdomainForStage`. Pure, total.
 *
 * There is deliberately NO way to produce a stage-qualified `recipe.{stage}` host. The recipe service has
 * exactly two shapes — the one persistent PRODUCTION deploy, and an ephemeral per-PR preview — so a
 * `recipe.{stage}` label has no referent, and this function takes no `baseStage` to compare against. Which
 * stages may be deployed at all is decided in `infra/bin/app.ts`, not here: that is a property of the deploy,
 * not of a DNS label.
 *
 * @param stage - The deploy stage.
 * @returns The subdomain label to prefix onto the apex domain.
 */
export function recipeSubdomainForStage(stage: string): string {
    return stage === 'prod' ? 'recipe' : `recipe-${stage}`;
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
    /**
     * CloudFront distribution id, for invalidations on photo delete + GDPR erasure (HAZ-051/067/039).
     * OPTIONAL — no `Distribution` construct exists in this repo's CDK (see `cloudfrontUrl` above); a
     * stage without one yet passes nothing through, and the service degrades to a logged no-op rather
     * than failing to boot. Contrast `foodServiceUrl` below, which is REQUIRED.
     */
    readonly cloudfrontDistributionId?: string;
    /**
     * The food service (003) origin the ingredients vertical reads nutrition and catalog suggestions from.
     *
     * **REQUIRED (issue #120).** It was optional, and passed through behind an `if (… !== undefined)` fed by
     * `RECIPE_FOOD_SERVICE_URL` — a variable no workflow ever set. The live pr-73 task definition therefore
     * carried no `FOOD_*` variables at all and the service fell back to an in-code `http://localhost:3002`,
     * i.e. the container itself on food's port: every cross-service call was connection-refused, silently,
     * because `FoodCatalogGateway` is a total function. Required-and-validated means a deploy that has not
     * been told where food lives fails at synth, not in production.
     */
    readonly foodServiceUrl: string;
}

/**
 * Assert `foodServiceUrl` is an absolute http(s) origin, or throw naming the deploy variable that supplies it.
 *
 * The value is written verbatim into the task definition, so a blank (an unset workflow step output) or a bare
 * host would otherwise surface minutes later as crash-looping tasks and a rollback, with the actual cause
 * three layers down. Pure.
 *
 * @param foodServiceUrl - The candidate origin.
 * @throws {Error} When it is blank, relative, or not http(s).
 */
export function assertFoodServiceUrl(foodServiceUrl: string): void {
    let parsed: URL;

    try {
        parsed = new URL(foodServiceUrl);
    } catch {
        throw new Error(
            `RECIPE_FOOD_SERVICE_URL must be an absolute http(s) origin (e.g. https://food-pr-7.commise.app); got '${foodServiceUrl}'`,
        );
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`RECIPE_FOOD_SERVICE_URL must use http(s); got '${foodServiceUrl}'`);
    }
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

        const { stage, imageTag, desiredCount, vpcId, domainName, cloudfrontUrl, foodServiceUrl } = props;
        const baseStage = props.baseStage ?? stage;

        // Fail at synth, in the deploy log, rather than as crash-looping tasks minutes later.
        assertFoodServiceUrl(foodServiceUrl);

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
            // recipe_app authenticates via RDS IAM (no password) — see src/database/poolConfig.ts.
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
            // CR-002 / U4a — the PUBLIC EdDSA verification key for the internal service-principal erasure
            // route (`ServiceErasureAuthService`, `POST /api/v1/internal/account/erasure`). Non-secret, resolved
            // from SSM at deploy (same wiring as CLERK_JWT_KEY above); the matching PRIVATE key is held only
            // by the identity deletion-worker / erasure-reconciliation Lambdas. Absent ⇒ the internal route
            // fails closed (401), never open. Per-stage keypair (a pr-{N} preview shares the sandbox key via
            // baseStage), matching food-service's identical wiring for its own leg of the fan-out.
            RECIPE_SERVICE_PRINCIPAL_JWT_KEY: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${baseStage}/recipe/service-principal-jwt-public-key`,
            ),
            // The account-erasure queue the recipe-workers stack owns (T136b). REQUIRED — ErasureService
            // refuses to boot without it, so a stage wired with no queue fails the deploy loudly instead of
            // degrading every "erase my data" request to a silent cron-tick wait. Read from SSM, NOT a
            // cross-stack export: an `Fn.importValue` would lock the workers export while this stack imports
            // it, and the ADR-0005 PR-close cleanup deletes a PR's stacks in no fixed order — workers-first
            // would hit the export-in-use deadlock ADR-0002 documents, unattended, in CI.
            //
            // Keyed on `stage`, NOT `baseStage` (unlike the VPC/ALB/RDS platform imports above): the queue
            // is the feature deploy's OWN resource, so a pr-{N} service must enqueue onto the pr-{N} queue.
            // Its worker points at the pr-{N} logical DB (ADR-0006); draining a sandbox erasure there would
            // erase an owner out of the WRONG database while the real sandbox job stayed queued.
            ACCOUNT_ERASURE_QUEUE_URL: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${stage}/recipe/account-erasure-queue-url`,
            ),
            // The food service (003) this stage's ingredients vertical reads through (issue #120).
            // UNCONDITIONAL: the service's config requires it, so an absent value is a boot failure, and the
            // previous conditional passthrough is precisely how the live task ended up with no food origin at
            // all. Keyed on the DEPLOY stage by the caller (a pr-{N} recipe must read the pr-{N} food service,
            // not a shared one), and there is no service token to inject — recipe forwards the CALLER's own
            // Clerk bearer (see `src/ingredients/FoodServiceClients.factory.ts`).
            FOOD_SERVICE_URL: foodServiceUrl,
        };

        if (props.cloudfrontDistributionId !== undefined) {
            recipeDbEnvironment['CLOUDFRONT_DISTRIBUTION_ID'] = props.cloudfrontDistributionId;
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

        // sqs:SendMessage on the erasure queue, and NOTHING more (ARCH-IT-7): the API produces erasure
        // work, only the worker consumes it — a task role that could receive/delete could drain a
        // right-to-erasure request without performing it. The ARN comes from the same per-stage SSM
        // parameter the URL does (published by recipe-workers), so the grant is scoped to exactly this
        // stage's queue with no cross-stack export lock.
        apiTaskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['sqs:SendMessage'],
                resources: [
                    ssm.StringParameter.valueForStringParameter(
                        this,
                        `/kitchensink/${stage}/recipe/account-erasure-queue-arn`,
                    ),
                ],
            }),
        );

        // HAZ-051/067/039: least-privilege grant for photo-delete's CDN-invalidation call, scoped to the
        // ONE configured distribution — never a wildcard resource. No-op (no grant added) when
        // `cloudfrontDistributionId` is unset, matching the service's own CDN adapter degrading to a no-op
        // in that case (`photos/cdnInvalidation.ts`) — there is nothing to scope a grant to.
        if (props.cloudfrontDistributionId !== undefined) {
            apiTaskRole.addToPolicy(
                new iam.PolicyStatement({
                    actions: ['cloudfront:CreateInvalidation'],
                    resources: [`arn:aws:cloudfront::${this.account}:distribution/${props.cloudfrontDistributionId}`],
                }),
            );
        }

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

        // AwsSolutions-ECS2 accepted: every plaintext container Environment entry here is non-secret, and
        // every real secret is injected via ecs.Secret.fromSecretsManager (i.e. under Secrets, not
        // Environment). Justification -- including the invariant it depends on -- in
        // @kitchensink/infra-security.
        acceptNagFindings(apiTaskDefinition, AcceptedNagFindings.TASK_ENVIRONMENT_HOLDS_NO_SECRET);

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
            runtime: NODE_LAMBDA_RUNTIME,
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
        const subdomain = recipeSubdomainForStage(stage);
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

        // Allocated by @kitchensink/infra-alb, never restated here. This stack's own copy of the scheme is
        // exactly what drifted: its docstring described FOOD's bands, which if followed put recipe-pr-{N} on
        // food-pr-{N} and failed every per-PR deploy with `Priority '10073' is currently in use` (ADR-0003).
        // A base stage keeps recipe's fixed 300 (no prod diff); a per-PR preview takes recipe's own band.
        new elbv2.ApplicationListenerRule(this, 'RecipeServiceListenerRule', {
            listener: sharedHttpsListener,
            priority: listenerPriorityForStage({ service: 'recipe', stage, baseStage }),
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
