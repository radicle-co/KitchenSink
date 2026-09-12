/**
 * The remote search service, deployed (ADR-0055 points 2, 6 and 7; plan 002 S7.3): one function with no VPC behind
 * its own CloudFront distribution, which only food-service can use. It is deployed at `prod` and once per pull
 * request, like food, and food at each stage reads the copy at its own stage.
 *
 * Food asks the distribution with a CloudFront signed URL (Valet Key). A hit is answered from the cache; a miss is
 * forwarded through origin access control (Gatekeeper) to the function URL, which accepts only this distribution. The
 * cache is keyed on the path and `q` alone and keeps only what the function marks shareable, so the admission flag
 * and the request id reach the function without splitting the cache.
 *
 * The signing key, the cache and origin request policies and the origin access control are not this stack's. They
 * belong to the base stage (`RemoteSearchSharedStack` in `packages/infra/global`), because an account caps each of
 * them: every copy references the base stage's by id, and food at every stage signs with the base stage's key.
 *
 * @pattern Read-Through Cache — a CloudFront distribution in front of the search function
 * @pattern Valet Key — CloudFront signed URLs through a trusted key group
 * @pattern Gatekeeper — origin access control in front of an `AWS_IAM` function URL
 * @module
 */
import {
    Duration,
    Fn,
    RemovalPolicy,
    Stack,
    type StackProps,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cloudwatchActions,
    aws_sns as sns,
} from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as logsDestinations from 'aws-cdk-lib/aws-logs-destinations';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { existsSync, readdirSync } from 'node:fs';

import { publicServiceOriginForStage, publicSubdomainForStage } from '@radicle-co/infra-shared/alb';
import {
    remoteSearchOriginParameter,
    remoteSearchSharedParameter,
    type RemoteSearchSharedParameter,
} from '@radicle-co/infra-shared/remote-search';
import { NODE_LAMBDA_RUNTIME, subscribeAlarmEmail } from '@radicle-co/infra-shared/security';
import { REMOTE_SEARCH_LATENCY_BOUND_MS } from '@kitchensink/schema-remote-search';
import { USDA_REQUEST_TIMEOUT_MS } from '@kitchensink/usda-client';

import { baseStageOf, type RemoteSearchStage } from './remoteSearchStage.js';

/** What the function allows itself beyond one USDA request: a cold start and the once-per-container key read. */
const FUNCTION_HEADROOM_MS = 5_000;

/** Longer than one USDA request, so a slow source answers as a timeout outcome rather than a killed function. */
const SEARCH_FUNCTION_TIMEOUT = Duration.millis(USDA_REQUEST_TIMEOUT_MS + FUNCTION_HEADROOM_MS);

/**
 * The published latency bound, which food's admitted-fetch bound is derived from too. It must stay longer than the
 * function can run, so CloudFront relays the function's own answer instead of timing out first (the stack test holds
 * that ordering).
 */
const ORIGIN_READ_TIMEOUT = Duration.millis(REMOTE_SEARCH_LATENCY_BOUND_MS);

/**
 * The function's concurrency cap, by the kind of stage. Admitted calls are bounded by the shared window's ceiling
 * (`sourceCeiling`, ADR-0053) and each lasts at most one USDA request (`USDA_REQUEST_TIMEOUT_MS`), so few run at once;
 * a probe returns in milliseconds. Prod's cap leaves several times that average. A preview has one cook, so two
 * lets a probe through while one admitted call runs. Every copy takes its cap from an account pool this repository
 * shares with another production application and that must keep 100 unreserved, so the cap stays small. A request
 * over it gets Lambda's `429` with no request-id echo, which food reads as this source being unavailable (ADR-0055
 * point 6).
 */
const RESERVED_CONCURRENCY: Readonly<Record<'prod' | 'preview', number>> = { prod: 10, preview: 2 };

/** Every status CloudFront accepts an error-caching TTL for. Each is set to zero (ADR-0055 point 2). */
const CONFIGURABLE_ERROR_CODES = [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504] as const;

/** Props for {@link RemoteSearchStack}. */
export interface RemoteSearchStackProps extends StackProps {
    /** The stage: `prod`, or a pull request's preview. */
    readonly stage: RemoteSearchStage;
    /** The apex domain the base stage's `DomainStack` holds the zone and the certificate for. */
    readonly domainName: string;
    /** The Lambda bundle directory (`dist-lambda/`) the function runs from, produced by `bundle:lambda`. */
    readonly lambdaAsset: string;
    /** The log forwarder's ARN, resolved in CI. Absent means no subscription filter is attached (ADR-0042). */
    readonly logForwarderArn?: string;
    /** Whether the stack creates its alarms, resolved at synth time from `ALARMS_ENABLED` (`alarmFeatureFlag.test.ts`). */
    readonly alarmsEnabled: boolean;
    /** Who the alarms email; absent creates the topic with no subscription. */
    readonly alertEmail?: string;
}

/**
 * Refuse a bundle directory that is absent or empty. `Code.fromAsset` throws on the first and ships the second,
 * which deploys green and fails on its first cold start.
 *
 * @param directory - The bundle directory.
 * @sideEffect Reads the filesystem.
 * @throws {Error} naming the command that produces the bundle.
 */
function requireBundle(directory: string): void {
    if (!existsSync(directory)) {
        throw new Error(
            `RemoteSearchStack: no bundle at '${directory}'. Run ` +
                '`npm run bundle:lambda --workspace=packages/services/remote-search` first.',
        );
    }

    if (readdirSync(directory).length === 0) {
        throw new Error(
            `RemoteSearchStack: the bundle at '${directory}' is empty. Re-run ` +
                '`npm run bundle:lambda --workspace=packages/services/remote-search`.',
        );
    }
}

/** The remote search service at one stage. */
export class RemoteSearchStack extends Stack {
    public constructor(scope: Construct, id: string, props: RemoteSearchStackProps) {
        super(scope, id, props);

        requireBundle(props.lambdaAsset);

        const { stage, domainName } = props;
        const baseStage = baseStageOf(stage);
        const code = lambda.Code.fromAsset(props.lambdaAsset);
        const logGroups: logs.LogGroup[] = [];

        // ── The search function ─────────────────────────────────────────────────────────────────────
        const searchFunctionName = `kitchensink-remote-search-${stage}`;
        // Owned by the stack, with retention, and deleted with it so a recreate can reuse the name. A literal construct
        // id, so the log-drain register's guard can read it (ADR-0042).
        const searchLogGroup = new logs.LogGroup(this, 'RemoteSearchLogGroup', {
            logGroupName: `/aws/lambda/${searchFunctionName}`,
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        logGroups.push(searchLogGroup);
        const searchRole = new iam.Role(this, 'SearchFunctionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Runs the remote search function: writes its logs and reads the USDA key, nothing else.',
        });

        searchLogGroup.grantWrite(searchRole);

        // The platform tier's USDA key, which food-service reads too (`FoodServiceStack`): a preview shares
        // sandbox's key and its quota. It is set out of band, so it is imported by name, and the function reads it
        // at run time: its value is in no template and no environment.
        const usdaApiKey = secretsmanager.Secret.fromSecretNameV2(
            this,
            'UsdaApiKeySecret',
            `kitchensink/${baseStage}/food/usda-api-key`,
        );

        usdaApiKey.grantRead(searchRole);

        const searchFunction = new lambda.Function(this, 'SearchFunction', {
            functionName: searchFunctionName,
            description: `Remote food search (${stage}), ADR-0055`,
            role: searchRole,
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: 'handler.handler',
            code,
            memorySize: 256,
            timeout: SEARCH_FUNCTION_TIMEOUT,
            reservedConcurrentExecutions: RESERVED_CONCURRENCY[stage === 'prod' ? 'prod' : 'preview'],
            logGroup: searchLogGroup,
            environment: {
                USDA_API_KEY_SECRET_ID: usdaApiKey.secretName,
                STAGE: stage,
                // A preview reports to sandbox's project, separated by its `environment` (as food's does).
                SENTRY_DSN: ssm.StringParameter.valueForStringParameter(
                    this,
                    `/kitchensink/${baseStage}/sentry/remote-search-dsn`,
                ),
                SENTRY_RELEASE: process.env['SENTRY_RELEASE'] ?? stage,
            },
        });

        const functionUrl = searchFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.AWS_IAM,
            invokeMode: lambda.InvokeMode.BUFFERED,
        });

        // ── What the base stage holds: the key group, the policies, the access control, the zone, the certificate
        //
        // The ids are read at deploy, so `RemoteSearchSharedStack` must exist at the base stage first; the pipelines
        // check that before they deploy this stack. None of its resources is replaced (a key group gains a public
        // key, a policy changes in place), so the ids a copy resolved stay the ones it uses.
        const shared = (name: RemoteSearchSharedParameter): string =>
            ssm.StringParameter.valueForStringParameter(this, remoteSearchSharedParameter(baseStage, name));
        const keyGroup = cloudfront.KeyGroup.fromKeyGroupId(this, 'SigningKeyGroup', shared('key-group-id'));
        const cachePolicy = cloudfront.CachePolicy.fromCachePolicyId(
            this,
            'SharedCachePolicy',
            shared('cache-policy-id'),
        );
        const originRequestPolicy = cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(
            this,
            'SharedOriginRequestPolicy',
            shared('origin-request-policy-id'),
        );

        // The same zone and certificate food and identity import. The certificate covers `*.{domain}`, which matches
        // every name `publicSubdomainForStage` returns, and it is in us-east-1, where CloudFront requires it.
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-domain-${baseStage}:HostedZoneId`),
            zoneName: domainName,
        });
        const certificate = acm.Certificate.fromCertificateArn(
            this,
            'ImportedCertificate',
            Fn.importValue(`kitchensink-domain-${baseStage}:CertificateArn`),
        );
        const subdomain = publicSubdomainForStage('remote-search', stage);

        // ── The distribution ────────────────────────────────────────────────────────────────────────
        const distribution = new cloudfront.Distribution(this, 'SearchDistribution', {
            comment: `Remote food search (${stage}), ADR-0055`,
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            domainNames: [`${subdomain}.${domainName}`],
            certificate,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            defaultBehavior: {
                // ⛔ The plain origin with the shared access control's id, not `withOriginAccessControl`: that helper
                // reads the access control's own CloudFormation child to check its signing, which an imported one
                // does not have, so it fails the synth (aws-cdk-lib 2.268). The base stage's stack pins the signing.
                origin: new origins.FunctionUrlOrigin(functionUrl, {
                    originAccessControlId: shared('origin-access-control-id'),
                    readTimeout: ORIGIN_READ_TIMEOUT,
                    connectionAttempts: 1,
                }),
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                compress: false,
                cachePolicy,
                originRequestPolicy,
                trustedKeyGroups: [keyGroup],
            },
            errorResponses: CONFIGURABLE_ERROR_CODES.map((httpStatus) => ({ httpStatus, ttl: Duration.seconds(0) })),
        });

        // A function URL behind origin access control needs BOTH `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`
        // from CloudFront (the CloudFront developer guide, "Restrict access to an AWS Lambda function URL origin"),
        // each scoped to this distribution. The shared access control signs for every copy; these say which
        // distribution may invoke THIS function.
        searchFunction.addPermission('CloudFrontInvokeFunctionUrl', {
            principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
            action: 'lambda:InvokeFunctionUrl',
            sourceArn: distribution.distributionArn,
        });
        searchFunction.addPermission('CloudFrontInvokeFunctionViaUrl', {
            principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: distribution.distributionArn,
            invokedViaFunctionUrl: true,
        });

        new route53.ARecord(this, 'SearchAliasRecord', {
            zone: hostedZone,
            recordName: subdomain,
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
        });

        // ── What food reads (SSM at food's own stage, never an export) ─────────────────────────────────
        //
        // The stable name, not the distribution's generated one: a replaced distribution keeps it, and the
        // certificate covers it.
        new ssm.StringParameter(this, 'OriginParameter', {
            parameterName: remoteSearchOriginParameter(stage),
            stringValue: publicServiceOriginForStage('remote-search', stage, domainName),
            description: 'The remote search distribution food-service signs requests for (ADR-0055)',
        });

        // ── Alarms ──────────────────────────────────────────────────────────────────────────────────
        //
        // The topic is not gated and the alarms are, for the reasons `FoodServiceStack` records: an idle topic costs
        // nothing, an alarm bills per month, and both rules are enforced by `alarmFeatureFlag.test.ts`.
        const alarmTopic = new sns.Topic(this, 'RemoteSearchAlarmTopic', {
            enforceSSL: true,
            displayName: `Remote search alarms (${stage})`,
        });

        subscribeAlarmEmail(alarmTopic, props.alertEmail);
        // `enforceSSL` replaces SNS's default topic policy, and with it CloudWatch's right to publish
        // (`alarmTopicPublishGrant.test.ts`).
        alarmTopic.addToResourcePolicy(
            new iam.PolicyStatement({
                sid: 'AllowCloudWatchAlarmPublish',
                effect: iam.Effect.ALLOW,
                principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
                actions: ['sns:Publish'],
                resources: [alarmTopic.topicArn],
                conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
            }),
        );

        if (props.alarmsEnabled) {
            const alarmAction = new cloudwatchActions.SnsAction(alarmTopic);

            // An unhandled error or a timeout: the handler answers every failure it knows with a typed response, so
            // this counts only what it did not expect.
            const errorsAlarm = new cloudwatch.Alarm(this, 'SearchFunctionErrorsAlarm', {
                alarmName: `kitchensink-remote-search-errors-${stage}`,
                alarmDescription:
                    'The remote search function failed outside its own error handling, or ran out of time. Read its ' +
                    'log group; food reports the source as unavailable meanwhile.',
                metric: searchFunction.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
                threshold: 0,
                evaluationPeriods: 1,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });

            errorsAlarm.addAlarmAction(alarmAction);

            // A request over the reserved concurrency gets Lambda's 429, which food reads as the source being
            // unavailable, so sustained throttling is cooks losing remote results.
            const throttlesAlarm = new cloudwatch.Alarm(this, 'SearchFunctionThrottlesAlarm', {
                alarmName: `kitchensink-remote-search-throttles-${stage}`,
                alarmDescription:
                    'The remote search function is refusing requests over its reserved concurrency; food shows the ' +
                    'source as unavailable for each one.',
                metric: searchFunction.metricThrottles({ period: Duration.minutes(5), statistic: 'Sum' }),
                threshold: 0,
                evaluationPeriods: 3,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });

            throttlesAlarm.addAlarmAction(alarmAction);
        }

        // ── Log drains (ADR-0042) ────────────────────────────────────────────────────────────────────
        if (props.logForwarderArn !== undefined) {
            const forwarder = lambda.Function.fromFunctionArn(this, 'ImportedLogForwarder', props.logForwarderArn);

            for (const group of logGroups) {
                new logs.SubscriptionFilter(this, `${group.node.id}Drain`, {
                    logGroup: group,
                    destination: new logsDestinations.LambdaDestination(forwarder, { addPermissions: false }),
                    filterPattern: logs.FilterPattern.literal('-START -END -REPORT -"_aws"'),
                    filterName: 'forward-app-logs',
                });
            }
        }
    }
}
