import {
    CfnOutput,
    Duration,
    Fn,
    SecretValue,
    Stack,
    type StackProps,
    aws_apigateway as apigw,
    aws_certificatemanager as acm,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cloudwatch_actions,
    aws_ec2 as ec2,
    aws_events as events,
    aws_events_targets as events_targets,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_lambda_event_sources as lambda_event_sources,
    aws_logs as logs,
    aws_logs_destinations as logsDestinations,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
    aws_sns as sns,
    aws_sqs as sqs,
    aws_ssm as ssm,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { AcceptedNagFindings, NODE_LAMBDA_RUNTIME, acceptNagFindings } from '@kitchensink/infra-security';

import { erasureSsmPath, getAuthSecretName, getErasureSigningSecretName, ssmParamPath } from './config.js';

export interface WebhooksStackProps extends StackProps {
    readonly stage: string;
    readonly domainName: string;
    readonly vpcId: string;
    readonly lambdaSecurityGroupId: string;
    readonly databaseSecurityGroupId: string;
    readonly dbSecretArn: string;
    readonly authSecretArn: string;
    readonly migrationPlanSecretArn: string;
    readonly dbInstanceIdentifier: string;
    readonly dbEndpoint: string;
    readonly dbPort: number;
    readonly deletionQueueArn: string;
    readonly mediaBucketName: string;
    readonly archiveBucketName: string;
    readonly hostedZoneId: string;
    readonly zoneName: string;
}

export class WebhooksStack extends Stack {
    public readonly apiUrl: string;

    public constructor(scope: Construct, id: string, props: WebhooksStackProps) {
        super(scope, id, props);

        const deployStage = props.stage;
        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { vpcId: props.vpcId });
        const lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedLambdaSg',
            props.lambdaSecurityGroupId,
        );
        const dbCredentialsSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedDbSecret', {
            secretCompleteArn: props.dbSecretArn,
        });
        // `authSecretArn` is the data stack's name-based, suffix-LESS `SecretArn` export (the secret is
        // imported there via `fromSecretNameV2`). Import it as a PARTIAL ARN so `grantRead` appends the
        // `-??????` wildcard that matches the secret's real ARN — a `secretCompleteArn` grants the exact
        // suffix-less resource, which the runtime GetSecretValue fallback (below) would be denied on.
        // (The DB and migration secrets are CDK-created and export full ARNs, so they stay complete.)
        const authSecretKey = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedAuthSecret', {
            secretPartialArn: props.authSecretArn,
        });
        const deletionQueue = sqs.Queue.fromQueueArn(this, 'ImportedDeletionQueue', props.deletionQueueArn);
        const mediaBucket = s3.Bucket.fromBucketName(this, 'ImportedMediaBucket', props.mediaBucketName);
        const archiveBucket = s3.Bucket.fromBucketName(this, 'ImportedArchiveBucket', props.archiveBucketName);
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.zoneName,
        });
        const certificate = new acm.Certificate(this, 'WebhooksCertificate', {
            domainName: props.domainName,
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });

        const customDomain = new apigw.DomainName(this, 'IdentityApiDomain', {
            domainName: props.domainName,
            certificate,
            endpointType: apigw.EndpointType.REGIONAL,
            securityPolicy: apigw.SecurityPolicy.TLS_1_2,
        });

        const isValidStage =
            ['dev', 'staging', 'prod', 'test', 'sandbox'].includes(deployStage) ||
            deployStage.startsWith('sandbox-') ||
            deployStage.startsWith('mr-') ||
            deployStage.startsWith('pr-');
        if (!isValidStage) {
            throw new Error(
                `Invalid STAGE="${deployStage}". Must be dev, staging, prod, test, sandbox, or sandbox-* / mr-* / pr-*.`,
            );
        }

        const currentFile = fileURLToPath(import.meta.url);
        const infraDir = path.dirname(currentFile);
        const possiblePaths = [
            path.resolve(infraDir, '../../../../services/identity-webhooks/dist'),
            path.resolve(infraDir, '../../../../packages/services/identity-webhooks/dist'),
            path.resolve(infraDir, '../../../dist'),
        ];
        const distPath = possiblePaths.find((p) => existsSync(p)) ?? possiblePaths[0];
        const runtime = NODE_LAMBDA_RUNTIME;
        const architecture = lambda.Architecture.X86_64;
        const identityStage = deployStage === 'prod' ? 'prod' : 'sandbox';

        // The global handle-sync topic (W8-a.2): the user.updated webhook publishes a rename here. Imported
        // from the DataStack export (per-stage global — prod/sandbox baseline).
        const handleSyncTopic = sns.Topic.fromTopicArn(
            this,
            'ImportedHandleSyncTopic',
            Fn.importValue(`kitchensink-data-${identityStage}:HandleSyncTopicArn`),
        );
        const ssmValue = (service: 'clerk' | 'sentry', key: string): string =>
            ssm.StringParameter.valueForStringParameter(this, ssmParamPath(identityStage, service, key));

        // Sentry config injected as plain Lambda env. Per-service DSN value comes from SSM at deploy
        // (KTD6); STAGE drives the Sentry environment; SENTRY_RELEASE is the commit SHA passed by CI
        // (U11) so source maps resolve, falling back to the stage when run outside CI.
        const sentryTracesSampleRate = deployStage === 'prod' ? '0.1' : '1.0';
        const sentryRelease = process.env['SENTRY_RELEASE'] ?? deployStage;
        const sentryEnv: Record<string, string> = {
            STAGE: deployStage,
            SENTRY_DSN: ssmValue('sentry', 'webhook-dsn'),
            SENTRY_TRACES_SAMPLE_RATE: sentryTracesSampleRate,
            SENTRY_RELEASE: sentryRelease,
        };

        const commonEnv: Record<string, string> = {
            NODE_ENV: 'production',
            // debug:auth flow tracing — on in sandbox, off in prod (flip to '1' to debug a prod issue).
            DEBUG_AUTH: deployStage === 'prod' ? '0' : '1',
            DB_SECRET_ARN: dbCredentialsSecret.secretArn,
            AUTH_SECRET_ARN: authSecretKey.secretArn,
            IDP_JWKS_URL: ssmValue('clerk', 'jwks-url'),
            IDP_ISSUER: ssmValue('clerk', 'issuer'),
            IDP_AUDIENCE: ssmValue('clerk', 'audience'),
            DELETION_QUEUE_URL: deletionQueue.queueUrl,
            DELETION_QUEUE_ARN: deletionQueue.queueArn,
            MEDIA_BUCKET_NAME: mediaBucket.bucketName,
            ARCHIVE_BUCKET_NAME: archiveBucket.bucketName,
            ...sentryEnv,
        };

        // The deletion-worker + reconciliation Lambdas call the Clerk backend SDK, which needs the
        // secret key. Embed it at deploy (CFN dynamic reference) like the webhook signing secret, so
        // identityClient reads IDP_SECRET_KEY directly with no runtime GetSecretValue.
        const clerkBackendEnv: Record<string, string> = {
            ...commonEnv,
            IDP_SECRET_KEY: SecretValue.secretsManager(getAuthSecretName(identityStage), {
                jsonField: 'SECRET_KEY',
            }).unsafeUnwrap(),
        };

        // CR-002 / U4b — the cross-service erasure fan-out config for the deletion-worker + the new
        // erasure-reconciliation Lambda. The EdDSA PRIVATE signing key is embedded at deploy (CFN dynamic
        // reference) from the per-stage erasure secret, so `service-erasure-token.ts` signs with no runtime
        // GetSecretValue — exactly the IDP_SECRET_KEY embed pattern above. The recipe/food origins are
        // non-secret, resolved from SSM at deploy. See the deferred key-provisioning seam on
        // `getErasureSigningSecretName`: until ops provisions the keypair + URLs, the fan-out fails CLOSED
        // (loud DLQ + the ErasureIncomplete alarm), never silently.
        const erasureFanoutEnv: Record<string, string> = {
            SERVICE_ERASURE_SIGNING_KEY: SecretValue.secretsManager(getErasureSigningSecretName(identityStage), {
                jsonField: 'SIGNING_KEY',
            }).unsafeUnwrap(),
            RECIPE_SERVICE_BASE_URL: ssm.StringParameter.valueForStringParameter(
                this,
                erasureSsmPath(identityStage, 'recipe-base-url'),
            ),
            FOOD_SERVICE_BASE_URL: ssm.StringParameter.valueForStringParameter(
                this,
                erasureSsmPath(identityStage, 'food-base-url'),
            ),
        };

        const webhooksLogGroup = new logs.LogGroup(this, 'WebhooksLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        // ARCH-IT-7: one least-privilege role PER function instead of a single union role shared by all
        // four Lambdas. The old shared role granted the UNION of every permission (DB-secret read,
        // auth-secret read, SQS send AND consume, media + archive bucket read/write) to functionally
        // distinct handlers, so e.g. the migration runner could send/consume SQS and read/write both
        // buckets it never touches. Each role below grants ONLY what that handler's code actually calls
        // (verified against the handler sources): every Lambda is VPC-attached (to reach the private
        // RDS) and writes to the shared webhooks log group, so `makeLambdaRole` factors out just that
        // common base; the resource grants are added per function.
        //
        // NOTE: none of these handlers touch S3 — the only S3 caller in the identity codebase is the
        // avatar-upload controller, which runs in the ECS service, not any Lambda — so no bucket grant
        // is issued here (the media/archive bucket NAMES are still passed as env vars, above).
        const vpcAccessManagedPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSLambdaVPCAccessExecutionRole',
        );
        const makeLambdaRole = (id: string, description: string): iam.Role => {
            const role = new iam.Role(this, id, {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                description,
                managedPolicies: [vpcAccessManagedPolicy],
            });
            webhooksLogGroup.grantWrite(role);

            return role;
        };

        // webhook (handlers/identityWebhook.ts): reads the DB creds (getDb) and enqueues deletion jobs
        // to SQS (SendMessage). It calls the Clerk backend SDK (setExternalId), which prefers the
        // deploy-embedded IDP_SECRET_KEY but can fall back to a runtime GetSecretValue on the auth
        // secret — so the auth-secret read grant is retained (removing it reintroduces the user.created
        // 502 the embed fixed). No SQS consume, no buckets.
        const webhookRole = makeLambdaRole('WebhookLambdaRole', 'Least-privilege role for the Clerk webhook Lambda');
        dbCredentialsSecret.grantRead(webhookRole);
        authSecretKey.grantRead(webhookRole);
        deletionQueue.grantSendMessages(webhookRole);
        handleSyncTopic.grantPublish(webhookRole);

        // deletion-worker (handlers/deletion-worker.ts): reads the DB creds (getDb) and drains the SQS
        // deletion queue. CR-002: it now calls the Clerk backend SDK (banUser/unbanUser on closure/
        // reactivation events) — the secret is deploy-embedded in clerkBackendEnv (IDP_SECRET_KEY), but the
        // auth-secret read grant is retained for identityClient's runtime GetSecretValue fallback, matching
        // the webhook/reconciliation roles. It does not send to SQS. (The SqsEventSource below also grants
        // consume; the explicit grant states the intent.)
        const deletionWorkerRole = makeLambdaRole(
            'DeletionWorkerLambdaRole',
            'Least-privilege role for the SQS deletion-worker Lambda',
        );
        dbCredentialsSecret.grantRead(deletionWorkerRole);
        authSecretKey.grantRead(deletionWorkerRole);
        deletionQueue.grantConsumeMessages(deletionWorkerRole);

        // tombstone-sweep (handlers/tombstone-sweep.ts, CR-002 KTD-3): reads the DB creds (getDb) to scrub
        // expired tombstones, calls the Clerk backend SDK (deleteUser) — so it needs the auth-secret read
        // fallback — and enqueues the recipe/food erasure legs to the deletion queue (SendMessage). Runs on
        // its own schedule, off no queue.
        const tombstoneSweepRole = makeLambdaRole(
            'TombstoneSweepLambdaRole',
            'Least-privilege role for the scheduled 12-month tombstone-sweep Lambda',
        );
        dbCredentialsSecret.grantRead(tombstoneSweepRole);
        authSecretKey.grantRead(tombstoneSweepRole);
        deletionQueue.grantSendMessages(tombstoneSweepRole);

        // reconciliation (handlers/reconciliation.ts): reads the DB creds and lists Clerk users via the
        // backend SDK, which (like the webhook) may fall back to a runtime GetSecretValue on the auth
        // secret — so the auth-secret read grant is retained. It runs on a schedule, not off SQS, and
        // touches no queue or bucket.
        const reconciliationRole = makeLambdaRole(
            'ReconciliationLambdaRole',
            'Least-privilege role for the scheduled reconciliation Lambda',
        );
        dbCredentialsSecret.grantRead(reconciliationRole);
        authSecretKey.grantRead(reconciliationRole);

        // erasure-reconciliation (handlers/erasure-reconciliation.ts, CR-002 R7 completion contract): reads
        // the DB creds (getDb) to scan `status='erased'` rows and RE-DRIVES the recipe + food erasure legs
        // over HTTPS (egress via the VPC/NAT to the shared ALB). It does NOT call the Clerk SDK, drains no
        // SQS, and touches no bucket — so no auth-secret read, no queue grant. The EdDSA signing key is
        // deploy-embedded (erasureFanoutEnv), so no runtime GetSecretValue grant is needed for it either.
        const erasureReconciliationRole = makeLambdaRole(
            'ErasureReconciliationLambdaRole',
            'Least-privilege role for the scheduled erasure-completion reconciliation Lambda (DB read only)',
        );
        dbCredentialsSecret.grantRead(erasureReconciliationRole);

        // migration (handlers/migrate.ts): SLIM. It only reads the DB creds (DB_SECRET_ARN) to apply the
        // bundled ordered SQL — no SQS, no bucket, no auth secret, and no migration-plan secret (that
        // prop is unused by this handler; the runner discovers .sql files, it does not read a plan).
        const migrationRole = makeLambdaRole(
            'MigrationLambdaRole',
            'Slim least-privilege role for the schema-migration Lambda (DB-secret read only)',
        );
        dbCredentialsSecret.grantRead(migrationRole);

        const webhookFn = new lambda.Function(this, 'WebhookFunction', {
            runtime,
            architecture,
            handler: 'handlers/identityWebhook.handler',
            code: lambda.Code.fromAsset(distPath),
            role: webhookRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(30),
            memorySize: 512,
            environment: {
                // clerkBackendEnv (not commonEnv): handleUserCreated calls setExternalId via the Clerk
                // backend SDK, which needs IDP_SECRET_KEY. Without it, identityClient falls through to a
                // runtime GetSecretValue on the auth secret that the role can't read → AccessDenied →
                // every user.created 502s.
                ...clerkBackendEnv,
                // The handle-sync topic the user.updated route publishes renames to (W8-a.2).
                HANDLE_SYNC_TOPIC_ARN: handleSyncTopic.topicArn,
                // Embed the Clerk webhook signing secret as a Lambda env var, resolved from Secrets
                // Manager at *deploy* time via a CloudFormation dynamic reference — not fetched at
                // runtime. The handler reads `IDP_WEBHOOK_SECRET` directly, so this removes a
                // per-cold-start GetSecretValue call. The literal never lands in the synthesized
                // template (only the `{{resolve:secretsmanager:...}}` token does); CloudFormation
                // resolves it into the function config at deploy. The signing secret does not rotate,
                // so a stale embedded value is not a concern (unlike the RDS creds, which stay
                // runtime-fetched via DB_SECRET_ARN).
                IDP_WEBHOOK_SECRET: SecretValue.secretsManager(getAuthSecretName(identityStage), {
                    jsonField: 'WEBHOOK_SIGNING_SECRET',
                }).unsafeUnwrap(),
            },
            logGroup: webhooksLogGroup,
        });

        const deletionWorkerFn = new lambda.Function(this, 'DeletionWorkerFunction', {
            runtime,
            architecture,
            handler: 'handlers/deletion-worker.handler',
            code: lambda.Code.fromAsset(distPath),
            role: deletionWorkerRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(30),
            memorySize: 512,
            // clerkBackendEnv (ban/unban) + the CR-002 erasure fan-out config (recipe + food legs).
            environment: { ...clerkBackendEnv, ...erasureFanoutEnv },
            logGroup: webhooksLogGroup,
        });

        // The deletion worker drains the SQS deletion queue (handlers/deletion-worker.ts iterates
        // event.Records). This source previously sat on the reconciliation function — a copy-paste
        // swap that left deletions running through the reconciliation handler (which ignores SQS
        // records) and reconciliation never running at all.
        deletionWorkerFn.addEventSource(
            new lambda_event_sources.SqsEventSource(deletionQueue, {
                batchSize: 1,
            }),
        );

        const reconciliationFn = new lambda.Function(this, 'ReconciliationFunction', {
            runtime,
            architecture,
            handler: 'handlers/reconciliation.handler',
            code: lambda.Code.fromAsset(distPath),
            role: reconciliationRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(30),
            memorySize: 512,
            environment: clerkBackendEnv,
            logGroup: webhooksLogGroup,
        });

        // Nightly Clerk<->DB drift repair, and the primary backfill safety net for users that slip
        // past both creation paths. handlers/reconciliation.ts is typed for ScheduledEvent; it must
        // run on a schedule, NOT off the deletion queue. 07:00 UTC = low-traffic window.
        new events.Rule(this, 'ReconciliationSchedule', {
            schedule: events.Schedule.cron({ minute: '0', hour: '7' }),
            targets: [new events_targets.LambdaFunction(reconciliationFn)],
        });

        // CR-002 KTD-3: the 12-month tombstone → erasure sweep. Finds closed (tombstoned) accounts past the
        // retention window and erases them (identity scrub + Clerk deleteUser + audit + recipe/food erasure
        // legs). Runs daily (the handler applies the 12-month cutoff itself), on a distinct schedule from
        // reconciliation. 03:00 UTC = low-traffic window, offset from reconciliation's 07:00.
        const tombstoneSweepFn = new lambda.Function(this, 'TombstoneSweepFunction', {
            runtime,
            architecture,
            handler: 'handlers/tombstone-sweep.handler',
            code: lambda.Code.fromAsset(distPath),
            role: tombstoneSweepRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: clerkBackendEnv,
            logGroup: webhooksLogGroup,
        });

        new events.Rule(this, 'TombstoneSweepSchedule', {
            schedule: events.Schedule.cron({ minute: '0', hour: '3' }),
            targets: [new events_targets.LambdaFunction(tombstoneSweepFn)],
        });

        // CR-002 R7 — the erasure completion-contract reconciliation. DISTINCT from the provisioning
        // reconciliation above: it scans `status='erased'` identities and re-drives the idempotent recipe +
        // food erasure legs, emitting the `ErasureIncomplete` metric a lost/stuck leg trips. Runs daily at
        // 05:00 UTC — offset from the tombstone-sweep (03:00) and the provisioning reconciliation (07:00) so
        // the three scheduled jobs don't contend. Timeout is generous: it re-drives two HTTP legs per erased
        // identity.
        const erasureReconciliationFn = new lambda.Function(this, 'ErasureReconciliationFunction', {
            runtime,
            architecture,
            handler: 'handlers/erasure-reconciliation.handler',
            code: lambda.Code.fromAsset(distPath),
            role: erasureReconciliationRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(300),
            memorySize: 512,
            // commonEnv (DB creds) + the fan-out config (signing key + recipe/food origins). No Clerk secret.
            environment: { ...commonEnv, ...erasureFanoutEnv },
            logGroup: webhooksLogGroup,
        });

        new events.Rule(this, 'ErasureReconciliationSchedule', {
            schedule: events.Schedule.cron({ minute: '0', hour: '5' }),
            targets: [new events_targets.LambdaFunction(erasureReconciliationFn)],
        });

        // Somewhere for the alarms below to page. This stack had NO alarm action at all: its single alarm
        // changed state and told nobody, which is the same failure `identity-service-stack.ts` records having
        // already fixed once ("A4: alarms previously had no action wired, so they fired silently").
        // Subscriptions are managed out-of-band per stage, as they are for the identity and food topics.
        const alarmTopic = new sns.Topic(this, 'WebhooksAlarmTopic', {
            enforceSSL: true,
            displayName: `Identity webhooks alarms (${deployStage})`,
        });
        const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);

        /**
         * The dimensions `emitMetric` (`src/common/observability.ts`) attaches to EVERY metric it publishes.
         *
         * ⛔ AN ALARM ON ONE OF THESE METRICS MUST SELECT THESE DIMENSIONS. The EMF directive is
         * `Dimensions: [['service', 'metric', ...Object.keys(dimensions)]]`, and EMF publishes ONLY the
         * dimension sets the directive lists — CloudWatch does not also roll the datapoints up under an empty
         * dimension set. A dimensionless alarm therefore subscribes to a series that has never received a single
         * datapoint, and with `treatMissingData: NOT_BREACHING` it sits in a confident, permanent `OK`.
         *
         * That is not hypothetical: the `ErasureIncomplete` alarm below was written dimensionless and had been
         * dead since the day it was authored. Both deployed alarms
         * (`kitchensink-erasure-incomplete-{prod,sandbox}`) reported `Dimensions: []` with the state reason "no
         * datapoints were received for 2 periods and 2 missing datapoints were treated as [NonBreaching]".
         *
         * The ALARM is the side that was fixed, not the emitter: the dimension set is the emitter's published
         * contract for every other metric, and adding a second (empty) dimension set to the directive would
         * double the number of billed custom metrics to make one alarm's omission work. `service` and `metric`
         * carry the emitter's own literals — `metric` is redundant with the CloudWatch metric name, and if it is
         * ever dropped from the emitter these alarms must change in the same commit;
         * `service-infra-wiring-invariants.test.ts` (W4) now fails if they drift apart.
         */
        const EMITTER_NAMESPACE = 'KitchenSink/IdentityWebhooks';
        const emitterDimensions = (metricName: string): Record<string, string> => ({
            service: 'identity-webhooks',
            metric: metricName,
        });

        // R7 detective control: alarm when ANY erased identity's recipe/food leg is still incomplete. The
        // handler emits `ErasureIncomplete` (a count) every run — including 0, so a cleared backlog resets
        // the alarm. A silently half-erased account is a GDPR Art. 17 failure, so a single incomplete owner
        // for two consecutive daily runs pages.
        const erasureIncompleteAlarm = new cloudwatch.Alarm(this, 'ErasureIncompleteAlarm', {
            alarmName: `kitchensink-erasure-incomplete-${deployStage}`,
            alarmDescription:
                'CR-002 R7: one or more identities reached status=erased but their recipe/food erasure leg is not complete.',
            metric: new cloudwatch.Metric({
                namespace: EMITTER_NAMESPACE,
                metricName: 'ErasureIncomplete',
                dimensionsMap: emitterDimensions('ErasureIncomplete'),
                statistic: cloudwatch.Stats.MAXIMUM,
                period: Duration.days(1),
            }),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 2,
            datapointsToAlarm: 2,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        erasureIncompleteAlarm.addAlarmAction(alarmAction);

        /**
         * Webhook REJECTIONS, alarmed per `reason`. The counter was emitted and watched by nothing at all.
         *
         * `handler-pipeline.ts` records `emitMetric('IdentityWebhookRejected', 1, { reason })` on every rejected
         * payload, and its own docstring explains why `reason` is a dimension rather than a branch: "an alert can
         * threshold signature noise (this endpoint is public and unauthenticated by design, so it receives
         * internet background scanning) separately from shape failures, which are the ones that mean Clerk's
         * contract moved". That alert did not exist, so a rejection was indistinguishable from a success.
         *
         * Two alarms rather than one, because a single threshold over both reasons is useless in both directions:
         * set it low and scanner noise pages continuously; set it high and a total contract break is buried.
         */
        const rejectionMetric = (reason: string): cloudwatch.Metric =>
            new cloudwatch.Metric({
                namespace: EMITTER_NAMESPACE,
                metricName: 'IdentityWebhookRejected',
                dimensionsMap: { ...emitterDimensions('IdentityWebhookRejected'), reason },
                statistic: cloudwatch.Stats.SUM,
                period: Duration.minutes(5),
            });

        // `shape` = the payload verified its SIGNATURE and then failed the zod schema, i.e. this really is Clerk
        // and Clerk's contract has moved. There is no benign cause and no volume at which it is acceptable, so a
        // single occurrence in one period pages. It is also the rejection that returns 200 (the payload is
        // acknowledged, not retried), so nothing else in the system will ever raise it.
        const shapeRejectionAlarm = new cloudwatch.Alarm(this, 'WebhookShapeRejectionAlarm', {
            alarmName: `kitchensink-webhook-rejected-shape-${deployStage}`,
            alarmDescription:
                "Clerk's user webhook payload failed schema validation after a valid signature — their contract has changed and users are no longer syncing.",
            metric: rejectionMetric('shape'),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        shapeRejectionAlarm.addAlarmAction(alarmAction);

        // `signature` = svix rejected the headers. Sporadically this is background scanning of a public
        // endpoint and must never page. SUSTAINED it is the outage worth catching: a rotated/stale
        // `SIGNING_SECRET` rejects every genuine webhook, so no user is provisioned or updated at all.
        //
        // The threshold discriminates on DURATION rather than magnitude, which is what separates the two
        // causes: scanning is bursty, a stale secret is continuous. 15 minutes of sustained failures. The
        // magnitude is a deliberate starting point rather than a measured one — there is no rejection-rate
        // history to fit it to yet — so tune it from the metric once it has run, and treat a flapping alarm
        // here as a signal to raise the threshold, never to delete the alarm.
        const signatureRejectionAlarm = new cloudwatch.Alarm(this, 'WebhookSignatureRejectionAlarm', {
            alarmName: `kitchensink-webhook-rejected-signature-${deployStage}`,
            alarmDescription:
                'Sustained svix signature rejections on the Clerk webhook — likely a stale SIGNING_SECRET, in which case NO user is being synced. Sporadic rejections are internet scanning and do not reach this threshold.',
            metric: rejectionMetric('signature'),
            threshold: 20,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 3,
            datapointsToAlarm: 3,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        signatureRejectionAlarm.addAlarmAction(alarmAction);

        // In-VPC schema migration runner. The RDS instance lives in private-isolated subnets, so the
        // deploy pipeline (outside the VPC) invokes this Lambda to apply migrations. It reuses the
        // lambda SG (which has egress to PostgreSQL) and the DB credentials in commonEnv.
        const migrationFn = new lambda.Function(this, 'MigrationFunction', {
            runtime,
            architecture,
            handler: 'handlers/migrate.handler',
            code: lambda.Code.fromAsset(distPath),
            role: migrationRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: commonEnv,
            logGroup: webhooksLogGroup,
        });

        new CfnOutput(this, 'MigrationFunctionName', {
            value: migrationFn.functionName,
            exportName: `${this.stackName}:MigrationFunctionName`,
        });

        const apiLogGroup = new logs.LogGroup(this, 'IdentityWebhooksApiLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        // CloudWatch -> Sentry log drain (U5). The forwarder runs outside the VPC (direct egress to
        // Sentry's OTLP endpoint) and is intentionally NOT subscribed to its own log group.
        const logForwarderLogGroup = new logs.LogGroup(this, 'LogForwarderLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });
        const logForwarderRole = new iam.Role(this, 'LogForwarderRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Execution role for the CloudWatch->Sentry log forwarder',
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        });
        logForwarderLogGroup.grantWrite(logForwarderRole);

        const logForwarderFn = new lambda.Function(this, 'LogForwarderFunction', {
            runtime,
            architecture,
            handler: 'handlers/log-forwarder.handler',
            code: lambda.Code.fromAsset(distPath),
            role: logForwarderRole,
            timeout: Duration.seconds(15),
            memorySize: 256,
            environment: {
                NODE_ENV: 'production',
                STAGE: deployStage,
                // Single, stage-agnostic log-drain DSN (one Sentry project for all stages); the
                // forwarder tags each record's environment from the source log group name.
                LOG_DRAIN_DSN: ssm.StringParameter.valueForStringParameter(
                    this,
                    ssmParamPath('global', 'sentry', 'log-drain-dsn'),
                ),
                SENTRY_DSN: ssmValue('sentry', 'webhook-dsn'),
                SENTRY_TRACES_SAMPLE_RATE: sentryTracesSampleRate,
                SENTRY_RELEASE: sentryRelease,
            },
            logGroup: logForwarderLogGroup,
        });

        // Exclude routine Lambda platform lines and EMF metric payloads at the filter level (KTD2);
        // one filter per group (the non-adjustable quota is 2/group, and all targets have zero).
        const drainDestination = new logsDestinations.LambdaDestination(logForwarderFn);
        const drainPattern = logs.FilterPattern.literal('-START -END -REPORT -"_aws"');
        const drainTargets: Array<{ id: string; logGroup: logs.ILogGroup }> = [
            { id: 'WebhooksLogDrain', logGroup: webhooksLogGroup },
            { id: 'WebhooksApiLogDrain', logGroup: apiLogGroup },
            // ECS container log group lives in the identity-service stack, which deploys before this
            // one (prod-deploy order), so importing it by name here keeps producer-before-consumer.
            {
                id: 'EcsServiceLogDrain',
                logGroup: logs.LogGroup.fromLogGroupName(
                    this,
                    'ImportedEcsServiceLogGroup',
                    Fn.importValue(`kitchensink-identity-service-${deployStage}:IdentityServiceLogGroupName`),
                ),
            },
        ];
        for (const target of drainTargets) {
            new logs.SubscriptionFilter(this, target.id, {
                logGroup: target.logGroup,
                destination: drainDestination,
                filterPattern: drainPattern,
                filterName: 'forward-app-logs',
            });
        }

        const api = new apigw.RestApi(this, 'IdentityWebhooksApi', {
            restApiName: `kitchensink-identity-webhooks-${deployStage}`,
            description: 'Identity webhooks API for Clerk user events',
            deployOptions: {
                stageName: 'v1',
                accessLogDestination: new apigw.LogGroupLogDestination(apiLogGroup),
                // `jsonWithStandardFields()` emits `$context.resourcePath`, which is `/webhooks/users` for
                // BOTH base-path mappings — so a real delivery cannot be attributed to the canonical
                // `api/v1` path or the deprecated `v1` alias. Three genuine Clerk deliveries were observed
                // in production and were indistinguishable on exactly this point, which is what blocks
                // retiring the alias (ADR-0011): you cannot prove Clerk has stopped using it. `$context.path`
                // is the full incoming path and resolves that; `$context.domainName` additionally separates
                // the custom domain from the raw execute-api host. Asserted by webhooks-stack.test.ts.
                accessLogFormat: apigw.AccessLogFormat.custom(
                    JSON.stringify({
                        requestId: '$context.requestId',
                        ip: '$context.identity.sourceIp',
                        user: '$context.identity.user',
                        caller: '$context.identity.caller',
                        requestTime: '$context.requestTime',
                        httpMethod: '$context.httpMethod',
                        domainName: '$context.domainName',
                        path: '$context.path',
                        resourcePath: '$context.resourcePath',
                        status: '$context.status',
                        protocol: '$context.protocol',
                        responseLength: '$context.responseLength',
                    }),
                ),
                loggingLevel: apigw.MethodLoggingLevel.ERROR,
                throttlingBurstLimit: 100,
                throttlingRateLimit: 50,
            },
            defaultCorsPreflightOptions: {
                allowOrigins: apigw.Cors.ALL_ORIGINS,
                allowHeaders: ['Content-Type', 'Authorization'],
                allowMethods: apigw.Cors.ALL_METHODS,
            },
        });

        // The webhook's public path is (custom-domain base path) + (resource path `webhooks/users`), so the
        // version prefix is owned HERE, not by the Lambda. ONE mapping, `api/v1` — every HTTP endpoint in the
        // platform is served under `/api/{version}/`, making the webhook `POST /api/v1/webhooks/users`.
        //
        // A multi-level base path cannot use `addBasePathMapping` (`AWS::ApiGateway::BasePathMapping` rejects
        // multi-level and CDK throws); it must go through `addApiMapping` → `AWS::ApiGatewayV2::ApiMapping`.
        // AWS allows that only on a REGIONAL domain with a TLS 1.2+ security policy — both set on
        // `customDomain` above; do not downgrade either or synth will fail.
        //
        // A second, single-level `v1` alias used to sit beside this one and was marked un-removable, because
        // the endpoint URL lives in the Clerk DASHBOARD (outside this repo) and nothing could prove Clerk had
        // stopped using it: the access log emitted only `$context.resourcePath`, which is `/webhooks/users`
        // for BOTH mappings. Adding `$context.path` above resolved that. Retired 2026-08-07 on measured
        // evidence — a driven user.created/user.deleted pair on EACH Clerk instance arrived 3/3 on
        // `/api/v1/webhooks/users` (prod and sandbox), with zero `/v1/...` deliveries; Svix posts to ONE
        // configured URL per endpoint, so that identifies the URL rather than sampling it. If user sync ever
        // stops, a `404` on `/v1/webhooks/users` is the signature — check the dashboard's endpoint list
        // first. See ADR-0011 and `webhooks-stack.test.ts`.
        customDomain.addApiMapping(api.deploymentStage, { basePath: 'api/v1' });

        new route53.ARecord(this, 'IdentityApiAliasRecord', {
            zone: hostedZone,
            recordName: props.domainName,
            target: route53.RecordTarget.fromAlias(new route53_targets.ApiGatewayDomain(customDomain)),
        });

        const webhookIntegration = new apigw.LambdaIntegration(webhookFn);

        // The Clerk user-event webhook is the only route on this API: POST /api/v1/webhooks/users
        // (registration.identity[.sandbox].commise.app/api/v1/webhooks/users — the `api/v1` base path
        // mapped above; the old `/v1` alias was retired 2026-08-07). Per Clerk's model it is public (no
        // API GW authorizer) and authenticated by its svix signature inside the Lambda, which dispatches
        // on the event `type`. Subscribe a Dashboard endpoint's user.* events here.
        const webhooksResource = api.root.addResource('webhooks');
        const usersWebhookResource = webhooksResource.addResource('users');
        const usersWebhookMethod = usersWebhookResource.addMethod('POST', webhookIntegration, {
            authorizationType: apigw.AuthorizationType.NONE,
        });

        // AwsSolutions-APIG4 + -COG4 accepted on THIS method only (never the whole API): the route is
        // authenticated by the svix HMAC signature the Lambda verifies before doing any work, and a gateway
        // authorizer would make Clerk unable to call it at all. Justification in @kitchensink/infra-security.
        acceptNagFindings(usersWebhookMethod, AcceptedNagFindings.CLERK_WEBHOOK_VERIFIES_ITS_OWN_SIGNATURE);

        // AwsSolutions-APIG3 accepted: a WAFv2 web ACL is not proportionate to one signature-verified route
        // against a $300/month account budget (ADR-0008). Deferred, not dismissed.
        acceptNagFindings(api.deploymentStage, AcceptedNagFindings.REST_API_EDGE_CONTROLS_NOT_PROPORTIONATE);

        api.addGatewayResponse('Default4xx', {
            type: apigw.ResponseType.DEFAULT_4XX,
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
            },
        });
        api.addGatewayResponse('Default5xx', {
            type: apigw.ResponseType.DEFAULT_5XX,
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
            },
        });

        this.apiUrl = api.url;

        new ssm.StringParameter(this, 'SsmWebhooksApiUrl', {
            parameterName: `/kitchensink/identity/${deployStage}/webhooks/api/url`,
            stringValue: this.apiUrl,
        });

        new CfnOutput(this, 'WebhooksApiUrl', {
            value: this.apiUrl,
        });
    }
}
