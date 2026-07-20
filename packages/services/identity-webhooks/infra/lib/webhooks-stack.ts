import {
    CfnOutput,
    Duration,
    Fn,
    SecretValue,
    Stack,
    type StackProps,
    aws_apigateway as apigw,
    aws_certificatemanager as acm,
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

import { getAuthSecretName, ssmParamPath } from './config.js';

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
        const runtime = lambda.Runtime.NODEJS_22_X;
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
        // deletion queue. It does NOT import identityClient, so it never reads the auth secret; it does
        // not send to SQS. (The SqsEventSource below also grants consume; the explicit grant states the
        // intent.) No auth secret, no SQS send, no buckets.
        const deletionWorkerRole = makeLambdaRole(
            'DeletionWorkerLambdaRole',
            'Least-privilege role for the SQS deletion-worker Lambda',
        );
        dbCredentialsSecret.grantRead(deletionWorkerRole);
        deletionQueue.grantConsumeMessages(deletionWorkerRole);

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
            environment: clerkBackendEnv,
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
                accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
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

        customDomain.addBasePathMapping(api, { basePath: 'v1', stage: api.deploymentStage });

        new route53.ARecord(this, 'IdentityApiAliasRecord', {
            zone: hostedZone,
            recordName: props.domainName,
            target: route53.RecordTarget.fromAlias(new route53_targets.ApiGatewayDomain(customDomain)),
        });

        const webhookIntegration = new apigw.LambdaIntegration(webhookFn);

        // The Clerk user-event webhook is the only route on this API: POST /v1/webhooks/users
        // (registration.identity[.sandbox].commise.app/v1/webhooks/users). Per Clerk's model it is
        // public (no API GW authorizer) and authenticated by its svix signature inside the Lambda,
        // which dispatches on the event `type`. Subscribe a Dashboard endpoint's user.* events here.
        const webhooksResource = api.root.addResource('webhooks');
        const usersWebhookResource = webhooksResource.addResource('users');
        usersWebhookResource.addMethod('POST', webhookIntegration, {
            authorizationType: apigw.AuthorizationType.NONE,
        });

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
