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
    aws_iam as iam,
    aws_lambda as lambda,
    aws_lambda_event_sources as lambda_event_sources,
    aws_logs as logs,
    aws_logs_destinations as logsDestinations,
    aws_rds as rds,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
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
    public readonly authorizerFn!: lambda.Function;

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
        const authSecretKey = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedAuthSecret', {
            secretCompleteArn: props.authSecretArn,
        });
        secretsmanager.Secret.fromSecretAttributes(this, 'ImportedMigrationSecret', {
            secretCompleteArn: props.migrationPlanSecretArn,
        });
        rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedDatabase', {
            instanceIdentifier: props.dbInstanceIdentifier,
            instanceEndpointAddress: props.dbEndpoint,
            port: props.dbPort,
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedDbSg', props.databaseSecurityGroupId),
            ],
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
            ['dev', 'staging', 'prod', 'test'].includes(deployStage) ||
            deployStage.startsWith('sandbox-') ||
            deployStage.startsWith('mr-') ||
            deployStage.startsWith('pr-');
        if (!isValidStage) {
            throw new Error(
                `Invalid STAGE="${deployStage}". Must be dev, staging, prod, test, or sandbox-* / mr-* / pr-*.`,
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

        const authorizerLogGroup = new logs.LogGroup(this, 'AuthorizerLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        const authorizerRole = new iam.Role(this, 'AuthorizerLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Least-privilege execution role for identity authorizer Lambda',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        authorizerLogGroup.grantWrite(authorizerRole);
        authSecretKey.grantRead(authorizerRole);
        dbCredentialsSecret.grantRead(authorizerRole);

        this.authorizerFn = new lambda.Function(this, 'AuthorizerFunction', {
            runtime,
            architecture,
            handler: 'authorizer/handler.handler',
            code: lambda.Code.fromAsset(distPath),
            role: authorizerRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(10),
            memorySize: 256,
            environment: {
                NODE_ENV: 'production',
                AUTH_SECRET_ARN: authSecretKey.secretArn,
                DB_SECRET_ARN: dbCredentialsSecret.secretArn,
                IDP_JWKS_URL: ssmValue('clerk', 'jwks-url'),
                IDP_ISSUER: ssmValue('clerk', 'issuer'),
                IDP_AUDIENCE: ssmValue('clerk', 'audience'),
                WEBHOOK_SECRET_ARN: authSecretKey.secretArn,
                ...sentryEnv,
            },
            logGroup: authorizerLogGroup,
        });

        const webhooksLogGroup = new logs.LogGroup(this, 'WebhooksLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        const webhooksRole = new iam.Role(this, 'WebhooksLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Least-privilege execution role for identity-webhooks Lambda',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        webhooksLogGroup.grantWrite(webhooksRole);
        dbCredentialsSecret.grantRead(webhooksRole);
        authSecretKey.grantRead(webhooksRole);
        deletionQueue.grantSendMessages(webhooksRole);
        deletionQueue.grantConsumeMessages(webhooksRole);
        mediaBucket.grantReadWrite(webhooksRole);
        archiveBucket.grantReadWrite(webhooksRole);

        const webhookFn = new lambda.Function(this, 'WebhookFunction', {
            runtime,
            architecture,
            handler: 'handlers/identityWebhook.handler',
            code: lambda.Code.fromAsset(distPath),
            role: webhooksRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(30),
            memorySize: 512,
            environment: {
                ...commonEnv,
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

        new lambda.Function(this, 'DeletionWorkerFunction', {
            runtime,
            architecture,
            handler: 'handlers/deletion-worker.handler',
            code: lambda.Code.fromAsset(distPath),
            role: webhooksRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(30),
            memorySize: 512,
            environment: commonEnv,
            logGroup: webhooksLogGroup,
        });

        const reconciliationFn = new lambda.Function(this, 'ReconciliationFunction', {
            runtime,
            architecture,
            handler: 'handlers/reconciliation.handler',
            code: lambda.Code.fromAsset(distPath),
            role: webhooksRole,
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
            timeout: Duration.seconds(30),
            memorySize: 512,
            environment: commonEnv,
            logGroup: webhooksLogGroup,
        });

        reconciliationFn.addEventSource(
            new lambda_event_sources.SqsEventSource(deletionQueue, {
                batchSize: 1,
            }),
        );

        // In-VPC schema migration runner. The RDS instance lives in private-isolated subnets, so the
        // deploy pipeline (outside the VPC) invokes this Lambda to apply migrations. It reuses the
        // lambda SG (which has egress to PostgreSQL) and the DB credentials in commonEnv.
        const migrationFn = new lambda.Function(this, 'MigrationFunction', {
            runtime,
            architecture,
            handler: 'handlers/migrate.handler',
            code: lambda.Code.fromAsset(distPath),
            role: webhooksRole,
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
            { id: 'AuthorizerLogDrain', logGroup: authorizerLogGroup },
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

        const requestAuthorizer = new apigw.RequestAuthorizer(this, 'IdentityRequestAuthorizer', {
            handler: this.authorizerFn,
            identitySources: [apigw.IdentitySource.header('Authorization')],
            resultsCacheTtl: Duration.seconds(300),
        });

        const webhookIntegration = new apigw.LambdaIntegration(webhookFn);

        const webhooksResource = api.root.addResource('webhooks');

        const usersWebhookResource = webhooksResource.addResource('users');
        usersWebhookResource.addMethod('POST', webhookIntegration, {
            authorizationType: apigw.AuthorizationType.NONE,
        });

        const usersResource = api.root.addResource('users');

        const upsertResource = usersResource.addResource('upsert');
        upsertResource.addMethod('POST', webhookIntegration, {
            authorizer: requestAuthorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
        });

        const deletionResource = usersResource.addResource('deletion');
        deletionResource.addMethod('POST', webhookIntegration, {
            authorizer: requestAuthorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
        });

        const reconciliationResource = usersResource.addResource('reconciliation');
        reconciliationResource.addMethod('POST', webhookIntegration, {
            authorizer: requestAuthorizer,
            authorizationType: apigw.AuthorizationType.CUSTOM,
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
        new CfnOutput(this, 'AuthorizerFnArn', {
            value: this.authorizerFn.functionArn,
        });
    }
}
