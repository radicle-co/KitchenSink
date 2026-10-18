import {
    CfnOutput,
    Duration,
    Fn,
    RemovalPolicy,
    Stack,
    Token,
    type StackProps,
    aws_ec2 as ec2,
    aws_ecr as ecr,
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elbv2,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_logs as logs,
    aws_logs_destinations as logsDestinations,
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
} from '@radicle-co/infra-shared/alb';
import {
    AcceptedNagFindings,
    acceptNagFindings,
    clerkAuthEnvironment,
    CONTAINER_INSIGHTS_TIER,
    schemaCurrencyEnvironment,
} from '@radicle-co/infra-shared/security';
import { recipeDatabaseNameParameter } from '@radicle-co/infra-shared/database';
import { RECIPE_QUEUE_KINDS, recipeQueueArn, recipeQueueUrl } from '@kitchensink/recipe-core/queue-names';
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

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
    // Delegated to the SHARED authority (plan U18) — see `@radicle-co/infra-shared/alb`'s publicOriginHost.
    return publicSubdomainForStage('recipe', stage);
}

/**
 * The stages on which test-principal containment is switched OFF (ADR-0040): the shared sandbox and `pr-{N}` previews.
 *
 * An ALLOWLIST, not "every stage but prod", for the reason `AuthMiddleware`'s dev bypass records: a negative gate has
 * to predict every stage name that will ever exist, and a stage added later would opt itself OUT of containment by
 * being spelled something new. Pure.
 *
 * @param stage - The deploy stage.
 * @returns `{ TEST_PRINCIPAL_CONTAINMENT: 'off' }` for sandbox and `pr-{N}`, otherwise nothing.
 */
export function testPrincipalContainmentEnvironment(stage: string): Record<string, string> {
    return stage === 'sandbox' || /^pr-\d+$/u.test(stage) ? { TEST_PRINCIPAL_CONTAINMENT: 'off' } : {};
}

/** Props for {@link RecipeServiceStack}. */
export interface RecipeServiceStackProps extends StackProps {
    /**
     * The log forwarder's ARN, resolved in CI. Absent means no subscription filter is attached —
     * see the drain comment in the body for the deadlock that makes absence a supported state (ADR-0042).
     */
    readonly logForwarderArn?: string;

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

        const { stage, imageTag, desiredCount, vpcId, domainName, foodServiceUrl } = props;
        const baseStage = props.baseStage ?? stage;
        // ADR-0064: the media CDN. Prod reads its own tree; every other stage (`pr-{N}` included) the shared sandbox one.
        const mediaTree = `/kitchensink/${baseStage === 'prod' ? 'prod' : 'sandbox'}/media`;
        const mediaCdnUrl = ssm.StringParameter.valueForStringParameter(this, `${mediaTree}/cdn-url`);
        const mediaDistributionId = ssm.StringParameter.valueForStringParameter(this, `${mediaTree}/distribution-id`);

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
            port: Token.asNumber(Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`)),
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

        // ⛔ READ, NEVER RE-DERIVED. `RecipeSchemaStack` creates this database and publishes the name it
        // used; deriving it again here means passing `recipeDatabaseNameForStage` a second set of arguments
        // and hoping they match. They did not: #119 put this task on `kitchensink_recipes_pr_73` while the
        // workers ran against the shared sandbox database. ADR-0035 deploys the schema stack first, so the
        // parameter exists by the time this resolves.
        const recipeDatabaseName = ssm.StringParameter.valueForStringParameter(
            this,
            recipeDatabaseNameParameter(stage),
        );

        // ── Sentry (plan U17/U22) ──
        //
        // ⛔ Per-STAGE parameter at the BASE stage: a `pr-{N}` preview has no Sentry project of its own and
        // resolves sandbox's, separating itself by the `environment` tag. That is what keeps previews from
        // costing a project each.
        //
        // ⚠️ `STAGE` is set alongside the DSN even though this service keys its own config on `NODE_ENV`
        // (see below): Sentry's `environment` must be the DEPLOY stage, or every preview reports as
        // `staging` and is indistinguishable from sandbox — the same defect U19 fixed on the web side.
        const sentryEnvironment: Record<string, string> = {
            STAGE: stage,
            SENTRY_DSN: ssm.StringParameter.valueForStringParameter(
                this,
                `/kitchensink/${baseStage}/sentry/recipe-service-dsn`,
            ),
            SENTRY_TRACES_SAMPLE_RATE: stage === 'prod' ? '0.1' : '1.0',
            SENTRY_RELEASE: process.env['SENTRY_RELEASE'] ?? stage,
        };

        const recipeDbEnvironment: Record<string, string> = {
            ...sentryEnvironment,
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
            // ⛔ ADR-0040 — test-principal containment (owner ruling 2026-09-13): OFF only on the shared sandbox and on
            // every `pr-{N}` preview, where every row is non-production and the co-author / clone / rating flows need
            // a test principal's writes. Prod — and any stage not named here — is LEFT UNSET on purpose: the service
            // parses an unset value to `enforce`, so the fail-closed default needs no line, and prod's template does
            // not move. Guarded per stage by `RecipeServiceStack.test.ts`.
            ...testPrincipalContainmentEnvironment(stage),
            DB_HOST: database.dbInstanceEndpointAddress,
            DB_PORT: Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`),
            DB_NAME: recipeDatabaseName,
            // recipe_app authenticates via RDS IAM (no password) — see src/database/poolConfig.ts.
            DB_USERNAME: DATABASE_ROLES.recipe.app,
            S3_BUCKET_PHOTOS: photosBucket.bucketName,
            S3_BUCKET_VERSIONS: versionsBucket.bucketName,
            // ADR-0064: the media CDN and its distribution, published by the global app under
            // `/kitchensink/{baseStage}/media/` and resolved by CloudFormation at DEPLOY time. Never a template string
            // and never an export (which would lock the distribution against replacement). The service REFUSES to
            // boot without either, so a stage the global app has not deployed fails loudly instead of serving photo
            // URLs that do not resolve.
            MEDIA_CDN_URL: mediaCdnUrl,
            MEDIA_DISTRIBUTION_ID: mediaDistributionId,
            // ⛔ Clerk auth env — the ONE definition lives in `@radicle-co/infra-shared/security`
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
            // The three queues the recipe-workers stack owns, DERIVED rather than read (ADR-0036). Each URL is a
            // pure function of the deploy stage, region and account (`recipeQueueUrl`), and the workers stack
            // names its queues with the same module, so the two cannot disagree. They used to be SSM parameters
            // the workers stack published, resolved at deploy time - which made this stack's deploy wait for the
            // workers' deploy, an ordering CloudFormation could not see. `ecosystem-smoke` is now what asserts
            // each derived queue EXISTS and that the running task is configured with it, so a stage wired with no
            // queue still fails loudly, one job later; and every consumer of these values (`ErasureService` and
            // the two job queues' configs) still refuses to boot on a missing or malformed URL.
            //
            // The DEPLOY stage, NOT `baseStage` (unlike the VPC/ALB/RDS platform imports above): the queue is
            // the feature deploy's OWN resource, so a pr-{N} service enqueues onto the pr-{N} queue. Its worker
            // points at the pr-{N} logical DB (ADR-0006); draining a sandbox erasure there would erase an owner
            // out of the WRONG database while the real sandbox job stayed queued, and ADR-0024's spend counter
            // lives in that same database.
            ACCOUNT_ERASURE_QUEUE_URL: recipeQueueUrl('accountErasure', stage, this.region, this.account),
            INGREDIENT_VERIFICATION_QUEUE_URL: recipeQueueUrl(
                'ingredientVerification',
                stage,
                this.region,
                this.account,
            ),
            RECIPE_PARSE_QUEUE_URL: recipeQueueUrl('parse', stage, this.region, this.account),
            // The food service (003) this stage's ingredients vertical reads through (issue #120).
            // UNCONDITIONAL: the service's config requires it, so an absent value is a boot failure, and the
            // previous conditional passthrough is precisely how the live task ended up with no food origin at
            // all. Keyed on the DEPLOY stage by the caller (a pr-{N} recipe must read the pr-{N} food service,
            // not a shared one), and there is no service token to inject — recipe forwards the CALLER's own
            // Clerk bearer (see `src/ingredients/FoodServiceClients.factory.ts`).
            FOOD_SERVICE_URL: foodServiceUrl,
        };

        // ── API service (ECS/Fargate behind the shared ALB) ─────────────────────────────────────
        const apiTaskRole = new iam.Role(this, 'RecipeApiTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for the recipe API',
        });
        database.grantConnect(apiTaskRole, DATABASE_ROLES.recipe.app);
        photosBucket.grantReadWrite(apiTaskRole);
        versionsBucket.grantReadWrite(apiTaskRole);

        // sqs:SendMessage on each queue the API produces onto, and NOTHING more (ARCH-IT-7, ADR-0024 layer 4b,
        // plan U9/U11). One statement PER QUEUE, so each grant reads as "this role may send to exactly this
        // queue" and removing one cannot silently widen another. The ARNs are derived (`recipeQueueArn`), the
        // same module that names the queues.
        //
        // ⛔ Send only. The API PRODUCES erasure, verification and parse work; the workers are the sole
        // consumers, and the verification and parse Lambdas share the single `bedrock:InvokeModel` grant. A
        // task role that could receive here could drain a right-to-erasure request without performing it, or
        // drain verification and parse work without paying for it through the gated path.
        for (const kind of RECIPE_QUEUE_KINDS) {
            apiTaskRole.addToPolicy(
                new iam.PolicyStatement({
                    actions: ['sqs:SendMessage'],
                    resources: [recipeQueueArn(kind, stage, this.region, this.account)],
                }),
            );
        }

        // HAZ-051/067/039: least-privilege grant for photo-delete's CDN-invalidation call, scoped to the ONE media
        // distribution - never a wildcard resource. Unconditional: the distribution always exists once the global
        // app is deployed (ADR-0064), and the service refuses to boot without its id.
        apiTaskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['cloudfront:CreateInvalidation'],
                resources: [`arn:aws:cloudfront::${this.account}:distribution/${mediaDistributionId}`],
            }),
        );

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
        // @radicle-co/infra-shared/security.
        acceptNagFindings(apiTaskDefinition, AcceptedNagFindings.TASK_ENVIRONMENT_HOLDS_NO_SECRET);

        // ⚠️ Deleted with its stack outside production (ADR-0061): the midnight reclaim deletes this stack and
        // Sandbox Up rebuilds it, so a retained group would leak (or, when named, fail the rebuild with AlreadyExists).
        const apiLogGroup = new logs.LogGroup(this, 'RecipeApiLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        });

        // ── Drain this group to Sentry (plan U15, ADR-0042) ──
        //
        // ⛔ THE FILTER LIVES HERE, in the stack that OWNS the group, because a subscription filter is a
        // property of the group: attaching from elsewhere means importing another stack's resource, which is
        // how `WebhooksStack` once pinned a reclaimable stack and blocked its deletion. So the forwarder's
        // ARN travels instead of the group.
        //
        // ⚠️ `addPermissions: false` — the `lambda:InvokeFunction` grant for `logs.amazonaws.com` is made
        // ONCE in `WebhooksStack`, scoped by `sourceAccount`. An imported function cannot carry a resource
        // policy from here anyway, so asking CDK to add one would be a silent no-op rather than a second
        // grant.
        //
        // ⚠️ The filter pattern excludes Lambda platform lines and EMF metric payloads, matching the webhook
        // stack's own filters — an EMF line forwarded as a log is a metric turned into noise.
        //
        // ⛔ ONLY WHEN THE ARN IS KNOWN. `Fn.importValue` on the webhooks app's export made this stack wait
        // for a stack the same pipeline deploys LATER, which is a deadlock rather than a race: a sandbox
        // deploy died in `UPDATE_ROLLBACK_IN_PROGRESS` with "No export named
        // kitchensink-identity-webhooks-sandbox:LogForwarderArn found". The ARN now arrives as a CI-resolved
        // input, the same form `DataStack` and `SandboxSchedulerStack` already take it in.
        //
        // ⚠️ ABSENT IS A SUPPORTED STATE, not a failure: a fresh account has no forwarder to point at, and
        // a hard failure here would leave it with no way to bootstrap. The filter attaches on the next
        // deploy of this app — ADR-0042 records the convergence window as a residual.
        const logForwarder =
            props.logForwarderArn === undefined
                ? undefined
                : lambda.Function.fromFunctionArn(this, 'ImportedLogForwarder', props.logForwarderArn);

        if (logForwarder !== undefined) {
            new logs.SubscriptionFilter(this, 'RecipeApiLogDrain', {
                logGroup: apiLogGroup,
                destination: new logsDestinations.LambdaDestination(logForwarder, { addPermissions: false }),
                filterPattern: logs.FilterPattern.literal('-START -END -REPORT -"_aws"'),
                filterName: 'forward-app-logs',
            });
        }

        apiTaskDefinition.addContainer('RecipeApiContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'recipe-service', logGroup: apiLogGroup }),
            environment: { ...recipeDbEnvironment, PORT: '3000' },
            // ⛔ `--import` MUST BE HERE AND NOT ONLY IN THE DOCKERFILE. An ECS container `command` OVERRIDES
            // the image's `CMD`, so this line silently discarded the Dockerfile's `--import
            // ./dist/src/instrument.js` and `Sentry.init` never ran in the deployed API — no issues, no
            // traces, and U17's `Sentry.captureException` in `ApiExceptionFilter` was a no-op in prod and in
            // every sandbox. Nothing failed: the template synthesized, the task started and the health check
            // passed. `serviceInfraWiringInvariants.test.ts` W6 now asserts both this line and the `CMD`.
            command: ['node', '--import', './dist/src/instrument.js', 'dist/src/main.js'],
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
        // @radicle-co/infra-shared/alb, never spelled here: the rule condition below, the A-record below, and
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

        // Allocated by @radicle-co/infra-shared/alb, never restated here. This stack's own copy of the scheme is
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
