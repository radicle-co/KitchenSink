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
    aws_iam as iam,
    aws_lambda as lambda,
    aws_logs as logs,
    aws_rds as rds,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
    aws_sns as sns,
    aws_sqs as sqs,
    aws_ssm as ssm,
    triggers,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import {
    BASE_LISTENER_PRIORITY,
    cutOverServicesFromEnv,
    edgeOriginHeaderFor,
    internalOriginForStage,
    publicRecordOwnerFor,
} from '@kitchensink/infra-alb';
import {
    AcceptedNagFindings,
    NODE_LAMBDA_RUNTIME,
    acceptNagFindings,
    subscribeAlarmEmail,
} from '@kitchensink/infra-security';

export interface IdentityServiceStackProps extends StackProps {
    /**
     * Email that receives this stack's alarms (R3.2 / plan U11). Supplied per-stage from
     * `COST_ALERT_EMAIL` / the `costAlertEmail` context in `infra/bin/app.ts`; when omitted the topic is
     * created with NO subscription, so no address is ever baked into a committed template (this repo is
     * public).
     */
    readonly alertEmail?: string;

    readonly stage: string;
    readonly domainName: string;
    readonly imageTag: string;
    readonly desiredCount: number;
    readonly vpcId: string;
}

/**
 * @implements REQ-018..REQ-026 REQ-032..REQ-038 REQ-050 FR-018..FR-026 FR-032..FR-038 FR-041..FR-044 ARCH-014..ARCH-019 ARCH-032 MOD-014..MOD-019 MOD-032
 */
export class IdentityServiceStack extends Stack {
    public readonly serviceUrl: string;

    public constructor(scope: Construct, id: string, props: IdentityServiceStackProps) {
        super(scope, id, props);

        const { stage, imageTag, desiredCount, vpcId, domainName } = props;

        // Fargate Spot for non-prod (ADR-0008). Prod runs on-demand `FARGATE` (unchanged → no prod
        // diff); every non-prod stage (sandbox) runs interruption-tolerant `FARGATE_SPOT`. The cluster
        // must advertise the FARGATE_SPOT capacity provider before a service strategy can bind to it,
        // so the cluster flag and the service strategy are gated together on the same stage check.
        const useSpot = stage !== 'prod';
        const capacityProviderStrategies = useSpot ? [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }] : undefined;

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
            vpcId,
        });

        const albSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedAlbSg',
            Fn.importValue(`kitchensink-network-${stage}:AlbSecurityGroupId`),
        );

        const serviceSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedServiceSg',
            Fn.importValue(`kitchensink-network-${stage}:ServiceSecurityGroupId`),
        );

        // The DB-bound in-VPC Lambda SG. The migration runner below uses THIS group, not the ECS task
        // group, because it is the exact group the runner already had while it lived in the webhooks
        // stack — so the move changes where the function is declared and nothing about what it can reach
        // (PostgreSQL 5432 to the database SG, 443 out for Secrets Manager via the NAT). Both groups are
        // `allowAllOutbound: false`, so this is not interchangeable by inspection: swapping it would be a
        // reachability change, and the failure mode is a deploy that hangs on a connection timeout.
        const lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedLambdaSg',
            Fn.importValue(`kitchensink-network-${stage}:LambdaSecurityGroupId`),
        );

        const dbCredentialsSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedDbSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${stage}:DatabaseSecretArn`),
        });

        // The data stack imports this secret by NAME (`fromSecretNameV2`) and exports its name-based,
        // suffix-LESS ARN — unlike the DB/migration secrets, which are CDK-created and export the full
        // ARN with the random `-XXXXXX` suffix. Import it as a PARTIAL ARN so `grantRead` (and the ecs
        // `Secret.fromSecretsManager` execution-role grant) append the `-??????` wildcard. A
        // `secretCompleteArn` here writes an exact policy for the suffix-less ARN, which never matches
        // the secret's real ARN — so the task can't fetch it, the container never starts, and every
        // deploy hangs on ECS "NotStabilized" then rolls back.
        const authSecretKey = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedAuthSecret', {
            secretPartialArn: Fn.importValue(`kitchensink-data-${stage}:SecretArn`),
        });

        const migrationPlanSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedMigrationSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${stage}:MigrationPlanSecretArn`),
        });

        const database = rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedDatabase', {
            instanceIdentifier: `kitchensink-identity-${stage}`,
            instanceEndpointAddress: Fn.importValue(`kitchensink-data-${stage}:DatabaseEndpoint`),
            port: Number(Fn.importValue(`kitchensink-data-${stage}:DatabasePort`)),
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(
                    this,
                    'ImportedDbSg',
                    Fn.importValue(`kitchensink-network-${stage}:DatabaseSecurityGroupId`),
                ),
            ],
        });

        const deletionQueue = sqs.Queue.fromQueueArn(
            this,
            'ImportedDeletionQueue',
            Fn.importValue(`kitchensink-data-${stage}:DeletionQueueArn`),
        );

        // The global handle-sync topic (W8-a.2): identity publishes a rename here on PATCH /api/v1/users/me.
        const handleSyncTopic = sns.Topic.fromTopicArn(
            this,
            'ImportedHandleSyncTopic',
            Fn.importValue(`kitchensink-data-${stage}:HandleSyncTopicArn`),
        );

        const mediaBucket = s3.Bucket.fromBucketName(
            this,
            'ImportedMediaBucket',
            Fn.importValue(`kitchensink-data-${stage}:MediaBucketName`),
        );

        const archiveBucket = s3.Bucket.fromBucketName(
            this,
            'ImportedArchiveBucket',
            Fn.importValue(`kitchensink-data-${stage}:ArchiveBucketName`),
        );

        const repository = ecr.Repository.fromRepositoryName(this, 'IdentityServiceRepository', 'kitchensink-identity');

        const cluster = new ecs.Cluster(this, 'IdentityServiceCluster', {
            vpc,
            // Per-stage observability depth (ADR-0007). Prod keeps ENHANCED (unchanged → no prod diff);
            // non-prod stages drop to the STANDARD tier — `ENABLED` (CFN `enabled`) is base Container
            // Insights, priced well below the ENHANCED tier.
            containerInsightsV2: stage === 'prod' ? ecs.ContainerInsights.ENHANCED : ecs.ContainerInsights.ENABLED,
            // ADR-0008: advertise the FARGATE_SPOT capacity provider for non-prod only. `false` (prod)
            // creates no ClusterCapacityProviderAssociations resource, so the prod template is unchanged.
            enableFargateCapacityProviders: useSpot,
        });

        const taskExecutionRole = new iam.Role(this, 'IdentityTaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });

        // ARCH-IT-4: no manual `secretsmanager:GetSecretValue` on `*` here. The execution role only
        // needs to read the secrets referenced by the container `secrets:` block (the DB creds and the
        // auth publishable key), and `ecs.Secret.fromSecretsManager` already grants the execution role
        // `GetSecretValue` scoped to those exact secret ARNs. A wildcard statement would let this task
        // read EVERY secret in the account, so it is omitted (verified against the synthesized policy).

        const taskRole = new iam.Role(this, 'IdentityTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for identity service',
        });

        dbCredentialsSecret.grantRead(taskRole);
        authSecretKey.grantRead(taskRole);
        migrationPlanSecret.grantRead(taskRole);
        // SEND, not consume. This service is a pure PRODUCER on the deletion queue: `queue/sqs.service.ts`
        // imports exactly one command (`SendMessageCommand`) and nothing in `src/` ever receives — the
        // deletion-WORKER Lambda is the consumer, and it holds its own `grantConsumeMessages` over in the
        // webhooks stack.
        //
        // ⚠️ This line read `grantConsumeMessages` and shipped that way. `grantConsumeMessages` confers
        // ReceiveMessage/DeleteMessage/ChangeMessageVisibility and NOT SendMessage, so the task held only dead
        // permission on a queue it exclusively writes to, and every enqueue was an AccessDenied — confirmed on
        // the deployed sandbox role. Because both call sites (`users.service.ts` closure, `admin.service.ts`
        // reactivation) await the enqueue inside a swallow that logs a warning, the API still answered 200:
        // account closure never BANNED the Clerk identity and reactivation never UNBANNED it, so a reactivated
        // user stayed locked out of an account the database said was active. A security control that fails into
        // logger.warn is indistinguishable from one that works, which is why nobody noticed.
        //
        // `serviceInfraWiringInvariants.test.ts` (W1) now derives this: a queue whose URL is injected into a
        // deployed environment must be granted the operations that code's SQS commands require.
        deletionQueue.grantSendMessages(taskRole);
        handleSyncTopic.grantPublish(taskRole);
        mediaBucket.grantReadWrite(taskRole);
        archiveBucket.grantReadWrite(taskRole);

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'IdentityTaskDefinition', {
            cpu: 512,
            memoryLimitMiB: 1024,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole,
        });

        // AwsSolutions-ECS2 accepted: every plaintext container Environment entry here is non-secret, and
        // every real secret is injected via ecs.Secret.fromSecretsManager (i.e. under Secrets, not
        // Environment). Justification -- including the invariant it depends on -- in
        // @kitchensink/infra-security.
        acceptNagFindings(taskDefinition, AcceptedNagFindings.TASK_ENVIRONMENT_HOLDS_NO_SECRET);

        const logGroup = new logs.LogGroup(this, 'IdentityServiceLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        taskDefinition.addContainer('IdentityServiceContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'identity-service',
                logGroup,
            }),
            environment: {
                NODE_ENV: 'production',
                PORT: '3000',
                // debug:auth flow tracing — on in sandbox, off in prod. Flip to '1' on the task def to
                // debug a prod signup/auth issue (no code change), then back to '0'.
                DEBUG_AUTH: stage === 'prod' ? '0' : '1',
                DB_HOST: database.dbInstanceEndpointAddress,
                DB_PORT: Fn.importValue(`kitchensink-data-${stage}:DatabasePort`),
                DB_NAME: Fn.importValue(`kitchensink-data-${stage}:DatabaseName`),
                DELETION_QUEUE_URL: deletionQueue.queueUrl,
                HANDLE_SYNC_TOPIC_ARN: handleSyncTopic.topicArn,
                MEDIA_BUCKET_NAME: mediaBucket.bucketName,
                ARCHIVE_BUCKET_NAME: archiveBucket.bucketName,
                AUTH_SECRET_ARN: authSecretKey.secretArn,
                // Sentry config (U8). DSN value resolved from SSM at deploy (KTD6); STAGE drives the
                // Sentry environment; SENTRY_RELEASE = the image tag (commit SHA) so source maps
                // resolve against the same release the build uploaded (KTD7 / U11).
                STAGE: stage,
                // Stage-first SSM layout — `kitchensink/{stage}/{service}/{key}` — matching Secrets
                // Manager (`kitchensink/{stage}/identity/keys`).
                SENTRY_DSN: ssm.StringParameter.valueForStringParameter(
                    this,
                    `/kitchensink/${stage === 'prod' ? 'prod' : 'sandbox'}/sentry/identity-service-dsn`,
                ),
                SENTRY_TRACES_SAMPLE_RATE: stage === 'prod' ? '0.1' : '1.0',
                SENTRY_RELEASE: imageTag,
                // Clerk session-token verification (read-through auth, U1/U2). The JWT *public* key
                // and the authorized-parties allowlist are non-secret, resolved from SSM at deploy.
                // Prod reads prod params; every other stage reads the shared sandbox (dev-instance)
                // params. These SSM params must exist before deploy (operational prerequisite).
                CLERK_JWT_KEY: ssm.StringParameter.valueForStringParameter(
                    this,
                    `/kitchensink/${stage === 'prod' ? 'prod' : 'sandbox'}/clerk/jwt-public-key`,
                ),
                // Stage-gated azp enforcement (ADR-0001). PROD: exact-match list. NON-PROD (sandbox): the
                // self-owned anchored pattern for per-PR preview subdomains, with the preview MODE
                // (`strict` | `transition`) resolved from SSM so the cutover + rollback is an SSM change +
                // task restart, not a code deploy. Exactly one mode per stage (config contract), so prod
                // gets ONLY the list and non-prod ONLY the pattern pair. Params must exist before deploy.
                ...(stage === 'prod'
                    ? {
                          CLERK_AUTHORIZED_PARTIES: ssm.StringParameter.valueForStringParameter(
                              this,
                              `/kitchensink/prod/clerk/authorized-parties`,
                          ),
                      }
                    : {
                          CLERK_AZP_PATTERN: ssm.StringParameter.valueForStringParameter(
                              this,
                              `/kitchensink/sandbox/clerk/azp-pattern`,
                          ),
                          CLERK_AZP_PREVIEW_MODE: ssm.StringParameter.valueForStringParameter(
                              this,
                              `/kitchensink/sandbox/clerk/azp-preview-mode`,
                          ),
                          // Non-prod runs pattern mode, which rejects azp-less native (@clerk/expo) tokens
                          // unless the native-admission gate is on. The mobile app authenticates against the
                          // shared sandbox identity, so admit its `client_type: 'native'` tokens. Prod stays
                          // list mode, which already skips the azp check on absent azp — so prod needs no flag
                          // and its template stays byte-identical.
                          CLERK_ADMIT_NATIVE_CLIENT: 'true',
                      }),
            },
            secrets: {
                DB_USERNAME: ecs.Secret.fromSecretsManager(dbCredentialsSecret, 'username'),
                DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentialsSecret, 'password'),
                AUTH_PUBLISHABLE_KEY: ecs.Secret.fromSecretsManager(authSecretKey, 'PUBLISHABLE_KEY'),
            },
            portMappings: [
                {
                    containerPort: 3000,
                },
            ],
            healthCheck: {
                command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
                interval: Duration.seconds(30),
                timeout: Duration.seconds(10),
                retries: 3,
                startPeriod: Duration.seconds(60),
            },
        });

        const service = new ecs.FargateService(this, 'IdentityService', {
            cluster,
            taskDefinition,
            desiredCount,
            // ADR-0008: non-prod runs on FARGATE_SPOT (undefined for prod keeps on-demand LaunchType
            // FARGATE → no prod diff). Providing a strategy omits LaunchType from the service resource.
            capacityProviderStrategies,
            // Public subnet + public IP so the task egresses to Clerk/AWS via the Internet Gateway
            // (free) instead of the NAT. Inbound stays locked to the ALB SG (serviceSecurityGroup),
            // so the public IP is egress-only; the task still reaches the private RDS intra-VPC by SG.
            // This keeps the NAT serving ONLY the DB-bound webhook lambdas (minimize-nat).
            assignPublicIp: true,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
            securityGroups: [serviceSecurityGroup],
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(120),
            circuitBreaker: {
                rollback: true,
            },
        });

        // ── In-VPC migration-runner Lambda ───────────────────────────────────────────────────────
        // The RDS instance is private, so the deploy pipeline (outside the VPC) cannot apply the schema
        // itself; a VPC-attached Lambda does it. This function was `MigrationFunction` in
        // `kitchensink-identity-webhooks-{stage}` until it moved here — same handler, same SQL, same
        // subnets and security group — because ONLY a runner in this stack can be ordered ahead of the ECS
        // service below (see the trigger).
        //
        // A Lambda's public IP does NOT give it egress (ADR-0004), so this is one of the few workloads on
        // the NAT instance; the ECS tasks above stay in public subnets and off it. That is unchanged by the
        // move — the NAT's consumer set is the same functions it always was, one of them now declared here.
        //
        // Asset: esbuild bundles to the package-root `dist-lambda/` (`npm run bundle:lambda`, run by
        // infra:synth/deploy). Synth must not fail when the asset is absent (a bare `cdk synth`), so fall
        // back to an inline placeholder that THROWS. It used to be tempting to resolve something benign —
        // but a successful invocation that applied nothing is the silent no-op this whole gate exists to
        // remove, so an unbundled deploy must fail the trigger, and so the deploy. This module lives at
        // `infra/lib/`, so the package root is two levels up from source (tsx) but three from the compiled
        // `infra/dist/lib/` (how CI deploys via `node infra/dist/bin/app.js`) — probe both.
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);

        // ONE figure, two consumers: the runner's own execution limit and — via `.plus()` below — the
        // trigger's socket timeout. Written twice, the two drift, and the drift is only observable as a
        // deploy that fails on a migration it had already applied.
        const migrationRunnerTimeout = Duration.seconds(300);

        const migrationFn = new lambda.Function(this, 'IdentityMigrationFunction', {
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: hasLambdaAsset ? 'lambdas/migrate/handler.handler' : 'index.handler',
            code: hasLambdaAsset
                ? lambda.Code.fromAsset(lambdaAssetDir)
                : lambda.Code.fromInline(
                      'exports.handler = async () => { throw new Error("identity migration bundle missing: run `npm run bundle:lambda --workspace=packages/services/identity` before deploying"); };',
                  ),
            timeout: migrationRunnerTimeout,
            memorySize: 512,
            environment: {
                STAGE: stage,
                // The runner resolves host/port/database/credentials from this secret at RUNTIME. Not a
                // deploy-time `{{resolve:secretsmanager:…}}` embed: RDS credentials can rotate, and an
                // embedded copy would go stale silently — leaving the runner unable to connect on the one
                // deploy that needed it.
                DB_SECRET_ARN: dbCredentialsSecret.secretArn,
            },
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
        });
        dbCredentialsSecret.grantRead(migrationFn);

        // ── Schema BEFORE traffic: run the migration inside the deploy ───────────────────────────
        //
        // ⛔ THE ORDER HERE IS THE POINT, AND ONE OF ITS TWO HALVES IS COUNTER-INTUITIVE.
        //
        // `cdk deploy` returns only once ECS has STABILISED, so the pipeline's "deploy, then invoke the
        // migration runner" put the new image in front of live traffic for the whole stabilisation window
        // with the old schema underneath it. Identity is the worst place in the system for that window:
        // `AuthMiddleware` read-through-creates the user row on EVERY authenticated request, so a
        // schema/code mismatch is not a degraded read — it is a failed sign-in, and prod is fronted by
        // CloudFront.
        //
        // The instinctive repair — hoist the pipeline's migrate step above `cdk deploy` — is WORSE, and
        // silently so. `esbuild.mjs` copies `src/database/migrations/*.sql` into `dist-lambda/migrations/`
        // at BUILD time and that bundle ships WITH this stack, so invoking first invokes the PREVIOUS
        // deploy's Lambda carrying the PREVIOUS migration set: exit 0, "nothing pending", nothing applied,
        // and the new tasks still meet the missing column. The only point in time at which the NEW
        // migrations exist but the NEW tasks are not yet serving is INSIDE this deploy, between the
        // Lambda's code update and the service's rollout — exactly the seam `triggers.Trigger` occupies.
        //
        // ⛔ `triggers.Trigger`, NOT a hand-rolled `AwsCustomResource` calling `lambda:Invoke`. The
        // triggers framework handler skips on `Delete` and THROWS on `FunctionError`; a raw `lambda:Invoke`
        // returns HTTP 200 with `FunctionError` set in the response, which a custom resource reads as
        // success — reintroducing the silent no-op by a different road.
        //
        // ⚠️ THIS FIXES EXPANDING MIGRATIONS AND CHANGES THE CONTRACT FOR CONTRACTING ONES. Every migration
        // must now be safe to apply while the PREVIOUS release is still serving, so anything destructive
        // (DROP COLUMN, DROP TABLE, a narrowing type change) ships in a LATER release than the code that
        // stopped using it — the standard expand/contract split, never both halves in one deploy. That is
        // strictly safer than the order it replaces: a rolling ECS deployment runs old and new tasks
        // CONCURRENTLY, so same-release contraction was only ever safe by virtue of `cdk deploy` having
        // already drained the old tasks, which is a property of the pipeline and not of the change.
        //
        // Three details are load-bearing and each has a failure mode if changed:
        //   • `executeAfter(migrationFn)` — the runner's `secretsmanager:GetSecretValue` grant is attached
        //     to its own role, inside the function's construct subtree, and the custom resource only
        //     REFERENCES the version. Without this edge CloudFormation is free to invoke the trigger before
        //     that policy exists, and the deploy dies on AccessDenied reading the credentials it needs.
        //   • `timeout` — this is the trigger's SOCKET timeout, and it defaults to two minutes while the
        //     runner is allowed five. Derived from the runner's own timeout, never a second literal: a
        //     migration that outlives the socket fails a deploy whose schema was already applied.
        //   • `executeOnHandlerChange` (left at its `true` default) — the trigger is keyed to the handler's
        //     `currentVersion`, so it re-executes exactly when the bundled migration set changes. Turning
        //     it off would apply nothing on the one deploy that introduces a migration.
        //
        // The pipeline's `Run identity DB migrations` step is deliberately KEPT as a safety net: it is
        // idempotent, and it still catches a stage whose schema is behind for a reason no code change
        // explains (a restore, a stage created later). `prodDeployMigrationOrder.test.ts` pins both.
        //
        // ⚠️ DELIBERATE — see docs/architecture/decisions/0022-in-stack-migration-trigger.md
        // ⛔ DISCOVERED from the construct tree, never a list. This read used to be `[service]`, which was
        // correct only for as long as the ECS service stayed the sole thing here that touches the schema —
        // and nothing said so. A DB-touching Lambda added to this stack (a reconciler, a backfill) would
        // have been updated AHEAD of the migration with every guard green, because the template gate that
        // covers this barrier asserts over `AWS::ECS::Service` and cannot see a new function. Read BEFORE
        // the Trigger is constructed, so CDK's own custom-resource provider Lambda — created inside it, and
        // no consumer of this schema — is not swept in.
        const orderedBehindTheSchema = this.node
            .findAll()
            .filter(
                (construct): construct is Construct =>
                    construct instanceof lambda.Function || construct instanceof ecs.BaseService,
            )
            .filter((construct) => construct !== migrationFn);

        new triggers.Trigger(this, 'IdentitySchemaMigrations', {
            handler: migrationFn,
            timeout: migrationRunnerTimeout.plus(Duration.seconds(60)),
            executeAfter: [migrationFn],
            executeBefore: orderedBehindTheSchema,
        });

        const scalableTarget = service.autoScaleTaskCount({
            minCapacity: 1,
            maxCapacity: 6,
        });
        scalableTarget.scaleOnCpuUtilization('IdentityServiceCpuScaling', {
            targetUtilizationPercent: 60,
            scaleInCooldown: Duration.minutes(2),
            scaleOutCooldown: Duration.minutes(1),
        });

        const isProd = stage === 'prod';
        const subdomain = isProd ? 'identity' : `identity.${stage}`;
        const serviceDomain = `${subdomain}.${domainName}`;

        // ADR-0020 / plan U15 — the origin host the CloudFront distribution will dial in U16. Resolved by
        // @kitchensink/infra-alb, never spelled here: the rule condition below, the A-record below, and
        // EdgeStack's origin must be the SAME string, and nothing at synth checks that they are. `undefined`
        // outside prod is the normal case (only prod has a distribution, and only prod's DomainStack mints
        // the `*.internal` certificate that can terminate the name).
        const internalOrigin = internalOriginForStage({ service: 'identity', stage, domainName });

        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-domain-${stage}:HostedZoneId`),
            zoneName: domainName,
        });

        // NOTE: a target group cannot be MOVED between load balancers — attaching an existing TG to a
        // second LB fails with "target groups cannot be associated with more than one load balancer".
        // Migrating identity from its own ALB to the shared ALB therefore requires a NEW TG (new logical
        // id 'IdentityServiceSharedTargets', replacing the old 'IdentityServiceTargets'): CloudFormation
        // creates the fresh TG on the shared ALB and deletes the old TG with the old ALB. Do not rename
        // back to the old id while any stage still has the pre-shared-ALB topology deployed.
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'IdentityServiceSharedTargets', {
            vpc,
            port: 3000,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            targets: [service.loadBalancerTarget({ containerName: 'IdentityServiceContainer', containerPort: 3000 })],
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

        // Shared per-stage ALB (owned by the global infra — kitchensink-alb-${stage}). This service
        // does NOT create its own ALB; it imports the shared HTTPS listener and adds a host-based rule
        // for its subdomain. See docs/architecture/decisions/0003-shared-alb-per-stage.md.
        const sharedHttpsListener = elbv2.ApplicationListener.fromApplicationListenerAttributes(
            this,
            'SharedHttpsListener',
            {
                listenerArn: Fn.importValue(`kitchensink-alb-${stage}:SharedAlbHttpsListenerArn`),
                securityGroup: albSecurityGroup,
            },
        );

        // Listener-rule priorities are ONE namespace shared across every service's stack on this stage's
        // single HTTPS listener, owned by @kitchensink/infra-alb (ADR-0003). Identity reads its BASE priority
        // directly and never calls the stage resolver, because it has no ephemeral variant: it is the ONE
        // shared persistent service every per-PR preview signs in against, so `stage` is always a base stage
        // here (note the `kitchensink-alb-${stage}` import above, not `${baseStage}`). Its ephemeral band is
        // reserved in the registry and deliberately unused.
        // The internal origin is a SECOND HOST ON THIS RULE, never a second rule: priority is a namespace
        // shared across independently-deployed stacks, so a second rule would have to claim one and the
        // deploy would fail with `Priority 'N' is currently in use` (ADR-0003). Public host stays FIRST and
        // keeps serving — U15 adds a door, U17 is what closes the old one, and identity closes LAST.
        // U17 closes it, and identity closes LAST — it carries the auth path and the ADR-0001 `azp` hazard,
        // so it moves only after food and recipe are proven through the edge. Once identity is named in
        // `EDGE_CUTOVER_SERVICES`, EdgeStack owns the public record and this rule answers only on the origin
        // name CloudFront dials. Both halves move together — see the resolver for why one without the other
        // is the actual failure.
        const publicRecordOwner = publicRecordOwnerFor({
            service: 'identity',
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
        // NOT. That restriction admits CloudFront, not OURS: `identity.internal.{apex}` is published in the
        // public zone, so anyone may point their own distribution at it and reach this target group with
        // the edge verifier out of the path. Prod only, and `undefined` everywhere else — this stack is the
        // ONE shared identity service every per-PR preview signs in against, so a header condition on
        // sandbox would take every open preview offline at once with ADR-0003's default 404.
        //
        // ⛔ DEPLOY ORDER, and it does not commute: `EdgeStack` must be sending the header BEFORE this
        // condition exists, or production traffic 404s. See ADR-0020's U17 correction.
        const originHeader = edgeOriginHeaderFor(stage);

        new elbv2.ApplicationListenerRule(this, 'IdentityServiceListenerRule', {
            listener: sharedHttpsListener,
            priority: BASE_LISTENER_PRIORITY.identity,
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
            loadBalancerArn: Fn.importValue(`kitchensink-alb-${stage}:SharedAlbArn`),
            securityGroupId: Fn.importValue(`kitchensink-network-${stage}:AlbSecurityGroupId`),
            loadBalancerDnsName: Fn.importValue(`kitchensink-alb-${stage}:SharedAlbDnsName`),
            loadBalancerCanonicalHostedZoneId: Fn.importValue(
                `kitchensink-alb-${stage}:SharedAlbCanonicalHostedZoneId`,
            ),
        });

        // Released to EdgeStack at cutover (U17), never deleted outright: Route 53 refuses a duplicate, so
        // the two stacks cannot both hold it, and whichever holds it is the one that must publish it.
        if (publicRecordOwner === 'service') {
            new route53.ARecord(this, 'IdentityServiceAliasRecord', {
                zone: hostedZone,
                recordName: subdomain,
                target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(sharedAlb)),
            });
        }

        // Prod only (ADR-0020 / U15). Same ALB, second name: the distribution origins at this record, and
        // the listener rule above already matches the host it resolves to.
        if (internalOrigin !== undefined) {
            new route53.ARecord(this, 'IdentityServiceInternalAliasRecord', {
                zone: hostedZone,
                recordName: internalOrigin.recordName,
                target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(sharedAlb)),
            });
        }

        this.serviceUrl = `https://${serviceDomain}`;

        // A4: alarms previously had no action wired, so they fired silently. Route all of them to an
        // SNS topic so they actually notify (subscriptions managed out-of-band per stage).
        const alarmTopic = new sns.Topic(this, 'IdentityAlarmTopic', {
            enforceSSL: true,
            displayName: `Identity service alarms (${stage})`,
        });
        // R3.2 / U11 — every alarm must reach a human. Absent address = no subscription, never a
        // synth failure: an account that has not configured a recipient must still deploy.
        subscribeAlarmEmail(alarmTopic, props.alertEmail);
        const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);

        // Per-service 5xx on the shared ALB. The ALB-level metric would now aggregate every service's
        // 5xx, so this scopes to the identity target group's target 5xx count instead.
        const alb5xxAlarm = new cloudwatch.Alarm(this, 'IdentityAlb5xxAlarm', {
            metric: targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
                period: Duration.minutes(5),
                statistic: 'sum',
            }),
            threshold: 5,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            alarmDescription: 'Identity ALB target 5xx alarm',
        });
        alb5xxAlarm.addAlarmAction(alarmAction);

        const highCpuAlarm = new cloudwatch.Alarm(this, 'IdentityServiceHighCpuAlarm', {
            metric: service.metricCpuUtilization({
                period: Duration.minutes(5),
                statistic: 'avg',
            }),
            threshold: 80,
            evaluationPeriods: 2,
            datapointsToAlarm: 2,
            alarmDescription: 'Identity ECS CPU high-water mark',
        });
        highCpuAlarm.addAlarmAction(alarmAction);

        // A4: boot crash-loop detector. A NestJS DI/boot failure crash-loops the task, which never
        // passes the ALB health check, so HealthyHostCount sits at 0 — directly observable here,
        // unlike a Sentry issue (the process can die before Sentry flushes). treatMissingData=BREACHING
        // because "no datapoints" during a crash-loop is itself the failure, not an absence of signal.
        const crashLoopAlarm = new cloudwatch.Alarm(this, 'IdentityServiceCrashLoopAlarm', {
            metric: targetGroup.metrics.healthyHostCount({
                period: Duration.minutes(1),
                statistic: 'min',
            }),
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
            threshold: 1,
            evaluationPeriods: 3,
            datapointsToAlarm: 3,
            treatMissingData: cloudwatch.TreatMissingData.BREACHING,
            alarmDescription: 'Identity ECS has no healthy targets (boot crash-loop / unhealthy tasks)',
        });
        crashLoopAlarm.addAlarmAction(alarmAction);

        new CfnOutput(this, 'IdentityEcrRepositoryUri', {
            value: repository.repositoryUri,
            exportName: `${this.stackName}:IdentityEcrRepositoryUri`,
        });
        new CfnOutput(this, 'IdentityClusterArn', {
            value: cluster.clusterArn,
            exportName: `${this.stackName}:IdentityClusterArn`,
        });
        new CfnOutput(this, 'IdentityServiceArn', {
            value: service.serviceArn,
            exportName: `${this.stackName}:IdentityServiceArn`,
        });
        new CfnOutput(this, 'IdentityTaskExecutionRoleArn', {
            value: taskExecutionRole.roleArn,
            exportName: `${this.stackName}:IdentityTaskExecutionRoleArn`,
        });
        new CfnOutput(this, 'IdentityTaskRoleArn', {
            value: taskRole.roleArn,
            exportName: `${this.stackName}:IdentityTaskRoleArn`,
        });
        new CfnOutput(this, 'IdentityAlbTargetGroupArn', {
            value: targetGroup.targetGroupArn,
            exportName: `${this.stackName}:IdentityAlbTargetGroupArn`,
        });
        new CfnOutput(this, 'IdentityServiceLogGroupName', {
            value: logGroup.logGroupName,
            exportName: `${this.stackName}:IdentityServiceLogGroupName`,
        });
        // The safety-net invocation in `prod-deploy.yml` / `sandbox-identity-deploy.yml` resolves the runner
        // through this output. It replaces `kitchensink-identity-webhooks-{stage}:MigrationFunctionName`,
        // which is retired with the function it named. Both pipelines must be repointed in the SAME change
        // that deletes that export, or the migrate step resolves a name that no longer exists.
        new CfnOutput(this, 'IdentityMigrationFunctionName', {
            value: migrationFn.functionName,
            exportName: `${this.stackName}:IdentityMigrationFunctionName`,
        });
        new CfnOutput(this, 'IdentityServiceUrl', {
            value: this.serviceUrl,
            exportName: `${this.stackName}:IdentityServiceUrl`,
        });
    }
}
