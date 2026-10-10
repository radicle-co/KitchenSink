import {
    CustomResource,
    Duration,
    RemovalPolicy,
    Stack,
    type StackProps,
    aws_cloudfront as cloudfront,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_logs as logs,
    aws_logs_destinations as logsDestinations,
    aws_secretsmanager as secretsmanager,
    aws_ssm as ssm,
    custom_resources as cr,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { remoteSearchSharedParameter } from '@radicle-co/infra-shared/remote-search';
import { NODE_LAMBDA_RUNTIME } from '@radicle-co/infra-shared/security';
import { remoteSearchParameterSchema, type RemoteSearchParameter } from '@kitchensink/schema-remote-search';

/** The longest a found answer is kept: the `s-maxage` the function sends for one (ADR-0055 point 2). */
const MAX_CACHE_LIFETIME = Duration.days(7);

/** The cache key's one query parameter (ADR-0055 point 2). The signed `admit` and `rid` are forwarded, not keyed. */
const CACHE_KEY_PARAMETER: RemoteSearchParameter = 'q';

/**
 * The signing key generations the key group trusts; food is told the newest. Rotation has four steps:
 *
 * 1. Add a generation and deploy this app. Both keys are trusted, and the parameters name the new one.
 * 2. Redeploy every food that signs with this key, so each reads the new one. At `prod` that is prod's food. At
 *    `sandbox` it is the food of EVERY open preview, because food never runs at `sandbox` itself, and a preview whose
 *    food did not change is skipped by its deploy gate, so dispatch its deploy.
 * 3. Remove the old generation and deploy this app again. The deploy refuses while any food service at this stage
 *    still runs a task definition naming the old key-pair id (`.github/scripts/remoteSearchKeyRetirement.sh`).
 * 4. Delete the old generation's secret by hand. It is retained, so a food task that restarts on an old task
 *    definition still starts.
 *
 * CloudFront holds at most five public keys in one key group.
 */
const SIGNING_KEY_GENERATIONS = [1] as const;

/** Props for {@link RemoteSearchSharedStack}. */
export interface RemoteSearchSharedStackProps extends StackProps {
    /** The base stage: `prod`, or `sandbox`, whose values every preview's search copy and food share. */
    readonly stage: string;
    /** The log forwarder's ARN, resolved in CI. Absent means no subscription filter is attached (ADR-0042). */
    readonly logForwarderArn?: string;
}

/** One signing key generation: the secret holding its private key, the resource that wrote it, its public key. */
interface SigningKeyGeneration {
    readonly secret: secretsmanager.Secret;
    readonly provisioned: CustomResource;
    readonly publicKey: cloudfront.PublicKey;
}

/**
 * What every remote search copy on a base stage shares, ONE per base stage (ADR-0055 points 2 and 7): the CloudFront
 * signing key, and the cache policy, origin request policy and origin access control every copy's distribution uses.
 *
 * An account caps all four: at most ten public keys and, by default, ten key groups, about twenty cache policies and
 * twenty origin request policies. A set per search copy would cap the number of open previews, so this stack holds the
 * base stage's set instead, as per-PR food shares the sandbox database and ALB (ADR-0006). Every copy references them
 * by the ids published to SSM, and every food on the base stage signs with the key.
 *
 * The provisioner generates each generation's RSA key inside AWS, writes the private key into that generation's
 * secret, and answers with the public key, which becomes a CloudFront public key. No person handles the private key,
 * and no template, log or environment value carries it.
 *
 * @pattern Valet Key — the key pair food signs CloudFront URLs with, and the key group that admits them
 * @pattern Flyweight — one set of policies and one access control, referenced by id from every copy's distribution
 * @implements ADR-0055
 */
export class RemoteSearchSharedStack extends Stack {
    public constructor(scope: Construct, id: string, props: RemoteSearchSharedStackProps) {
        super(scope, id, props);

        const { stage } = props;

        // Bundled by esbuild.mjs to dist-lambda/ (npm run bundle:lambda, run by every global deploy). A bare synth
        // ships an inline placeholder that refuses to provision, so an unbundled deploy fails instead of trusting a
        // key nobody wrote, and that still answers Delete so a stack delete is never wedged.
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);

        const logGroups = [
            new logs.LogGroup(this, 'SigningKeyProvisionerLogGroup', {
                retention: logs.RetentionDays.ONE_MONTH,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            new logs.LogGroup(this, 'SigningKeyProviderLogGroup', {
                retention: logs.RetentionDays.ONE_MONTH,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
        ] as const;
        const [provisionerLogGroup, providerLogGroup] = logGroups;

        const provisionerRole = new iam.Role(this, 'SigningKeyProvisionerRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Writes the remote search CloudFront signing private key into its secret, and reads it back.',
        });

        provisionerLogGroup.grantWrite(provisionerRole);

        const provisioner = new lambda.Function(this, 'SigningKeyProvisioner', {
            description: `Provisions the remote search CloudFront signing key (${stage}), ADR-0055`,
            role: provisionerRole,
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: hasLambdaAsset ? 'remoteSearchSigningKey/handler.handler' : 'index.handler',
            code: hasLambdaAsset
                ? lambda.Code.fromAsset(lambdaAssetDir)
                : lambda.Code.fromInline(
                      'exports.handler = async (e) => { if (e.RequestType === "Delete") { ' +
                          'return { PhysicalResourceId: e.PhysicalResourceId }; } ' +
                          'throw new Error("remote search signing key provisioner deployed WITHOUT its bundle; run ' +
                          '`npm run bundle:lambda` in packages/infra/global before cdk deploy"); };',
                  ),
            memorySize: 256,
            timeout: Duration.seconds(30),
            logGroup: provisionerLogGroup,
        });

        const provider = new cr.Provider(this, 'SigningKeyProvider', {
            onEventHandler: provisioner,
            logGroup: providerLogGroup,
        });

        const generations: SigningKeyGeneration[] = SIGNING_KEY_GENERATIONS.map((generation) => {
            // ⚠️ Its generated initial value is overwritten by the provisioner; nothing may change how it is
            // generated, because CloudFormation would then generate a new value over the stored key.
            const secret = new secretsmanager.Secret(this, `SigningKey${generation}Secret`, {
                description: `Remote search CloudFront signing private key, generation ${generation} (${stage}). Read by food-service.`,
                removalPolicy: RemovalPolicy.RETAIN,
            });

            provisionerRole.addToPolicy(
                new iam.PolicyStatement({
                    actions: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue'],
                    resources: [secret.secretArn],
                }),
            );

            const provisioned = new CustomResource(this, `SigningKey${generation}`, {
                serviceToken: provider.serviceToken,
                resourceType: 'Custom::CloudFrontSigningKey',
                properties: { SecretArn: secret.secretArn },
            });

            // Named for the stage: a public key's name is unique in the account, which prod and sandbox share.
            const publicKey = new cloudfront.PublicKey(this, `SigningKey${generation}PublicKey`, {
                publicKeyName: `kitchensink-remote-search-${stage}-signing-key-${generation}`,
                encodedKey: provisioned.getAttString('PublicKeyPem'),
                comment: `Remote search signing key, generation ${generation} (${stage})`,
            });

            return { secret, provisioned, publicKey };
        });

        const newest = generations[generations.length - 1];

        if (newest === undefined) {
            throw new Error('RemoteSearchSharedStack: SIGNING_KEY_GENERATIONS must name at least one generation.');
        }

        const keyGroup = new cloudfront.KeyGroup(this, 'SigningKeyGroup', {
            keyGroupName: `kitchensink-remote-search-${stage}-signing-keys`,
            items: generations.map((generation) => generation.publicKey),
            comment: `Keys food-service signs remote search URLs with (${stage})`,
        });

        // ── The cache and origin policies, and the origin access control ──────────────────────────────
        //
        // ⛔ Every copy's distribution references these by id, so changing one changes every copy at once, and a
        // replacement (a new name) is refused while any distribution still uses the old one.
        const cachePolicy = new cloudfront.CachePolicy(this, 'SearchCachePolicy', {
            cachePolicyName: `kitchensink-remote-search-${stage}-cache`,
            comment: `Remote search: the path and q, kept only as long as the function says (${stage})`,
            minTtl: Duration.seconds(0),
            defaultTtl: Duration.seconds(0),
            maxTtl: MAX_CACHE_LIFETIME,
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList(CACHE_KEY_PARAMETER),
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            enableAcceptEncodingGzip: false,
            enableAcceptEncodingBrotli: false,
        });

        const originRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'SearchOriginRequestPolicy', {
            originRequestPolicyName: `kitchensink-remote-search-${stage}-origin-request`,
            comment: `Remote search: every request parameter reaches the function, nothing else (${stage})`,
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.allowList(
                ...remoteSearchParameterSchema.options,
            ),
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.none(),
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
        });

        // A standalone config: one access control may sign for many origins. Each copy grants CloudFront the invoke
        // permission for its own distribution only.
        const originAccessControl = new cloudfront.FunctionUrlOriginAccessControl(this, 'SearchOriginAccessControl', {
            originAccessControlName: `kitchensink-remote-search-${stage}-origin-access`,
            description: `Signs every request to a remote search function URL (${stage})`,
            signing: cloudfront.Signing.SIGV4_ALWAYS,
        });

        // ── What every search copy and food on this base stage read (SSM, never an export) ─────────────
        new ssm.StringParameter(this, 'KeyGroupIdParameter', {
            parameterName: remoteSearchSharedParameter(stage, 'key-group-id'),
            stringValue: keyGroup.keyGroupId,
            description: 'The key group every remote search distribution at this stage trusts (ADR-0055)',
        });

        new ssm.StringParameter(this, 'KeyPairIdParameter', {
            parameterName: remoteSearchSharedParameter(stage, 'key-pair-id'),
            stringValue: newest.publicKey.publicKeyId,
            description: 'The CloudFront key-pair id food-service signs remote search URLs with (ADR-0055)',
        });

        const signingKeySecretParameter = new ssm.StringParameter(this, 'SigningKeySecretParameter', {
            parameterName: remoteSearchSharedParameter(stage, 'signing-key-secret-arn'),
            stringValue: newest.secret.secretArn,
            description: 'The secret holding the private key food-service signs remote search URLs with (ADR-0055)',
        });

        // The ARN is known before the key is written; food must not read it until the secret holds the key.
        signingKeySecretParameter.node.addDependency(newest.provisioned);

        new ssm.StringParameter(this, 'CachePolicyIdParameter', {
            parameterName: remoteSearchSharedParameter(stage, 'cache-policy-id'),
            stringValue: cachePolicy.cachePolicyId,
            description: 'The cache policy every remote search distribution at this stage uses (ADR-0055)',
        });

        new ssm.StringParameter(this, 'OriginRequestPolicyIdParameter', {
            parameterName: remoteSearchSharedParameter(stage, 'origin-request-policy-id'),
            stringValue: originRequestPolicy.originRequestPolicyId,
            description: 'The origin request policy every remote search distribution at this stage uses (ADR-0055)',
        });

        new ssm.StringParameter(this, 'OriginAccessControlIdParameter', {
            parameterName: remoteSearchSharedParameter(stage, 'origin-access-control-id'),
            stringValue: originAccessControl.originAccessControlId,
            description:
                'The origin access control every remote search function URL at this stage is signed by (ADR-0055)',
        });

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
