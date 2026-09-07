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
    aws_logs as logs,
    aws_rds as rds,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
    aws_ssm as ssm,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import {
    publicSubdomainForStage,
    cutOverServicesFromEnv,
    edgeOriginHeaderFor,
    internalOriginForStage,
    listenerPriorityForStage,
    publicRecordOwnerFor,
} from '@kitchensink/infra-alb';
import {
    AcceptedNagFindings,
    acceptNagFindings,
    clerkAuthEnvironment,
    CONTAINER_INSIGHTS_TIER,
    schemaCurrencyEnvironment,
} from '@kitchensink/infra-security';
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
    // Delegated to the SHARED authority (plan U18) — see `@kitchensink/infra-alb`'s publicOriginHost.
    return publicSubdomainForStage('recipe', stage);
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
            // Per-stage observability depth (ADR-0007, amended 2026-08-27). ONE resolver shared by all three
            // service stacks — prod and named non-prod run the STANDARD tier, `pr-{N}` runs none, and NO stage
            // resolves to ENHANCED any more. ENHANCED's unbounded `TaskId` dimension was 81% of a $155/mo
            // CloudWatch bill; see containerInsights.ts for the measurement.
            containerInsightsV2: CONTAINER_INSIGHTS_TIER,
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
            // ⛔ The boot-time schema-currency check's mode (ADR-0035). Ships as `warn`, where it reports and
            // lets the task serve; `enforce` refuses a boot against a database behind this release. The flip
            // is a DEPLOY-TIME setting rather than a code change, so the soak has an ending somebody will
            // actually reach for — and an unset or unrecognised value normalises to `warn` at synth, so a
            // typo cannot arm a check that can crash-loop a service.
            ...schemaCurrencyEnvironment(process.env),
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
            // ⛔ Clerk auth env — the ONE definition lives in `@kitchensink/infra-security`
            // (`clerkAuthEnvironment`): the JWT public key, EXACTLY ONE azp mode (prod = exact-match list,
            // non-prod = anchored preview pattern + preview mode), and the every-stage native-admission gate.
            // Extracted 2026-09-02 after this same rule, written by hand in three stacks, had to be corrected
            // in three places — the shape that already cost this repo the ALB priority collision.
            ...clerkAuthEnvironment(this, baseStage),
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
            // ⛔ THE VERIFICATION GATE'S QUEUE (plan U11 / ADR-0024), and the reason this line exists at all:
            // U11 shipped the gate's CONSUMER complete — a Lambda, its queue and DLQ, its `bedrock:InvokeModel`
            // grant, its EMF alarms and its spend ledger — and `RecipeWorkersStack` published this very
            // parameter under the comment "cross-stack hand-off to recipe-service's PRODUCER". Nothing read
            // it. The gate ran, alarmed and verified nothing, behind a fully green repository.
            //
            // UNCONDITIONAL, like FOOD_SERVICE_URL below and for the same reason: `ingredientVerificationConfigSchema`
            // requires it, so a stage wired without a queue fails the DEPLOY instead of silently asking nobody.
            //
            // Keyed on `stage`, NOT `baseStage`: a pr-{N} preview must enqueue onto the pr-{N} queue, whose
            // worker points at the pr-{N} logical database (ADR-0006) — and ADR-0024's spend counter lives in
            // THAT database, so a message crossing stages would be judged against, and billed against, the
            // wrong stage's ceiling.
            INGREDIENT_VERIFICATION_QUEUE_URL: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${stage}/recipe/verification-queue-url`,
            ),
            // THE PARSE-JOB QUEUE (plan U9) — same discovery path, same rules as the verification queue
            // above: UNCONDITIONAL because `parseJobConfigSchema` requires it (a stage wired without the
            // queue fails the DEPLOY, not silently a poll that never completes), and keyed on `stage`
            // because a pr-{N} preview's parse rows and spend belong to the pr-{N} database (ADR-0006).
            RECIPE_PARSE_QUEUE_URL: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${stage}/recipe/parse-queue-url`,
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

        // sqs:SendMessage on the VERIFICATION queue, and nothing more (plan U11 / ADR-0024). A SEPARATE
        // statement rather than a second resource on the one above, so each grant stays readable as "this
        // role may send to exactly this queue" — and so removing one queue cannot silently widen the other.
        //
        // ⛔ Send only. The API PRODUCES verification work; the gate Lambda is the sole consumer, and it is
        // also ADR-0024 layer 4b's single `bedrock:InvokeModel` grantee. A task role that could receive here
        // could drain requests without verifying them, which would look exactly like a healthy quiet queue.
        apiTaskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['sqs:SendMessage'],
                resources: [
                    ssm.StringParameter.valueForStringParameter(
                        this,
                        `/kitchensink/${stage}/recipe/verification-queue-arn`,
                    ),
                ],
            }),
        );

        // sqs:SendMessage on the PARSE queue, and nothing more (plan U9). Its own statement for the same
        // reason as the two above. ⛔ Send only: the parse Lambda is the sole consumer AND shares the
        // verification role's single `bedrock:InvokeModel` grant (ADR-0024 layer 4b) — a task role that
        // could receive here could drain parse work without paying for it through the gated path.
        apiTaskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['sqs:SendMessage'],
                resources: [
                    ssm.StringParameter.valueForStringParameter(this, `/kitchensink/${stage}/recipe/parse-queue-arn`),
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

        // ⛔ THE MIGRATION RUNNER AND ITS TRIGGER USED TO SIT HERE, and their absence is the decision.
        //
        // ADR-0022 put the schema apply inside this deploy because CloudFormation's `DependsOn` cannot leave
        // a stack. For recipe that cost TWO runners for ONE database: this one, and a SECOND copy of the
        // same bundle in `RecipeWorkersStack` — a different CDK app, deployed first — purely so its eight
        // DB-touching Lambdas could be ordered behind something. Neither barrier could ever reach the other
        // stack's consumers.
        //
        // The runner now lives in `kitchensink-recipe-schema-{stage}` (`RecipeSchemaStack`), deployed and
        // invoked by its own pipeline step ahead of BOTH. That is strictly more coverage than two in-stack
        // barriers gave, because one runner ahead of everything orders every consumer regardless of which
        // app or stack it lives in.
        //
        // ⚠️ EXPAND-FIRST STILL BINDS, and is now the whole of the contracting rule.
        // `0019_drop_duplicated_nutrition.sql` drops seven columns and its header states, correctly for the
        // order in force when it was written, "Production deploys CODE BEFORE MIGRATING". That has not been
        // true since ADR-0022 and is not true now: a destructive migration ships in a LATER release than the
        // code that stopped reading the column, never the same one. 0019 is already applied in production,
        // so nothing about it changes; the discipline for the next one does.

        // ── Shared ALB host-rule + DNS (mirrors identity/food) ──────────────────────────────────
        const subdomain = recipeSubdomainForStage(stage);
        const serviceDomain = `${subdomain}.${domainName}`;

        // ADR-0020 / plan U15 — the origin host the CloudFront distribution will dial in U16. Resolved by
        // @kitchensink/infra-alb, never spelled here: the rule condition below, the A-record below, and
        // EdgeStack's origin must be the SAME string, and nothing at synth checks that they are. `undefined`
        // outside prod is the normal case (only prod has a distribution, and only prod's DomainStack mints
        // the `*.internal` certificate that can terminate the name).
        const internalOrigin = internalOriginForStage({ service: 'recipe', stage, domainName });

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
        // The internal origin is a SECOND HOST ON THIS RULE, never a second rule: priority is a namespace
        // shared across independently-deployed stacks, so a second rule would have to claim one and the
        // deploy would fail with `Priority 'N' is currently in use` (ADR-0003). Public host stays FIRST and
        // keeps serving — U15 adds a door, U17 is what closes the old one.
        // U17 closes it. Once recipe is named in `EDGE_CUTOVER_SERVICES`, EdgeStack owns the public record
        // (aliased to the distribution) and this rule stops answering on the public host, so the ALB is
        // reachable only at the origin name CloudFront dials. Both halves move together — see the resolver
        // for why keeping one without the other is the actual failure.
        const publicRecordOwner = publicRecordOwnerFor({
            service: 'recipe',
            stage,
            cutOverServices: cutOverServicesFromEnv(process.env),
        });

        // `publicRecordOwnerFor` returns `edge` only on prod, which is exactly where `internalOrigin` is
        // defined — but that agreement lives in two modules, so the fallback is real rather than a cast: an
        // empty host list is a synth-time CDK error, which is the right way to find out they disagreed.
        const ruleHosts =
            publicRecordOwner === 'edge' && internalOrigin !== undefined
                ? [internalOrigin.host]
                : [serviceDomain, ...(internalOrigin === undefined ? [] : [internalOrigin.host])];

        // ADR-0020 trap 5 — the secret origin header, which is the boundary the prefix-list restriction is
        // NOT. That restriction admits CloudFront, not OURS: `recipe.internal.{apex}` is published in the
        // public zone, so anyone may point their own distribution at it and reach this target group with
        // the edge verifier out of the path. Prod only, and `undefined` everywhere else — a preview whose
        // rule demanded a header nothing sends would answer ADR-0003's default 404 to every request.
        //
        // ⛔ DEPLOY ORDER, and it does not commute: `EdgeStack` must be sending the header BEFORE this
        // condition exists, or production traffic 404s. See ADR-0020's U17 correction.
        const originHeader = edgeOriginHeaderFor(stage);

        new elbv2.ApplicationListenerRule(this, 'RecipeServiceListenerRule', {
            listener: sharedHttpsListener,
            priority: listenerPriorityForStage({ service: 'recipe', stage, baseStage }),
            // ⛔ An additional condition on THIS rule, never a second rule. Conditions are ANDed, whereas a
            // second rule would have to claim its own priority on a namespace shared across independently
            // deployed stacks and fail with `Priority 'N' is currently in use` (ADR-0003). ALB allows five.
            conditions: [
                elbv2.ListenerCondition.hostHeaders(ruleHosts),
                ...(originHeader === undefined
                    ? []
                    : [elbv2.ListenerCondition.httpHeader(originHeader.headerName, [originHeader.value])]),
            ],
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

        // Released to EdgeStack at cutover (U17), never deleted outright: Route 53 refuses a duplicate, so
        // the two stacks cannot both hold it, and whichever holds it is the one that must publish it.
        if (publicRecordOwner === 'service') {
            new route53.ARecord(this, 'RecipeServiceAliasRecord', {
                zone: hostedZone,
                recordName: subdomain,
                target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(sharedAlb)),
            });
        }

        // Prod only (ADR-0020 / U15). Same ALB, second name: the distribution origins at this record, and
        // the listener rule above already matches the host it resolves to.
        if (internalOrigin !== undefined) {
            new route53.ARecord(this, 'RecipeServiceInternalAliasRecord', {
                zone: hostedZone,
                recordName: internalOrigin.recordName,
                target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(sharedAlb)),
            });
        }

        this.serviceUrl = `https://${serviceDomain}`;

        // ── Outputs ─────────────────────────────────────────────────────────────────────────────
        new CfnOutput(this, 'RecipeServiceUrl', {
            value: this.serviceUrl,
            exportName: `${this.stackName}:RecipeServiceUrl`,
        });
    }
}
